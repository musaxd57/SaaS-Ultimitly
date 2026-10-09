import { addNights, nightsBetween, todayKey, type NightKey } from "@/modules/availability/core";
import { foldTurkishAscii } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// PRAGMATİK TARİH ÇÖZÜMÜ (kurucu talimatı 09-07, "PRAGMATIC DATE RESOLUTION") — SAF, deterministik, DB / ağ / saat yok.
//
// Talimatın sırası: açık tarih metni → konuşmadaki açık tarih bilgisi (ay) → org diliminde göreli ifade → bağlı rezervasyon →
// tek belirgin en yakın gelecek yorumu. Sonuç YAPILANDIRILMIŞ üst veri taşır: tarihler, dilim, dayanak, güven, varsayılan parça.
// Birden çok makul yorum kalırsa `ambiguous` + seçenekler → çağıran TEK kısa netleştirme sorusu sorar; tahmin edilmez.
//
// Kapsam (bilinçli dar, Türkçe öncelikli): TR + EN. Tanınmayan biçim "none"dur, asla uydurulmuş bir tarih değil.
// Bilinen sınırlar (bilinçli): "ocak" aynı zamanda "fırın ocağı", "Nisan" bir ad, EN "may" bir yardımcı fiil — sayıyla bitişik
// yazılınca ("2 ocak") tarih okunur; modül bugün hiçbir karara bağlı değil, bağlanırken bu sınırlar ölçülür.
//   · tam tarih: 2026-10-14 · 14.10.2026 · 14/10/2026 · 14 Ekim 2026 · October 14, 2026
//   · gün + ay: 14 Ekim · 14 October · Oct 14 · 14.10  → yıl VARSAYILIR (en yakın gelecek), güven orta
//   · yalnız gün: "ayın 3'ü", "the 3rd" → BELİRSİZ (ay bilinmiyor; talimat senaryo 8) — konuşmada açık bir ay varsa o ay
//   · göreli: bugün / bu akşam / bu gece / yarın / öbür gün · today / tonight / tomorrow / day after tomorrow
//   · hafta günü: (bu) cuma · this friday → en yakın; "gelecek / haftaya / next" → BELİRSİZ (bu hafta mı, sonraki mi)
//   · rezervasyon: giriş günü / çıkış günü · check-in day / check-out day
// "/" ile yazılmış iki sayı (ikisi de ≤ 12, farklı) gün/ay sırası belirsizdir (3/4 = 3 Nisan mı 4 Mart mı) → BELİRSİZ.
//
// 🚨 Bu modül bugün HİÇBİR isteme / misafir cevabına BAĞLI DEĞİL (talimat: sözleşmeler doğrulanmadan etkinleştirilmez).
// Misafir metnine uygulanır → kalıplar sınırlı (`\d{1,2}`, sabit kelimeler), boşluklar önce teke indirilir (karesel iş yok;
// süre pini `date-resolution.test.ts`).
// ---------------------------------------------------------------------------

export type DateBasis = "explicit_full" | "explicit_day_month" | "conversation_month" | "relative" | "weekday" | "reservation";
export type DateConfidence = "high" | "medium" | "low";
export type AssumedPart = "year" | "month";

export interface DateResolutionContext {
  now: Date;
  timeZone: string;
  /** Bağlı rezervasyonun giriş / çıkış günü (mülk dilimi). */
  reservation?: { arrival: NightKey; departure: NightKey } | null;
  /** Aynı konuşmada daha önce AÇIKÇA yazılmış tarihler (çağıran bu modülle çözüp verir) — yalnız ay bilgisi kullanılır. */
  conversationDates?: readonly NightKey[];
}

export interface DateResolution {
  status: "resolved" | "ambiguous" | "none";
  /** Çözülen günler (sıralı, tekil). `ambiguous` iken yalnız kesin çözülenler. */
  dates: NightKey[];
  /** En zayıf dayanak (birden çok tarih varsa). */
  basis: DateBasis | null;
  confidence: DateConfidence;
  assumed: AssumedPart[];
  timeZone: string;
  today: NightKey;
  /** Belirsiz parçanın makul yorumları (her biri ayrı bir gün). */
  alternatives: NightKey[];
  /** Kapalı küme gerekçeler. */
  reasons: string[];
}

