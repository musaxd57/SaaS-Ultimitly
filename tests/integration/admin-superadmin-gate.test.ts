import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// OPERATÖR KAPISI — DAVRANIŞSAL PİN (`admin/export` + `admin/impersonate`)
//
// 🚨 BU DOSYANIN VAR OLMA SEBEBİ ÖLÇÜLDÜ (08-09): iki rotadan da
// `if (!isSuperAdmin(session)) return unauthorized();` satırı (ve artık kullanılmayan
// import'u) SİLİNDİ, ardından TÜM süit koşuldu → **3254 test YEŞİL**. Yani deponun
// en yıkıcı iki operatör rotasının tek yetkilendirme satırı hiçbir test tarafından
// tutulmuyordu:
//   · `admin/export`      → BİR org'un TÜM verisinin (misafir PII'si dahil) dökümü
//   · `admin/impersonate` → HERHANGİ bir müşteri org'una oturum devri
// Kimliği doğrulanmış SIRADAN bir müşteri, `?orgId=` / gövdeye başka bir org id'si
// yazarak ikisini de kullanabilirdi.
//
// Kaynak taraması bunu neden kaçırdı: `api-route-scoping.test.ts`in kapsam ölçütü
// düz `/organizationId/` metin taraması ve İKİ ROTA DA o dizgiyi taşıyor — ama
// değer İSTEKTEN geliyor, oturumdan DEĞİL. Yani ölçütü sağlayan şeyin ta kendisi
// kapsamın YOKLUĞUYDU. Yapısal taraf orada ayrıca düzeltildi; GERÇEK pin burası.
//
// ⚠️ `isSuperAdmin` BİLEREK MOCK'LANMIYOR — test edilen şey o. Yalnız oturum
// enjeksiyonu (`requireSession`) ve çerez yazan `enterOrganization` mock'lanır;
// karar katmanı GERÇEK `SUPERADMIN_EMAILS` env'i üzerinden koşar.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// `enterOrganization`ın gerçek gövdesi `setSessionCookie` → `next/headers` çağırır
// ve istek kapsamı dışında patlar. YALNIZ o fonksiyon mock'lanır; aynı modülden
// re-export edilen `isSuperAdmin` GERÇEK kalır (`orig()` ile).
const { enterOrganizationMock } = vi.hoisted(() => ({ enterOrganizationMock: vi.fn() }));
vi.mock("@/lib/admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/admin")>();
  return { ...actual, enterOrganization: enterOrganizationMock };
});

import { GET as exportGet } from "@/app/api/admin/export/route";
import { POST as impersonatePost } from "@/app/api/admin/impersonate/route";

const OPERATOR_EMAIL = "operator@lixusai.com";
const CUSTOMER_EMAIL = "musteri@example.com";

const exportReq = (orgId: string) =>
  new NextRequest(`http://localhost/api/admin/export?orgId=${encodeURIComponent(orgId)}`);

