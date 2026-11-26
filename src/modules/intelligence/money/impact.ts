// ---------------------------------------------------------------------------
// V2 — PARA ETKİSİ (ilk dilim, 09-24). SAF: DB yok, ağ yok, LLM yok, `server-only` yok.
//
// Değişmez 15: para etkisi SAHTE KESİNLİK üretmez — her rakam varsayım + kanıt + güven + ARALIK taşır.
// Bu yüzden dönüş tipi ya bir ARALIKTIR (asla tek nokta değer) ya da "bilinmiyor"dur; "bilinmiyor"da hiçbir
// sayısal alan YOKTUR (tip düzeyinde).
//
// NEDEN YALNIZ ÇİFT REZERVASYON (ajan veri denetimi 09-24): bugün savunulabilir tek tutar budur. Rezervasyon
// tutarı alanları pratikte dolmuyor (sağlayıcıda `financials:read` yok; iCal tutar taşımaz; para birimi
// bilinmediğinde uydurma "EUR" yazılıyor) — bu modül rezervasyon tutarını ve para birimini HİÇ okumaz (pin).
// Tek kaynak, ev sahibinin kendi girdiği TİPİK GECELİK FİYAT ARALIĞIDIR (host verisi; kanal verisi değil →
// değişmez 14'ün kanal-veri politikasına girmez).
//
// FORMÜL (çakışan iki konaklamadan biri taşınmak zorunda):
//   alt = çakışan gece × aralığın ALTI      (en az kaybedilecek: yalnız çakışan geceler)
//   üst = en uzun etkilenen konaklama × ÜSTÜ (en çok: o konaklamanın tamamı iptal olursa)
// Platform cezaları ve misafiri taşıma masrafı DAHİL DEĞİL (varsayım kodu olarak taşınır). Rakamlar DIŞA
// doğru 2 anlamlı basamağa yuvarlanır (aralık daralmaz). Güven asla "high" değildir.
// ---------------------------------------------------------------------------

/** Ev sahibinin aralığı bu kadar gün sonra bayat sayılır (fiyatlar mevsimle değişir). */
export const RATE_STALE_DAYS = 180;
/** Kabul edilen para birimleri (kapalı küme; aralık hangisiyle girildiyse tutar o birimde). */
export const MONEY_CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;
export type MoneyCurrency = (typeof MONEY_CURRENCIES)[number];
/** Gecelik aralık üst sınırı (yazım hatası "3500000" gibi bir değer tahmini şişirmesin). */
export const RATE_MAX = 1_000_000;

export interface NightlyRateRange {
  low: number;
  high: number;
  currency: MoneyCurrency;
  /** Aralığın girildiği an (bayatlık bundan). */
  enteredAt: Date;
}

/** Kapalı küme varsayım kodları — arayüz bunları sade Türkçeye çevirir; metin burada üretilmez. */
export type MoneyAssumption =
  | "value_at_stake_not_loss"
  | "penalties_excluded"
  | "host_typical_rate"
  | "whole_stay_upper_bound";

export type MoneyUnknownReason = "no_rate" | "rate_stale" | "rate_invalid" | "duplicate_likely";

export type MoneyImpact =
  | {
      kind: "estimate";
      low: number;
      high: number;
      currency: MoneyCurrency;
      /** Asla "high": girdi ev sahibinin tipik aralığıdır, rezervasyonun gerçek tutarı değil. */
      confidence: "low" | "medium";
      assumptions: MoneyAssumption[];
      /** Kanıt: hesaba giren sayılar (PII yok). */
      evidence: { overlapNights: number; stayNights: number; rateEnteredAt: string };
    }
  | { kind: "unknown"; reason: MoneyUnknownReason }
  | { kind: "not_applicable" };

export interface ConflictMoneyInput {
  /** Çakışan gece sayısı (motorun yarı açık aralığından). */
  overlapNights: number;
  /** Çakışmadaki en uzun konaklamanın gece sayısı. */
  longestStayNights: number;
  /** İki kayıt birebir aynı tarihli: muhtemelen AYNI konaklama iki kaynaktan — tutar yok. */
  possibleDuplicate: boolean;
  /** Çakışmada onay bekleyen bir talep var (kesinleşmiş çift rezervasyon değil) → güven düşük. */
  heldRequest: boolean;
  /** Kayıtların hiçbiri taze kaynaktan/host girişinden gelmiyor (hayalet satır olabilir) → güven düşük. */
  allUnconfirmed: boolean;
}

const DAY_MS = 86_400_000;

/** Aralık geçerli mi: sonlu, pozitif, alt < üst, tavan altında, kapalı-küme para birimi, geçerli tarih. */
export function isValidRate(r: unknown): r is NightlyRateRange {
  if (!r || typeof r !== "object") return false;
  const x = r as Partial<NightlyRateRange>;
  return (
    typeof x.low === "number" &&
    typeof x.high === "number" &&
    Number.isFinite(x.low) &&
    Number.isFinite(x.high) &&
    x.low > 0 &&
    x.high > x.low &&
    x.high <= RATE_MAX &&
    (MONEY_CURRENCIES as readonly string[]).includes(x.currency as string) &&
    x.enteredAt instanceof Date &&
    Number.isFinite(x.enteredAt.getTime())
  );
}

/** Aşağı doğru 2 anlamlı basamak (8.250 → 8.200). */
export function roundDown2(x: number): number {
  if (x <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.floor(x / step) * step;
}

/** Yukarı doğru 2 anlamlı basamak (11.050 → 12.000). */
export function roundUp2(x: number): number {
  if (x <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / step) * step;
}

/** Çift rezervasyonda risk altındaki tutar — değişmez 15'in sözleşmesiyle. */
export function estimateConflictImpact(
  input: ConflictMoneyInput,
  rate: NightlyRateRange | null | undefined,
  now: Date,
): MoneyImpact {
  if (input.possibleDuplicate) return { kind: "unknown", reason: "duplicate_likely" };
  if (!rate) return { kind: "unknown", reason: "no_rate" };
  if (!isValidRate(rate)) return { kind: "unknown", reason: "rate_invalid" };
  if (now.getTime() - rate.enteredAt.getTime() > RATE_STALE_DAYS * DAY_MS) return { kind: "unknown", reason: "rate_stale" };
  const overlap = Math.max(1, Math.floor(input.overlapNights));
  const stay = Math.max(overlap, Math.floor(input.longestStayNights));
  const low = roundDown2(overlap * rate.low);
  const high = roundUp2(stay * rate.high);
  const assumptions: MoneyAssumption[] = ["value_at_stake_not_loss", "penalties_excluded", "host_typical_rate"];
  if (stay > overlap) assumptions.push("whole_stay_upper_bound");
  return {
    kind: "estimate",
    low,
    high,
    currency: rate.currency,
    confidence: input.heldRequest || input.allUnconfirmed ? "low" : "medium",
    assumptions,
    evidence: { overlapNights: overlap, stayNights: stay, rateEnteredAt: rate.enteredAt.toISOString() },
  };
}
