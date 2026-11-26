import { describe, it, expect } from "vitest";
import {
  isDisposableEmail,
  NETWORK_RISK_REASONS,
  riskyTrials,
  RISK_LIST_RECENT_MS,
  trialRisk,
  trialRiskBand,
  trialRiskWeight,
  UNVERIFIED_GRACE_MS,
} from "@/lib/billing/trial-risk";

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

  it("🚨 KONTROL: doğrulama zorunluluğundan (2026-06-15) ÖNCE açılmış doğrulanmamış hesap sinyal DEĞİL (ondan doğrulama hiç istenmedi)", () => {
    const legacy = { email: "a@gmail.com", emailVerifiedAt: null, createdAt: new Date("2026-06-01T00:00:00Z") };
    expect(trialRisk({ owners: [legacy], identityReused: false, now: NOW }).score).toBe(0);
  });
});

describe("operatör listesi (riskyTrials)", () => {
  const sub = (provider: string, endsInMs: number | null, reason: string | null = null) => ({
    provider,
    trialEndsAt: endsInMs === null ? null : new Date(NOW.getTime() + endsInMs),
    trialEndReason: reason,
  });
  const org = (id: string, ageMs: number, subscription: ReturnType<typeof sub> | null) => ({ id, createdAt: new Date(NOW.getTime() - ageMs), subscription });
  const risky = [owner("x@mailinator.com", true, 1)];

  it("🚨 K1-B (10-17): yeni işaret (trialIdentityReusedAt, deneme sürüyor) ilan sebebi sayılır; ağ sinyalleri harita üzerinden puana girer", () => {
    const clean = [owner("a@gmail.com", true, 1)];
    const orgs = [
      { ...org("flagged", 1, sub("trial", 86_400_000)), trialIdentityReusedAt: new Date(NOW.getTime() - 60_000) },
      { ...org("net", 2, sub("trial", 86_400_000)), trialIdentityReusedAt: null },
      { ...org("plain", 3, sub("trial", 86_400_000)), trialIdentityReusedAt: null },
    ];
    const owners = new Map([
      ["flagged", clean],
      ["net", clean],
      ["plain", clean],
    ]);
    const network = new Map([["net", { ipShared: true, networkBurst: true }]]);
    expect(riskyTrials(orgs, owners, NOW, new Set(), network).map((r) => [r.org.id, r.risk.score, r.risk.reasons])).toEqual([
      ["flagged", 60, ["identity_reused"]],
      ["net", 35, ["ip_shared", "network_burst"]],
    ]);
    // KONTROL: harita verilmezse (anahtar kapalı) ağ sinyali yok.
    expect(riskyTrials(orgs, owners, NOW).map((r) => r.org.id)).toEqual(["flagged"]);
  });

  it("yalnız deneme hesapları; süren ya da son 30 günde biten; puanı 0 olan yok; puana göre azalan, eşitlikte en yeni önce", () => {
    const orgs = [
      org("paid", 1, sub("paddle", 5 * 86_400_000)), // ödeme yapan — listede yok
      org("old-expired", 1, sub("trial", -(RISK_LIST_RECENT_MS + 1))), // 30 günden önce bitmiş — yok
      org("clean", 1, sub("trial", 86_400_000)), // puan 0 — yok
      org("reused", 3, sub("trial", 0, "identity_reused")), // 60 + 30
      org("temp-old", 5, sub("trial", 86_400_000)), // 30
      org("temp-new", 2, sub("trial", -RISK_LIST_RECENT_MS)), // 30 (sınırda — listede), daha yeni
      org("nosub", 1, null),
    ];
    const owners = new Map([
      ["paid", risky],
      ["old-expired", risky],
      ["clean", [owner("a@gmail.com", true, 1)]],
      ["reused", risky],
      ["temp-old", risky],
      ["temp-new", risky],
      ["nosub", risky],
    ]);
    expect(riskyTrials(orgs, owners, NOW).map((r) => [r.org.id, r.risk.score])).toEqual([
      ["reused", 90],
      ["temp-new", 30],
      ["temp-old", 30],
    ]);
  });
});

describe("ortak posta kutusu (deneme araştırması 10-15, dilim 1)", () => {
  it("🚨 kanonik kutusu başka işletmede olan deneme → 'mailbox_shared' (40), sıralamada önde; KONTROL: ortak değilse sebep yok", () => {
    const o = [owner("a@gmail.com", true, 3 * UNVERIFIED_GRACE_MS)];
    expect(trialRisk({ owners: o, identityReused: false, mailboxShared: true, now: NOW })).toEqual({ score: 40, reasons: ["mailbox_shared"] });
    expect(trialRisk({ owners: o, identityReused: false, mailboxShared: false, now: NOW }).reasons).toEqual([]);
    const sub = { provider: "trial", trialEndsAt: new Date(NOW.getTime() + 86_400_000), trialEndReason: null };
    const orgs = [
      { id: "o1", createdAt: new Date(NOW.getTime() - 1000), subscription: sub },
      { id: "o2", createdAt: new Date(NOW.getTime() - 2000), subscription: sub },
    ];
    const owners = new Map([
      ["o1", o],
      ["o2", o],
    ]);
    const rows = riskyTrials(orgs, owners, NOW, new Set(["o2"]));
    expect(rows.map((r) => [r.org.id, r.risk.score])).toEqual([["o2", 40]]);
  });
});

describe("K1 kayıt ağı sinyalleri (kurucu 10-17: 'IP'lere bakılsın; otomatik kesme yok')", () => {
  const owners = [{ email: "a@example.com", emailVerifiedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z") }];
  const now = new Date("2026-10-17T00:00:00Z");

  it("🚨 DEĞİŞMEZ: ağ sinyallerinin HER alt kümesi tek başına 'yüksek' banda (≥ 60) ulaşamaz", () => {
    for (const ipShared of [false, true]) {
      for (const networkBurst of [false, true]) {
        const r = trialRisk({ owners, identityReused: false, network: { ipShared, networkBurst }, now });
        expect(r.score).toBeLessThan(60);
        expect(trialRiskBand(r.score)).not.toBe("high");
      }
    }
    expect(NETWORK_RISK_REASONS.reduce((n, r) => n + trialRiskWeight(r), 0)).toBeLessThan(60);
  });

  it("aynı adres → ip_shared (20); aynı ağda çok kayıt → network_burst (15); ikisi + geçici e-posta → orta band", () => {
    expect(trialRisk({ owners, identityReused: false, network: { ipShared: true, networkBurst: false }, now })).toEqual({ score: 20, reasons: ["ip_shared"] });
    expect(trialRisk({ owners, identityReused: false, network: { ipShared: false, networkBurst: true }, now })).toEqual({ score: 15, reasons: ["network_burst"] });
    const both = trialRisk({ owners: [{ ...owners[0]!, email: "x@mailinator.com" }], identityReused: false, network: { ipShared: true, networkBurst: true }, now });
    expect(both).toEqual({ score: 65, reasons: ["disposable_email", "ip_shared", "network_burst"] });
    expect(trialRiskBand(both.score)).toBe("high");
    expect(trialRiskBand(35)).toBe("medium");
    expect(trialRiskBand(10)).toBe("low");
    expect(trialRiskBand(0)).toBeNull();
  });

  it("KONTROL: ağ bilgisi verilmezse (anahtar kapalı) puan bugünkü gibi", () => {
    expect(trialRisk({ owners, identityReused: false, now })).toEqual({ score: 0, reasons: [] });
  });
});
