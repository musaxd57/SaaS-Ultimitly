import { describe, it, expect } from "vitest";
import { isDisposableEmail, trialRisk, UNVERIFIED_GRACE_MS } from "@/lib/billing/trial-risk";

// ---------------------------------------------------------------------------
// DENEME RİSK PUANI (kurucu onayı 10-10: geçici e-posta + doğrulanmamış e-posta; yalnız operatör listesi, otomatik işlem yok).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-10T12:00:00Z");
const owner = (email: string, verified: boolean, ageMs: number) => ({
  email,
  emailVerifiedAt: verified ? new Date(NOW.getTime() - ageMs + 60_000) : null,
  createdAt: new Date(NOW.getTime() - ageMs),
});

describe("geçici e-posta", () => {
  it("bilinen servis ve alt alan adı tanınır; büyük harf / sondaki nokta fark etmez", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@X.Mailinator.COM.")).toBe(true);
    expect(isDisposableEmail("a@yopmail.fr")).toBe(true);
  });

  it("KONTROL: sıradan servis / şirket alanı / benzer ad / bozuk adres geçici sayılmaz", () => {
    expect(isDisposableEmail("a@gmail.com")).toBe(false);
    expect(isDisposableEmail("a@ornekkiralama.com.tr")).toBe(false);
    expect(isDisposableEmail("a@notmailinator.com")).toBe(false);
    expect(isDisposableEmail("a@mailinator.com.ornek.tr")).toBe(false);
    expect(isDisposableEmail("mailinator.com")).toBe(false);
  });
});

describe("risk puanı", () => {
  it("KONTROL: doğrulanmış sıradan hesap → 0, sebep yok", () => {
    expect(trialRisk({ owners: [owner("a@gmail.com", true, 3 * UNVERIFIED_GRACE_MS)], identityReused: false, now: NOW })).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("geçici e-posta + 24 saatten eski doğrulanmamış hesap → 40; ilan kuralı da tetiklendiyse 100", () => {
    const o = [owner("a@mailinator.com", false, UNVERIFIED_GRACE_MS + 1)];
    expect(trialRisk({ owners: o, identityReused: false, now: NOW })).toEqual({ score: 40, reasons: ["disposable_email", "email_unverified"] });
    expect(trialRisk({ owners: o, identityReused: true, now: NOW }).score).toBe(100);
  });

  it("KONTROL: kayıttan hemen sonra doğrulanmamış olmak sinyal değil (24 saat payı, sınırda sayılır)", () => {
    expect(trialRisk({ owners: [owner("a@gmail.com", false, UNVERIFIED_GRACE_MS - 1)], identityReused: false, now: NOW }).score).toBe(0);
    expect(trialRisk({ owners: [owner("a@gmail.com", false, UNVERIFIED_GRACE_MS)], identityReused: false, now: NOW }).reasons).toEqual([
      "email_unverified",
    ]);
  });

  it("sahiplerden biri yeter; her sebep BİR kez sayılır", () => {
    const owners = [owner("a@gmail.com", true, 1), owner("b@yopmail.com", false, 2 * UNVERIFIED_GRACE_MS), owner("c@yopmail.com", false, 2 * UNVERIFIED_GRACE_MS)];
    expect(trialRisk({ owners, identityReused: false, now: NOW })).toEqual({ score: 40, reasons: ["disposable_email", "email_unverified"] });
  });
});
