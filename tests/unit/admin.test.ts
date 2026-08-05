import { describe, it, expect, afterEach, vi } from "vitest";
import { isSuperAdmin, isImpersonating, actorEmail } from "@/lib/admin";
import type { SessionPayload } from "@/lib/auth";

// ⚠️ `mfa: true` 08-05'te EKLENDİ. Operatör yetkisi artık yalnız e-posta
// eşleşmesine değil, BU OTURUMUN ikinci faktörden geçmiş olmasına da bağlı
// (Airbnb partner şartı: personel API'ye MFA ile erişir). Aşağıdaki testler
// yetkinin VERİLDİĞİ durumları ölçtüğü için taban payload artık iddiayı taşır;
// iddianın YOKLUĞUNU ölçen testler ayrı blokta (↓"ikinci faktör").
const base: SessionPayload = {
  userId: "u1",
  organizationId: "org1",
  role: "owner",
  email: "Operator@Example.com",
  name: "Operator",
  sessionEpoch: 0,
  mfa: true,
};

afterEach(() => vi.unstubAllEnvs());

describe("operator panel authorization", () => {
  it("grants super-admin only to configured emails (case-insensitive)", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com, boss@x.com");
    expect(isSuperAdmin(base)).toBe(true);
    expect(isSuperAdmin({ ...base, email: "someone@else.com" })).toBe(false);
  });

  it("denies everyone when SUPERADMIN_EMAILS is empty (safe default)", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "");
    expect(isSuperAdmin(base)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it("judges super-admin on the REAL operator (actor) while impersonating", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    // Impersonating: session email is the CUSTOMER, actor is the operator.
    const impersonated: SessionPayload = {
      ...base,
      email: "customer@client.com",
      organizationId: "org2",
      actorUserId: "u1",
      actorEmail: "operator@example.com",
      actorName: "Operator",
    };
    expect(isSuperAdmin(impersonated)).toBe(true); // keeps powers while impersonating
    expect(actorEmail(impersonated)).toBe("operator@example.com");
    expect(isImpersonating(impersonated)).toBe(true);
    expect(isImpersonating(base)).toBe(false);
  });

  it("a non-super-admin customer cannot become super-admin by impersonation fields", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    // A customer whose actorEmail is NOT in the allowlist stays denied.
    const sneaky: SessionPayload = {
      ...base,
      email: "customer@client.com",
      actorEmail: "customer@client.com",
      actorUserId: "u9",
    };
    expect(isSuperAdmin(sneaky)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OPERATÖR YETKİSİ İKİNCİ FAKTÖR İSTER (08-05).
//
// Airbnb API şartı: "your organization must ensure that its personnel use
// multi-factor authentication to access the API Client, Scopes and Content".
// Bugüne kadar 2FA tamamen opt-in'di ve `SUPERADMIN_EMAILS`'teki bir hesap
// yalnız ŞİFREYLE tüm müşteri org'larına impersonation ile girebiliyordu.
//
// ⚠️ Kapı `isSuperAdmin`'İN İÇİNDE, çağıranlarda DEĞİL. 13 çağrı yeri var
// (6 admin rotası + `requireSession` + 3 Hospitable rotası + 3 sayfa); ayrı bir
// `superAdminAllowed()` eklemek "biri unutulur" sınıfına girerdi — bu repo o
// dersi `api-route-scoping.test.ts` ile zaten ödedi. Tek boğaz noktası,
// unutulması imkânsız.
//
// ⚠️ GİRİŞİ ENGELLEMEZ. Kapı yalnız YETKİYİ tutar; 2FA'sız bir operatör normal
// owner olarak girer. Bu kasıtlı: girişi engellemek, authenticator'ını kaybeden
// tek operatörü kendi ürününden kilitlerdi ve kurtarma yolu (`admin/reset-2fa`)
// zaten superadmin oturumu istiyor — dairesel kilit.
// ---------------------------------------------------------------------------
describe("operatör yetkisi ikinci faktör ister", () => {
  it("İDDİA YOKSA yetki YOK — eski token'lar yeniden giriş ister", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    const { mfa: _drop, ...legacy } = base;
    expect(isSuperAdmin(legacy as SessionPayload)).toBe(false);
  });

  it("İDDİA FALSE ise yetki YOK (şifreyle giriş, ikinci faktör yok)", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    expect(isSuperAdmin({ ...base, mfa: false })).toBe(false);
  });

  it("İDDİA TRUE + e-posta eşleşmesi → yetki VAR", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    expect(isSuperAdmin({ ...base, mfa: true })).toBe(true);
  });

  it("TERS YÖN: iddia tek başına YETMEZ — e-posta listede olmalı", () => {
    // Kapıyı "yalnız mfa" hâline getiren bir mutasyon buradan kırmızıya döner.
    vi.stubEnv("SUPERADMIN_EMAILS", "baskasi@example.com");
    expect(isSuperAdmin({ ...base, mfa: true })).toBe(false);
  });

  it("impersonation'da da iddia ARANIR (gerçek operatörün oturumu üzerinden)", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    const impersonating: SessionPayload = {
      ...base,
      email: "customer@client.com",
      organizationId: "org2",
      actorUserId: "u1",
      actorEmail: "operator@example.com",
      actorName: "Operator",
    };
    expect(isSuperAdmin(impersonating)).toBe(true);
    // Aynı oturum iddiasız → müşteri org'unda operatör yetkisi YOK.
    expect(isSuperAdmin({ ...impersonating, mfa: false })).toBe(false);
  });
});
