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
      // ⚠️ DÜRÜST GEREKÇE (denetim düzeltmesi 08-09). Önceki yorumum
      // "2FA'sız operatör + `mfa:true` üretimde OLUŞAMAZ" diyordu — YANLIŞTI ve
      // bir denetçi haklı olarak yakaladı: kişi 2FA açıkken giriş yapar
      // (`login` `true` damgalar), sonra 2FA'yı kapatır, `disable` epoch'u
      // ARTIRMAZ ve canlı oturum iddiayı taşımaya devam eder. ZATEN BU
      // DEĞİŞİKLİĞİN VAR OLMA SEBEBİ o durumdur.
      // Buradaki ekleme "o durum olamaz" demek değil: bu test
      // `SUPERADMIN_EMAILS`'ten silmenin etkisini ölçüyor ve tek değişken o
      // kalsın diye diğerini sabitliyoruz. Yeni boyut ayrı testlerle pinli.
      // ⚠️ Testin ASIL iddiası değişmedi: e-posta listedeyken oturum geçerli,
      // listeden çıkınca geçersiz.
      twoFactorEnabledAt: new Date(),
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
    // `mfa` ANAHTARI TAMAMEN YOK — eski (bayrak oncesi) token'in birebir sekli.
    // `mfa: false` ile ayni sey degil; ikisi ayri testte sinanir.
    const noMfa: Partial<SessionPayload> = { ...impersonationSession(s) };
    delete noMfa.mfa;
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

// ---------------------------------------------------------------------------
// 🚨 `mfa` İDDİASI FAKTÖR SİLİNDİKTEN SONRA YAŞAMAMALI (denetim 08-08/09).
//
// `isSuperAdmin` (`admin-core.ts:74`) operatör yetkisinin TEK kapısıdır ve
// `session.mfa === true` ister. Ama 2FA `disable` (`account/2fa/route.ts`)
// `sessionEpoch`'u ARTIRMIYOR — yani canlı oturumlar, artık HİÇ ikinci faktörü
// olmayan bir hesap için `mfa:true` iddia etmeye devam ediyordu. Süre de 14 gün
// DEĞİL: middleware her istekte çerezi yeniden imzaladığı için iddia,
// herhangi bir sayfaya dokunuldukça hiç sona ermiyor.
//
// ⚠️ ÇÖZÜM OTURUMU ÖLDÜRMEK DEĞİL, İDDİAYI DB'YE KARŞI YENİDEN DOĞRULAMAK.
// Epoch artırmak HERKESİ çıkışa atardı (2FA'yı kapatan sıradan müşteri dahil)
// oysa `mfa` yalnız OPERATÖR yetkisini açıyor — fayda dar, bedel genişti.
// Ek sorgu YOK: kullanıcı satırı zaten okunuyor, tek kolon eklendi.
// ---------------------------------------------------------------------------
describe("mfa iddiası — faktör kaldırılınca düşer", () => {
  // ⚠️ AYRI describe → dış `beforeEach` MİRAS ALINMAZ (aynı e-posta ikinci
  // `seed()`te unique çakışması veriyordu).
  beforeEach(async () => {
    await resetDb();
    currentSession = null;
    // İmpersonation testleri `isSuperAdmin`ten geçmeli; env stub'ı dış
    // describe'ta ve MİRAS ALINMIYOR.
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("2FA silinmiş hesapta `mfa:true` iddiası DÜŞER, oturum YAŞAR", async () => {
    const s = await seed();
    // Operatör 2FA'sını kapattı (twoFactorEnabledAt null) ama oturumu duruyor.
    await prisma.user.update({
      where: { id: s.operatorId },
      data: { twoFactorEnabledAt: null, twoFactorSecret: null },
    });
    currentSession = {
      userId: s.operatorId,
      organizationId: s.orgId,
      role: "owner",
      email: OPERATOR,
      name: "Operator",
      sessionEpoch: 1,
      mfa: true,
    };
    const out = await requireSession();
    // Oturum GEÇERLİ kalır — kimse çıkışa atılmaz.
    expect(out).not.toBeNull();
    // Ama operatör yetkisini açan iddia DÜŞMÜŞ olmalı.
    expect(out?.mfa).toBe(false);
  });

  // 🚨 AKTÖR DALI AYRICA PİNLENİR — mutasyonla ölçüldü: aktör kontrolünü
  // silmek yukarıdaki iki testi YEŞİL bırakıyordu, çünkü ikisi de
  // impersonation OLMAYAN dalı sınıyor. İmpersonation'da iddia MÜŞTERİNİN
  // değil OPERATÖRÜN satırından doğrulanmalı.
  it("impersonation: OPERATÖRÜN 2FA'sı kaldırılmışsa oturum REDDEDİLİR", async () => {
    const s = await seed();
    // Operatör 2FA'sını kapattı; müşteri (impersonate edilen) etkilenmedi.
    await prisma.user.update({
      where: { id: s.operatorId },
      data: { twoFactorEnabledAt: null, twoFactorSecret: null },
    });
    currentSession = impersonationSession(s);
    // İddia düşer → `isSuperAdmin` false → `api.ts` fail-closed → oturum YOK.
    expect(await requireSession()).toBeNull();
  });

  it("KONTROL: impersonation'da MÜŞTERİNİN 2FA'sı olmaması oturumu BOZMAZ", async () => {
    const s = await seed();
    // Müşterinin 2FA'sı yok (normal durum), operatörünki duruyor (seed'de set).
    await prisma.user.update({
      where: { id: s.customerId },
      data: { twoFactorEnabledAt: null },
    });
    currentSession = impersonationSession(s);
    const out = await requireSession();
    // Bu kontrol olmadan "müşteri satırına bak" mutasyonu sessizce geçerdi.
    expect(out).not.toBeNull();
    expect(out?.mfa).toBe(true);
  });

  // 🚨 LATENT BOŞLUK: `actorUserId` VAR ama `actorSessionEpoch` YOK olan token.
  // Aktör okuması `actorSessionEpoch !== undefined` istiyordu, yani böyle bir
  // token her iki dalın da dışında kalıp iddiayı HİÇ doğrulatmıyordu. Bugün
  // üretimde oluşamaz (`enterOrganization` epoch'u daima yazar) — ama iki
  // bağımsız denetçi de "bir sonraki düzenleyicinin tuzağı" dedi.
  // Yön FAIL-SAFE: doğrulayamıyorsak iddiayı VERMİYORUZ.
  it("epoch iddiası OLMAYAN impersonation token'ı iddiayı ALAMAZ (fail-safe)", async () => {
    const s = await seed();
    const legacy = impersonationSession(s);
    delete (legacy as { actorSessionEpoch?: number }).actorSessionEpoch;
    currentSession = legacy;
    // İddia doğrulanamadı → düşer → `isSuperAdmin` false → fail-closed → oturum yok.
    expect(await requireSession()).toBeNull();
  });

  it("KONTROL: 2FA HÂLÂ AÇIKKEN iddia KORUNUR", async () => {
    const s = await seed();
    await prisma.user.update({
      where: { id: s.operatorId },
      data: { twoFactorEnabledAt: new Date() },
    });
    currentSession = {
      userId: s.operatorId,
      organizationId: s.orgId,
      role: "owner",
      email: OPERATOR,
      name: "Operator",
      sessionEpoch: 1,
      mfa: true,
    };
    const out = await requireSession();
    expect(out?.mfa).toBe(true);
  });
});
