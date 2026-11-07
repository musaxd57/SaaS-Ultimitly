import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — OPERATÖR DIŞA AKTARIMI: yalnız operatörün KENDİ hesabından (bürünme oturumu değil), 2FA'lı, AMAÇLA (kapalı
// küme) ve ZORUNLU kayıtla (hangi işletme · kim · ne zaman · amaç). Kayıt yazılamazsa indirme yok (ayrı dosya: kayıt arızası).
// `isSuperAdmin` GERÇEK (env allowlist + `mfa`); yalnız oturum enjeksiyonu mock'lanır.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET } from "@/app/api/admin/export/route";

const OPERATOR = "operator@lixusai.com";

async function seed() {
  const victim = await prisma.organization.create({ data: { name: "Kurban Konaklama" } });
  await prisma.property.create({ data: { organizationId: victim.id, name: "Lale 3" } });
  const opOrg = await prisma.organization.create({ data: { name: "Operatör Org" } });
  const op = await prisma.user.create({ data: { organizationId: opOrg.id, name: "Op", email: OPERATOR, passwordHash: "x", role: "owner" } });
  return { victimId: victim.id, opId: op.id, opOrgId: opOrg.id };
}

const req = (query: string) => new NextRequest(`http://localhost/api/admin/export?${query}`);
const exports = () => prisma.auditLog.findMany({ where: { action: "data.export" } });

describe("operatör dışa aktarımı — kurucu kararı 09-30", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 bürünme oturumundan (destek görünümü) dışa aktarma YOK — 403, veri ve kayıt yok", async () => {
    const { victimId, opId } = await seed();
    // Operatör müşteri hesabına bürünmüş: oturum müşterinin, gerçek kimlik `actor*` alanlarında; 2FA'lı.
    session = {
      userId: "customer-user",
      organizationId: victimId,
      role: "owner",
      email: "musteri@example.com",
      name: "Müşteri",
      sessionEpoch: 0,
      mfa: true,
      actorUserId: opId,
      actorEmail: OPERATOR,
      impersonatedAt: Math.floor(Date.now() / 1000),
    };
    const res = await GET(req(`orgId=${victimId}&purpose=support_request`));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("Kurban Konaklama");
    expect(await exports()).toHaveLength(0);
  });

  it("🚨 amaç yoksa / tanınmıyorsa 400 — veri ve kayıt yok", async () => {
    const { victimId, opId, opOrgId } = await seed();
    session = { userId: opId, organizationId: opOrgId, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: true };
    for (const q of [`orgId=${victimId}`, `orgId=${victimId}&purpose=merak`, `orgId=${victimId}&purpose=`]) {
      const res = await GET(req(q));
      expect([q, res.status]).toEqual([q, 400]);
      expect(await res.text()).not.toContain("Kurban Konaklama");
    }
    expect(await exports()).toHaveLength(0);
  });

  it("talep numarası dar biçimli (boşluk / @ / uzun reddedilir) — veri ve kayıt yok", async () => {
    const { victimId, opId, opOrgId } = await seed();
    session = { userId: opId, organizationId: opOrgId, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: true };
    for (const t of ["abc def", "a@b.com", "x".repeat(41)]) {
      const res = await GET(req(`orgId=${victimId}&purpose=support_request&ticket=${encodeURIComponent(t)}`));
      expect([t, res.status]).toEqual([t, 400]);
    }
    expect(await exports()).toHaveLength(0);
  });

  it("bilinmeyen işletme 400 — kayıt yazılmaz", async () => {
    const { opId, opOrgId } = await seed();
    session = { userId: opId, organizationId: opOrgId, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: true };
    const res = await GET(req(`orgId=yok-boyle-bir-org&purpose=support_request`));
    expect(res.status).toBe(400);
    expect(await exports()).toHaveLength(0);
  });

  it("🚨 operatörün kendi hesabı + 2FA + amaç → indirir; kayıt: hangi işletme · kim · ne zaman · amaç (+ talep no)", async () => {
    const { victimId, opId, opOrgId } = await seed();
    session = { userId: opId, organizationId: opOrgId, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: true };
    const before = Date.now();
    const res = await GET(req(`orgId=${victimId}&purpose=kvkk_request&ticket=KVKK-2026-14`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Kurban Konaklama");
    const rows = await exports();
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(victimId);
    expect(rows[0].actorUserId).toBe(opId);
    expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(JSON.parse(rows[0].metadataJson ?? "{}")).toEqual({ purpose: "kvkk_request", ticket: "KVKK-2026-14" });
    // Kayıt operatörün e-postasını TAŞIMAZ (müşterinin KVKK ihracına girer).
    expect(rows[0].metadataJson).not.toContain(OPERATOR);
  });

  it("KONTROL — 2FA'sız operatör oturumu 401 (kapı değişmedi)", async () => {
    const { victimId, opId, opOrgId } = await seed();
    session = { userId: opId, organizationId: opOrgId, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: false };
    expect((await GET(req(`orgId=${victimId}&purpose=support_request`))).status).toBe(401);
    expect(await exports()).toHaveLength(0);
  });
});