/** Misafir metninin işlenen en fazla uzunluğu (tarih ifadesi mesajın başındadır; tavan karesel girdiyi de keser). */
export const DATE_RESOLUTION_MAX_CHARS = 4_000;
/** Yıl varsayımı bundan uzağa düşerse güven düşük (misafir geçmiş bir günü anıyor olabilir). */
const FAR_ASSUMPTION_NIGHTS = 300;

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11,
  december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const WEEKDAYS: Record<string, number> = {
  pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6, pazar: 0,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
};
const WEEKDAY_ALT = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");

// Türkçe ek: "14 ekim'de", "3'u", "15'inde" (kesme düz / kıvrık; katlamadan sonra ASCII).
const SUFFIX = "(?:['’]?[a-z]{0,6})?";

const RE_ISO = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
const RE_NUMERIC = /\b(\d{1,2})([./])(\d{1,2})(?:\2(20\d{2}|\d{2}))?\b/g;
const RE_DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?${SUFFIX} (?:of )?(${MONTH_ALT})\\b(?:${SUFFIX},? (20\\d{2}))?`, "g");
const RE_MONTH_DAY = new RegExp(`\\b(${MONTH_ALT})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (20\\d{2}))?`, "g");
const RE_DAY_ONLY_TR = new RegExp(`\\bayin (\\d{1,2})${SUFFIX}(?: (?:ile|ve|-) (\\d{1,2})${SUFFIX})?`, "g");
const RE_DAY_ONLY_EN = /\bthe (\d{1,2})(?:st|nd|rd|th)\b(?: (?:and|or|to|-) (?:the )?(\d{1,2})(?:st|nd|rd|th)?)?/g;
const RE_RELATIVE: readonly [RegExp, number][] = [
  [/\b(?:obur gun|yarindan sonra|day after tomorrow)\b/g, 2],
  [/\b(?:yarin|tomorrow)\b/g, 1],
  [/\b(?:bugun|bu aksam|bu gece|today|tonight|this evening)\b/g, 0],
];
const RE_WEEKDAY = new RegExp(`\\b(?:(bu|this|gelecek|haftaya|onumuzdeki|next) )?(${WEEKDAY_ALT})\\b( gunu)?`, "g");
const RE_RES_ARRIVAL = /\b(?:giris gunu|giriste|varis gunu|check-?in day|arrival day|on arrival)\b/g;
const RE_RES_DEPARTURE = /\b(?:cikis gunu|check-?out day|departure day)\b/g;

interface Piece {
  dates: NightKey[];
  alternatives: NightKey[];
  basis: DateBasis;
  confidence: DateConfidence;
  assumed: AssumedPart[];
  reasons: string[];
  ambiguous: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function keyOf(y: number, m: number, d: number): NightKey | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // 31 Şubat yok
  return `${y}-${pad(m)}-${pad(d)}`;
}
function fullYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}
/** Yıl verilmemiş gün + ay → en yakın gelecek (bugün dahil). */
function nearestFuture(today: NightKey, m: number, d: number): NightKey | null {
  const y = Number(today.slice(0, 4));
  const thisYear = keyOf(y, m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return keyOf(y + 1, m, d);
}
function dayMonthPiece(today: NightKey, m: number, d: number, year: number | null, basis: DateBasis): Piece | null {
  if (year !== null) {
    const k = keyOf(year, m, d);
    return k ? { dates: [k], alternatives: [], basis, confidence: "high", assumed: [], reasons: [], ambiguous: false } : null;
  }
  const k = nearestFuture(today, m, d);
  if (!k) return null;
  const far = nightsBetween(today, k) > FAR_ASSUMPTION_NIGHTS;
  return {
    dates: [k],
    alternatives: [],
    basis: basis === "explicit_full" ? "explicit_day_month" : basis,
    confidence: far ? "low" : "medium",
    assumed: ["year"],
    reasons: far ? ["far_future_assumption"] : [],
    ambiguous: false,
  };
}
/** Ayı bilinmeyen gün: önümüzdeki iki geçerli ay başı (bugünden itibaren) seçenek; konuşmada ay varsa o ay. */
function dayOnlyPiece(today: NightKey, day: number, conversationMonth: { y: number; m: number } | null): Piece | null {
  if (conversationMonth) {
    const k = keyOf(conversationMonth.y, conversationMonth.m, day);
    if (k) return { dates: [k], alternatives: [], basis: "conversation_month", confidence: "medium", assumed: [], reasons: [], ambiguous: false };
  }
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const alts: NightKey[] = [];
  for (let i = 0; i < 3 && alts.length < 2; i++) {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    const k = keyOf(yy, mm, day);
    if (k && k >= today) alts.push(k);
  }
  if (alts.length === 0) return null;
  return { dates: [], alternatives: alts, basis: "explicit_day_month", confidence: "low", assumed: ["month", "year"], reasons: ["day_without_month"], ambiguous: true };
}
function weekdayFrom(today: NightKey, target: number): NightKey {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addNights(today, (target - dow + 7) % 7);
}

const CONF_ORDER: Record<DateConfidence, number> = { high: 2, medium: 1, low: 0 };
const BASIS_ORDER: Record<DateBasis, number> = {
  explicit_full: 5,
  reservation: 4,
  relative: 4,
  explicit_day_month: 3,
  weekday: 2,
  conversation_month: 1,
};

export function resolveGuestDates(text: string | null | undefined, ctx: DateResolutionContext): DateResolution {
  const today = todayKey(ctx.now, ctx.timeZone);
  const t = foldTurkishAscii(String(text ?? "").slice(0, DATE_RESOLUTION_MAX_CHARS)).replace(/\s+/g, " ");
  const pieces: Piece[] = [];
  const consumed: [number, number][] = [];
  const free = (i: number, len: number) => !consumed.some(([a, b]) => i < b && i + len > a);
  const take = (m: RegExpMatchArray) => consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);

  const convMonth = (() => {
    const last = [...(ctx.conversationDates ?? [])].sort().at(-1);
    return last ? { y: Number(last.slice(0, 4)), m: Number(last.slice(5, 7)) } : null;
  })();

  for (const m of t.matchAll(RE_ISO)) {
    const k = keyOf(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!k || !free(m.index ?? 0, m[0].length)) continue;
    take(m);
    pieces.push({ dates: [k], alternatives: [], basis: "explicit_full", confidence: "high", assumed: [], reasons: [], ambiguous: false });
  }
  for (const m of t.matchAll(RE_DAY_MONTH)) {
    if (!free(m.index ?? 0, m[0].length)) continue;
    const p = dayMonthPiece(today, MONTHS[m[2]], Number(m[1]), m[3] ? fullYear(m[3]) : null, "explicit_full");
    if (!p) continue;
    take(m);
    pieces.push(p);
  }
  for (const m of t.matchAll(RE_MONTH_DAY)) {
    if (!free(m.index ?? 0, m[0].length)) continue;
    const p = dayMonthPiece(today, MONTHS[m[1]], Number(m[2]), m[3] ? fullYear(m[3]) : null, "explicit_full");
    if (!p) continue;
    take(m);
    pieces.push(p);
  }
  for (const m of t.matchAll(RE_NUMERIC)) {
    if (!free(m.index ?? 0, m[0].length)) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const year = m[4] ? fullYear(m[4]) : null;
    // Yılsız biçimde İKİNCİ parça iki haneli olmalı ("14.10", "03/11"): "1.5 saat", "2.5 kişi", "3/4 kişi" gibi ondalık ve
    // kesirler tarih SAYILMAZ. "11.30" / "14.45" saattir: ikinci parça > 12 olunca ay olamaz → keyOf zaten reddeder.
    if (year === null && m[3].length !== 2) continue;
    const dayFirst = dayMonthPiece(today, b, a, year, "explicit_full");
    const monthFirst = m[2] === "/" && a !== b && a <= 12 && b <= 12 ? dayMonthPiece(today, a, b, year, "explicit_full") : null;
    if (!dayFirst && !monthFirst) continue;
    take(m);
    if (dayFirst && monthFirst) {
      pieces.push({
        dates: [],
        alternatives: [...new Set([...dayFirst.dates, ...monthFirst.dates])].sort(),
        basis: "explicit_day_month",
        confidence: "low",
        assumed: year === null ? ["year"] : [],
        reasons: ["numeric_order_ambiguous"],
        ambiguous: true,
      });
    } else pieces.push((dayFirst ?? monthFirst) as Piece);
  }
  for (const re of [RE_DAY_ONLY_TR, RE_DAY_ONLY_EN]) {
    for (const m of t.matchAll(re)) {
      if (!free(m.index ?? 0, m[0].length)) continue;
      take(m);
      for (const d of [m[1], m[2]].filter(Boolean)) {
        const p = dayOnlyPiece(today, Number(d), convMonth);
        if (p) pieces.push(p);
      }
    }
  }
  for (const [re, offset] of RE_RELATIVE) {
    for (const m of t.matchAll(re)) {
      if (!free(m.index ?? 0, m[0].length)) continue;
      take(m);
      pieces.push({ dates: [addNights(today, offset)], alternatives: [], basis: "relative", confidence: "high", assumed: [], reasons: [], ambiguous: false });
    }
  }
  for (const m of t.matchAll(RE_WEEKDAY)) {
    if (!free(m.index ?? 0, m[0].length)) continue;
    const prefix = m[1] ?? null;
    const name = m[2];
    // "pazar" aynı zamanda "çarşı / pazar yeri" demek: yalnız önek ya da "günü" ile gün sayılır.
    if (name === "pazar" && !prefix && !m[3]) continue;
    take(m);
    const first = weekdayFrom(today, WEEKDAYS[name]);
    if (prefix === "gelecek" || prefix === "haftaya" || prefix === "next") {
      const alts = [...new Set([first === today ? addNights(first, 7) : first, addNights(first, first === today ? 14 : 7)])].sort();
      pieces.push({ dates: [], alternatives: alts, basis: "weekday", confidence: "low", assumed: [], reasons: ["next_weekday_ambiguous"], ambiguous: true });
    } else {
      pieces.push({ dates: [first], alternatives: [], basis: "weekday", confidence: "medium", assumed: [], reasons: [], ambiguous: false });
    }
  }
  for (const [re, side] of [[RE_RES_ARRIVAL, "arrival"], [RE_RES_DEPARTURE, "departure"]] as const) {
    for (const m of t.matchAll(re)) {
      if (!free(m.index ?? 0, m[0].length)) continue;
      take(m);
      const k = ctx.reservation?.[side] ?? null;
      pieces.push(
        k
          ? { dates: [k], alternatives: [], basis: "reservation", confidence: "high", assumed: [], reasons: [], ambiguous: false }
          : { dates: [], alternatives: [], basis: "reservation", confidence: "low", assumed: [], reasons: ["reservation_unknown"], ambiguous: true },
      );
    }
  }

  if (pieces.length === 0) {
    return { status: "none", dates: [], basis: null, confidence: "low", assumed: [], timeZone: ctx.timeZone, today, alternatives: [], reasons: [] };
  }
  const ambiguous = pieces.some((p) => p.ambiguous);
  const weakest = pieces.reduce((a, b) => (CONF_ORDER[b.confidence] < CONF_ORDER[a.confidence] ? b : a));
  const weakestBasis = pieces.reduce((a, b) => (BASIS_ORDER[b.basis] < BASIS_ORDER[a.basis] ? b : a));
  return {
    status: ambiguous ? "ambiguous" : "resolved",
    dates: [...new Set(pieces.flatMap((p) => p.dates))].sort(),
    basis: weakestBasis.basis,
    confidence: ambiguous ? "low" : weakest.confidence,
    assumed: [...new Set(pieces.flatMap((p) => p.assumed))].sort() as AssumedPart[],
    timeZone: ctx.timeZone,
    today,
    alternatives: [...new Set(pieces.flatMap((p) => p.alternatives))].sort(),
    reasons: [...new Set(pieces.flatMap((p) => p.reasons))].sort(),
  };
}
