import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Operatör: "ödeme alındı, abonelik bekleniyor" kaydını serbest bırak (Codex 11-17; `api/admin/checkout-release`). GERÇEK POSTGRESQL.
// Kanıtlananlar: yalnız süper-admin (2FA'lı); bürünmede yazma yok; site dışı istek reddi; bekleyen kayıt "released" olur ve işletmenin
// denetim kaydına yazılır; beklemeyen kayıt 409, bilinmeyen 404 (ikisinde de kayıt değişmez, denetim yazılmaz).
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/admin/checkout-release/route";

const OPERATOR = "operator@lixus.test";
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/admin/checkout-release", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("operatör — bekleyen ödeme kaydını serbest bırak", () => {
  let orgId = "";
  let intentId = "";
  let operatorId = "";

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    orgId = (await prisma.organization.create({ data: { name: "Lale" } })).id;
    const opsOrg = (await prisma.organization.create({ data: { name: "Ops" } })).id;
    operatorId = (await prisma.user.create({ data: { organizationId: opsOrg, name: "Op", email: OPERATOR, passwordHash: "x", role: "owner" } })).id;
    const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
    intentId = (
      await prisma.checkoutIntent.create({
        data: { organizationId: orgId, consentId: consent.id, planCode: "pro", priceId: "pri_pro", providerRef: "txn_1", status: "completed", expiresAt: new Date(), closedAt: new Date() },
      })
    ).id;
    session = { userId: operatorId, organizationId: opsOrg, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: true } as SessionPayload;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  const status = async () => (await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: intentId } })).status;
  const audits = () => prisma.auditLog.findMany({ where: { action: "billing.checkout_released" } });

  it("süper-admin bırakır → kayıt 'released', işletmenin denetim kaydında operatör + işlem kimliği", async () => {
    const res = await POST(req({ intentId }));
    expect(res.status).toBe(200);
    expect(await status()).toBe("released");
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: orgId, actorUserId: operatorId });
    expect(rows[0]!.metadataJson).toContain("txn_1");
  });

  it("ikinci kez → 409 (artık beklemiyor), ikinci denetim kaydı yok; bilinmeyen kayıt → 404", async () => {
    await POST(req({ intentId }));
    const again = await POST(req({ intentId }));
    expect(again.status).toBe(409);
    expect(await audits()).toHaveLength(1);
    expect((await POST(req({ intentId: "yok" }))).status).toBe(404);
  });

  it.each([
    ["oturum yok", () => (session = null), 401],
    ["süper-admin değil", () => (session = { ...session!, email: "biri@x.com" }), 401],
    ["2FA'sız süper-admin", () => (session = { ...session!, mfa: false }), 401],
    ["destek görünümü (bürünme)", () => (session = { ...session!, actorUserId: operatorId, userId: "baskasi" }), 403],
  ])("🚨 %s → reddedilir, kayıt beklemeye devam eder", async (_label, arrange, code) => {
    arrange();
    const res = await POST(req({ intentId }));
    expect(res.status).toBe(code);
    expect(await status()).toBe("completed");
    expect(await audits()).toHaveLength(0);
  });

  it("site dışı istek → 403; JSON olmayan gövde → 415; kimliksiz gövde → 400", async () => {
    expect((await POST(req({ intentId }, { origin: "https://kotu.example", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(new NextRequest("http://localhost/api/admin/checkout-release", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }))).status).toBe(415);
    expect((await POST(req({}))).status).toBe(400);
    expect(await status()).toBe("completed");
  });
});
