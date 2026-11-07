import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// OPERATÖR YAZMA ROTALARI — SİTE DIŞI / JSON OLMAYAN İSTEK KOTAYA DOKUNMAZ (Tur 3, 11-04).
//
// Altı operatör yazma rotasında sıra "oturum → operatör → bürünme → hız sınırı → gövde" idi; site dışı ya da JSON olmayan istek de
// operatörün saatlik kovasını harcıyordu (Codex 11-04'te hesap rotalarında düzeltilen hatanın aynısı). Artık site dışı → 403, JSON olmayan
// → 415, ikisi de kovaya girmeden. `isSuperAdmin` gerçek (yalnız oturum enjekte edilir).
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { enterOrganizationMock } = vi.hoisted(() => ({ enterOrganizationMock: vi.fn() }));
vi.mock("@/lib/admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/admin")>();
  return { ...actual, enterOrganization: enterOrganizationMock };
});

import { POST as reset2fa } from "@/app/api/admin/reset-2fa/route";
import { POST as impersonate } from "@/app/api/admin/impersonate/route";
import { POST as trialEnd } from "@/app/api/admin/trial-end/route";
import { POST as customers } from "@/app/api/admin/customers/route";
import { POST as trialExempt } from "@/app/api/admin/trial-identity-exempt/route";
import { PATCH as leadPatch } from "@/app/api/admin/leads/[id]/route";

const OPERATOR_EMAIL = "operator@lixusai.com";

type Handler = (req: NextRequest) => Promise<Response>;
const ROUTES: [string, string, Handler][] = [
  ["admin/reset-2fa", "POST", (r) => reset2fa(r)],
  ["admin/impersonate", "POST", (r) => impersonate(r)],
  ["admin/trial-end", "POST", (r) => trialEnd(r)],
  ["admin/customers", "POST", (r) => customers(r)],
  ["admin/trial-identity-exempt", "POST", (r) => trialExempt(r)],
  ["admin/leads/[id]", "PATCH", (r) => leadPatch(r, { params: Promise.resolve({ id: "lead-x" }) })],
];

const req = (path: string, method: string, headers: Record<string, string>) =>
  new NextRequest(`http://localhost/api/${path.replace("[id]", "lead-x")}`, { method, headers, body: JSON.stringify({}) });

describe("operatör yazma rotaları — site dışı / JSON olmayan istek kovadan önce reddedilir", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    const org = await prisma.organization.create({ data: { name: "Op Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0, mfa: true } as SessionPayload;
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(ROUTES)("%s: site dışı → 403, JSON olmayan → 415; hız sınırı satırı açılmaz", async (path, method, handler) => {
    const cross = await handler(req(path, method, { "content-type": "application/json", "sec-fetch-site": "cross-site" }));
    expect(cross.status).toBe(403);
    const plain = await handler(req(path, method, { "content-type": "text/plain" }));
    expect(plain.status).toBe(415);
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  });

  it("KONTROL: aynı site + JSON istek kapıyı geçer (kova satırı açılır ya da gövde denetimine ulaşılır, 403 / 415 DEĞİL)", async () => {
    for (const [path, method, handler] of ROUTES) {
      const res = await handler(req(path, method, { "content-type": "application/json", "sec-fetch-site": "same-origin" }));
      expect([403, 415], path).not.toContain(res.status);
    }
  });
});
