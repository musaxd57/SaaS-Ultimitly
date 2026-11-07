import { describe, it, expect, afterEach, vi } from "vitest";
import { cardGateReasons, cardGateRequired, cardTrialPriceIds, trialCardGateEnabled } from "@/lib/billing/trial-card-gate";
import { trialRisk, type TrialRisk } from "@/lib/billing/trial-risk";

// ---------------------------------------------------------------------------
// Kartla deneme kapısı (kurucu 10-17) — SAF kurallar. Ağ / IP sinyalleri kapıda SAYILMAZ (aydınlatma cümlesi Q3 "otomatik karar verilmez");
// deneme süreli fiyatlar tanımlı değilse kapı HİÇ çalışmaz ("ücret alınmaz" metninin altında anında tahsilli ödeme açılmasın).
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());
const risk = (reasons: TrialRisk["reasons"]): TrialRisk => ({ score: 0, reasons });

describe("cardGateRequired", () => {
  it.each([
    [["identity_reused"], true], // 60 — tek başına yüksek
    [["mailbox_shared", "disposable_email"], true], // 70
    [["mailbox_shared", "email_unverified"], false], // 50 — orta
    [["disposable_email", "email_unverified"], false], // 40
    [[], false],
  ] as const)("%j → %s", (reasons, expected) => {
    expect(cardGateRequired(risk([...reasons]))).toBe(expected);
  });

  it("🚨 AĞ / IP sinyalleri sayılmaz: operatör puanı yüksek (mailbox 40 + ip 20 = 60) olsa da kart İSTENMEZ", () => {
    const r = trialRisk({
      owners: [],
      identityReused: false,
      mailboxShared: true,
      network: { ipShared: true, networkBurst: false },
      now: new Date(),
    });
    expect(r.score).toBe(60); // operatör listesinde "yüksek"
    expect(cardGateReasons(r)).toEqual(["mailbox_shared"]);
    expect(cardGateRequired(r)).toBe(false);
  });
});

describe("trialCardGateEnabled", () => {
  it("anahtar açık ama deneme süreli fiyatlardan biri eksik → KAPALI; üçü tanımlı → açık", () => {
    vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_client_token");
    vi.stubEnv("PADDLE_PRICE_BASLANGIC_DENEME", "pri_b_t");
    vi.stubEnv("PADDLE_PRICE_PRO_DENEME", "pri_p_t");
    vi.stubEnv("PADDLE_PRICE_ISLETME_DENEME", "");
    expect(trialCardGateEnabled()).toBe(false);
    vi.stubEnv("PADDLE_PRICE_ISLETME_DENEME", "pri_i_t");
    expect(trialCardGateEnabled()).toBe(true);
    expect(cardTrialPriceIds()).toEqual({ free: "pri_b_t", pro: "pri_p_t", business: "pri_i_t" });
    vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "true"); // yalnız "1"
    expect(trialCardGateEnabled()).toBe(false);
    // Haiku 10-17: ödeme penceresi istemci anahtarı yoksa "Kart ekle" çizilemez → kapı KAPALI (kart eklenemeyen kilit olmasın).
    vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "");
    expect(trialCardGateEnabled()).toBe(false);
  });
});
