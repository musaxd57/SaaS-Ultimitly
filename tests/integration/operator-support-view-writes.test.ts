import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DESTEK GÖRÜNÜMÜNDE OPERATÖR YAZMASI YOK — önce çıkış (kurucu kararı 10-11, karar listesi 22). Bürünmüşken operatör paneli
// yazmaları (2FA sıfırlama, müşteri açma, lead güncelleme, kalite denetimi, başka hesaba geçiş, deneme istisnası) sade bir iletiyle
// reddedilir ve veritabanı değişmez; aynı operatör KENDİ oturumunda aynı işlemi yapar. Gerçek `requireSession` (yalnız `getSession` taklit).
// ---------------------------------------------------------------------------

let currentSession: SessionPayload | null = null;
// Hesaba giriş (`enterOrganization`) oturum çerezini yazar — istek kapsamı dışında `cookies()` taklit edilir.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => currentSession) };
});

import { POST as reset2fa } from "@/app/api/admin/reset-2fa/route";
import { POST as createCustomer } from "@/app/api/admin/customers/route";
import { PATCH as patchLead } from "@/app/api/admin/leads/[id]/route";
import { POST as qualityAudit } from "@/app/api/admin/quality-audit/route";
import { POST as impersonate } from "@/app/api/admin/impersonate/route";
import { POST as trialExempt } from "@/app/api/admin/trial-identity-exempt/route";
import { POST as trialEnd } from "@/app/api/admin/trial-end/route";
import { OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";

const OPERATOR = "ops@lixusai.com";
const nowSec = () => Math.floor(Date.now() / 1000);

let operatorSelf: SessionPayload;
let supportView: SessionPayload;
let customerOrgId: string;
let leadId: string;

async function seed() {
  const opOrg = await prisma.organization.create({ data: { name: "Lixus" } });
  const operator = await prisma.user.create({
    data: { organizationId: opOrg.id, email: OPERATOR, name: "Operatör", passwordHash: "x", role: "owner", sessionEpoch: 1, twoFactorEnabledAt: new Date() },
  });
  const org = await prisma.organization.create({ data: { name: "Müşteri Org" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, email: "owner@x.com", name: "Sahip", passwordHash: "x", role: "owner", sessionEpoch: 1, twoFactorEnabledAt: new Date(), twoFactorSecret: "enc" },
  });
  const lead = await prisma.lead.create({ data: { name: "Aday", email: "aday@x.com", status: "new" } });
  customerOrgId = org.id;
  leadId = lead.id;
  operatorSelf = { userId: operator.id, organizationId: opOrg.id, role: "owner", email: OPERATOR, name: "Operatör", sessionEpoch: 1, mfa: true };
  supportView = {
    userId: owner.id,
    organizationId: org.id,
    role: "owner",
    email: owner.email,
    name: "Sahip",
    sessionEpoch: 1,
    actorUserId: operator.id,
    actorEmail: OPERATOR,
    actorName: "Operatör",
    actorSessionEpoch: 1,
    mfa: true,
    impersonatedAt: nowSec() - 60,
  };
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const calls = () => [
  ["reset-2fa", () => reset2fa(json("http://localhost/api/admin/reset-2fa", "POST", { email: "owner@x.com" }))],
  [
    "customers",
    () =>
      createCustomer(
        json("http://localhost/api/admin/customers", "POST", { organizationName: "Yeni", name: "Yeni", email: "yeni@x.com", password: "Cok-Guclu-Parola-2026" }),
      ),
  ],
  ["leads PATCH", () => patchLead(json(`http://localhost/api/admin/leads/${leadId}`, "PATCH", { status: "contacted" }), { params: Promise.resolve({ id: leadId }) })],
  ["quality-audit", () => qualityAudit(json("http://localhost/api/admin/quality-audit", "POST", {}))],
  ["impersonate", () => impersonate(json("http://localhost/api/admin/impersonate", "POST", { organizationId: customerOrgId }))],
  ["trial-identity-exempt", () => trialExempt(json("http://localhost/api/admin/trial-identity-exempt", "POST", { organizationId: customerOrgId }))],
  ["trial-end", () => trialEnd(json("http://localhost/api/admin/trial-end", "POST", { organizationId: customerOrgId, action: "end" }))],
] as const;

describe("destek görünümünde operatör paneli yazmaları kapalı (kurucu kararı 10-11)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    await seed();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    currentSession = null;
  });

  it("🚨 bürünmüşken her operatör yazması 403 + 'önce çıkın' iletisi; veritabanı DEĞİŞMEZ", async () => {
    currentSession = supportView;
    for (const [name, call] of calls()) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect(((await res.json()) as { error: string }).error, name).toBe(OPERATOR_SUPPORT_VIEW_MESSAGE);
    }
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@x.com" } });
    expect(owner.twoFactorEnabledAt).not.toBeNull(); // 2FA sıfırlanmadı
    expect(await prisma.organization.count()).toBe(2); // müşteri açılmadı
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("new");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: customerOrgId } })).trialIdentityExempt).toBe(false);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("KONTROL: aynı operatör KENDİ oturumunda yazabilir (2FA sıfırlama + lead + deneme istisnası + hesaba giriş)", async () => {
    currentSession = operatorSelf;
    expect((await reset2fa(json("http://localhost/api/admin/reset-2fa", "POST", { email: "owner@x.com" }))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "owner@x.com" } })).twoFactorEnabledAt).toBeNull();
    expect(
      (await patchLead(json(`http://localhost/api/admin/leads/${leadId}`, "PATCH", { status: "contacted" }), { params: Promise.resolve({ id: leadId }) })).status,
    ).toBe(200);
    expect((await trialExempt(json("http://localhost/api/admin/trial-identity-exempt", "POST", { organizationId: customerOrgId }))).status).toBe(200);
    // Süren deneme yok → 409 (yetki geçti; yazma kapısı değil iş kuralı).
    expect((await trialEnd(json("http://localhost/api/admin/trial-end", "POST", { organizationId: customerOrgId, action: "end" }))).status).toBe(409);
    expect((await impersonate(json("http://localhost/api/admin/impersonate", "POST", { organizationId: customerOrgId }))).status).toBe(200);
  });
});