const impersonateReq = (organizationId: string) =>
  new NextRequest("http://localhost/api/admin/impersonate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });

/** Kurban kiracı: dökümde görünmesi gereken gerçek bir isim taşır. */
async function seedVictimOrg() {
  const org = await prisma.organization.create({ data: { name: "Kurban Konaklama" } });
  await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Manzara 3" } });
  return org;
}

/** Gerçek kullanıcı satırı — `AuditLog.actorUserId` FK'sı sahte id'yi düşürür. */
async function makeSession(email: string, mfa: boolean): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: `Org ${email}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "U", email, passwordHash: "x", role: "owner" },
  });
  return {
    userId: user.id,
    organizationId: org.id,
    role: "owner",
    email,
    name: "U",
    sessionEpoch: 0,
    mfa,
  };
}

describe("operatör kapısı: admin/export + admin/impersonate", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    session = null;
    enterOrganizationMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("admin/export — bir org'un TÜM verisinin dökümü", () => {
    it("oturumsuz istek 401", async () => {
      const victim = await seedVictimOrg();
      const res = await exportGet(exportReq(victim.id));
      expect(res.status).toBe(401);
    });

    it("🚨 SIRADAN müşteri BAŞKA org'un id'sini yazarsa 401 — ve döküm HİÇ KURULMAZ", async () => {
      const victim = await seedVictimOrg();
      session = await makeSession(CUSTOMER_EMAIL, true);

      const res = await exportGet(exportReq(victim.id));

      expect(res.status).toBe(401);
      // Yalnız durum kodu YETMEZ: asıl zarar PII'nin gövdeye girmesi. Kurbanın
      // adı yanıtın HİÇBİR yerinde geçmemeli.
      expect(await res.text()).not.toContain("Kurban Konaklama");
      // Ve iş HİÇ yapılmamalı: döküm kurulsaydı denetim satırı da yazılırdı.
      expect(await prisma.auditLog.count({ where: { action: "data.export" } })).toBe(0);
    });

    it("🚨 SUPERADMIN e-postası ama oturum ikinci faktörden GEÇMEMİŞSE 401", async () => {
      // `mfa` "hesapta 2FA var" değil, "BU OTURUM faktörden geçti" demek (08-05).
      const victim = await seedVictimOrg();
      session = await makeSession(OPERATOR_EMAIL, false);
      const res = await exportGet(exportReq(victim.id));
      expect(res.status).toBe(401);
      expect(await prisma.auditLog.count({ where: { action: "data.export" } })).toBe(0);
    });

    it("KONTROL: gerçek operatör (superadmin + mfa) dökümü ALIR", async () => {
      // Bu olmadan "her zaman 401" mutasyonu da yeşil geçerdi.
      const victim = await seedVictimOrg();
      session = await makeSession(OPERATOR_EMAIL, true);

      const res = await exportGet(exportReq(victim.id));

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Kurban Konaklama");
      expect(await prisma.auditLog.count({ where: { action: "data.export" } })).toBe(1);
    });
  });

  describe("admin/impersonate — müşteri org'una oturum devri", () => {
    it("oturumsuz istek 401 ve devir DENENMEZ", async () => {
      const victim = await seedVictimOrg();
      const res = await impersonatePost(impersonateReq(victim.id));
      expect(res.status).toBe(401);
      expect(enterOrganizationMock).not.toHaveBeenCalled();
    });

    it("🚨 SIRADAN müşteri 401 alır — ve `enterOrganization` HİÇ ÇAĞRILMAZ", async () => {
      // Asıl zarar durum kodu değil, ÇEREZİN DEĞİŞMESİ: çağrı gerçekleşirse
      // saldırganın oturumu kurbanın org'una geçmiş olur.
      const victim = await seedVictimOrg();
      session = await makeSession(CUSTOMER_EMAIL, true);

      const res = await impersonatePost(impersonateReq(victim.id));

      expect(res.status).toBe(401);
      expect(enterOrganizationMock).not.toHaveBeenCalled();
    });

    it("🚨 SUPERADMIN e-postası ama ikinci faktörsüz oturum 401 — devir yok", async () => {
      const victim = await seedVictimOrg();
      session = await makeSession(OPERATOR_EMAIL, false);
      const res = await impersonatePost(impersonateReq(victim.id));
      expect(res.status).toBe(401);
      expect(enterOrganizationMock).not.toHaveBeenCalled();
    });

    it("KONTROL: gerçek operatör (superadmin + mfa) hedef org'a girer", async () => {
      const victim = await seedVictimOrg();
      session = await makeSession(OPERATOR_EMAIL, true);

      const res = await impersonatePost(impersonateReq(victim.id));

      expect(res.status).toBe(200);
      expect(enterOrganizationMock).toHaveBeenCalledTimes(1);
      expect(enterOrganizationMock.mock.calls[0]?.[1]).toBe(victim.id);
    });
  });
});
