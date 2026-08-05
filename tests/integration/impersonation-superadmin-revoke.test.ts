import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// SÜPER-ADMİN YETKİSİ HER İSTEKTE YENİDEN DOĞRULANIR.
// (Siber güvenlik denetimi, 2026-08-01 — beşinci tur, ajan bulgusu; Codex
// sıralamasında "migration'sız kapatılacaklar" arasında.)
//
// Impersonation oturumu bir kez basıldıktan sonra süper-admin yetkisi hiçbir
// yerde tekrar kontrol edilmiyordu: bir e-postayı `SUPERADMIN_EMAILS`'ten
// SİLMEK açık oturumları SONLANDIRMIYORDU. Middleware token'ı her istekte 14 gün
// uzattığı için kişi, ekipten ayrıldıktan sonra bile müşteri org'unda OWNER
// yetkisiyle (misafir PII'si, ayarlar, faturalandırma) süresiz çalışabiliyordu.
// Env'den silmek etkili bir iptal aracı OLMALI.
//
// ⚠️ Yön FAIL-CLOSED: yetki yoksa oturum yok. Normal (impersonation OLMAYAN)
// müşteri oturumu bundan ETKİLENMEZ — aşağıda ayrıca pinli.
// ---------------------------------------------------------------------------

let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => currentSession) };
});

import { requireSession } from "@/lib/api";

const OPERATOR = "ops@lixusai.com";

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Customer Org" } });
  const customer = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "customer@x.com",
      name: "Customer",
      passwordHash: "x",
      role: "owner",
      sessionEpoch: 1,
    },
  });
  const operator = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: OPERATOR,
      name: "Operator",
      passwordHash: "x",
      role: "owner",
      sessionEpoch: 1,
    },
  });
  return { orgId: org.id, customerId: customer.id, operatorId: operator.id };
}

function impersonationSession(s: {
  orgId: string;
  customerId: string;
  operatorId: string;
}): SessionPayload {
  return {
    userId: s.customerId,
    organizationId: s.orgId,
    role: "owner",
    email: "customer@x.com",
    name: "Customer",
    sessionEpoch: 1,
    actorUserId: s.operatorId,
    actorEmail: OPERATOR,
    actorName: "Operator",
    actorSessionEpoch: 1,
    // ⚠️ 08-05: operatör yetkisi artık BU OTURUMUN ikinci faktörden geçmiş
    // olmasını da istiyor. İddiasız bir impersonation oturumu `requireSession`
    // tarafından KOMPLE reddedilir (api.ts:54 fail-closed) — burada ölçülen şey
    // env'den silmenin etkisi olduğu için taban oturum iddiayı taşır.
    mfa: true,
  } as SessionPayload;
}

describe("impersonation — süper-admin yetkisi her istekte doğrulanır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    currentSession = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("yetki DURUYORSA oturum geçerli (regresyon pini)", async () => {
    const s = await seed();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    currentSession = impersonationSession(s);
    expect(await requireSession()).not.toBeNull();
  });

  it("e-posta SUPERADMIN_EMAILS'ten SİLİNİNCE oturum DÜŞER", async () => {
    const s = await seed();
    vi.stubEnv("SUPERADMIN_EMAILS", "someone-else@lixusai.com");
    currentSession = impersonationSession(s);
    expect(await requireSession()).toBeNull(); // ⬅️ ARIZADA süresiz geçerliydi
  });

  it("liste tamamen BOŞALINCA da düşer (fail-closed)", async () => {
    const s = await seed();
    vi.stubEnv("SUPERADMIN_EMAILS", "");
    currentSession = impersonationSession(s);
    expect(await requireSession()).toBeNull();
  });

  it("NORMAL müşteri oturumu bundan ETKİLENMEZ (yanlış-pozitif pini)", async () => {
    const s = await seed();
    vi.stubEnv("SUPERADMIN_EMAILS", ""); // hiç operatör yok
    currentSession = {
      userId: s.customerId,
      organizationId: s.orgId,
      role: "owner",
      email: "customer@x.com",
      name: "Customer",
      sessionEpoch: 1,
    } as SessionPayload;
    expect(await requireSession()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// İKİNCİ FAKTÖR OLMADAN İMPERSONATION OTURUMU HİÇ GEÇERLİ DEĞİL (08-05).
//
// `api.ts:54` operatör yetkisini her istekte fail-closed doğruluyor. Yetki
// artık `mfa` iddiasını da istediğine göre, ikinci faktörden geçmemiş bir
// impersonation oturumu YETKİ KAYBIYLA değil OTURUM KAYBIYLA sonuçlanır —
// yani operatör müşteri org'unda "yetkisiz ama içeride" kalmaz.
// ---------------------------------------------------------------------------
describe("impersonation — ikinci faktör olmadan oturum yok", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    currentSession = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("mfa iddiası YOKSA impersonation oturumu düşer (yetki dururken bile)", async () => {
    const s = await seed();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR); // e-posta HÂLÂ listede
    const { mfa: _drop, ...noMfa } = impersonationSession(s);
    currentSession = noMfa as SessionPayload;
    expect(await requireSession()).toBeNull();
  });

  it("mfa iddiası FALSE ise de düşer", async () => {
    const s = await seed();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    currentSession = { ...impersonationSession(s), mfa: false };
    expect(await requireSession()).toBeNull();
  });
});
