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
//   · aralık: 15-17 Ekim · 14 ve 16 Ekim · 15th-17th October · October 15th-17th → iki uç da
//   · ilgi hâli: Ekim'in 15'i · aysız sıra: 15'inde → BELİRSİZ
//   · hafta günü: (bu) cuma · this friday → en yakın; "gelecek / haftaya / next / bir sonraki" ya da araya "hafta / week"
//     girerse BELİRSİZ (bu hafta mı, sonraki mi); hafta sonu / this weekend → Cumartesi + Pazar
//   · rezervasyon: giriş günü / çıkış günü · check-in day / check-out day ("girişte" / "on arrival" YER ya da ZAMAN değil → yok)
// Tutarlılık (inceleme 10-09): açık tarihle çelişen hafta günü ("15 Ekim Cuma", 15 Ekim Perşembe) ve açık tarihle farklı göreli
// gün ("yarın, 15 Ekim") BELİRSİZ; tutarlıysa tek gün kalır. Geçmiş gün çözülür ama `past_date` gerekçesi taşır.
// Yanlış pozitif kısıtları: "saat 10.12", "1.10 TL", "10/10 hizmet", "cuma namazı", "Salı pazarı", "the 1st floor" tarih DEĞİL.
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

// Türkçe ek: "14 ekim'de", "3'u", "15'inde" (kesme düz / kıvrık; katlamadan sonra ASCII). Hepsi SINIRLI tekrar.
const SUFFIX = "(?:['’]?[a-z]{0,6})?";
const ORD = "(?:st|nd|rd|th)?";
const YEAR_TAIL = `(?:${SUFFIX}(?:, ?| )(20\\d{2}))?`;
const RANGE_SEP = "(?: ?[-–] ?| (?:ile|ve|ila|to|and) )";

const RE_ISO = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
const RE_NUMERIC = /\b(\d{1,2})([./])(\d{1,2})(?:\2(20\d{2}|\d{2}))?\b/g;
const RE_RANGE_DAY_MONTH = new RegExp(`\\b(\\d{1,2})${ORD}${SUFFIX}${RANGE_SEP}(\\d{1,2})${ORD}${SUFFIX} (?:of )?(${MONTH_ALT})\\b${YEAR_TAIL}`, "g");
/** Virgüllü gün listesi + ay: "14, 15 ve 16 Ekim" (her gün; liste en çok 7 öğe). */
const RE_LIST_DAY_MONTH = new RegExp(`\\b(\\d{1,2}(?:, ?\\d{1,2}){1,6})(?:,? (?:ve|and|ile) (\\d{1,2}))? (?:of )?(${MONTH_ALT})\\b`, "g");
const RE_RANGE_MONTH_DAY = new RegExp(`\\b(${MONTH_ALT})\\.? (\\d{1,2})${ORD}${RANGE_SEP}(\\d{1,2})${ORD}\\b(?:(?:, ?| )(20\\d{2}))?`, "g");
const RE_DAY_MONTH = new RegExp(`\\b(\\d{1,2})${ORD}${SUFFIX} (?:of )?(${MONTH_ALT})\\b${YEAR_TAIL}`, "g");
const RE_MONTH_DAY = new RegExp(`\\b(${MONTH_ALT})\\.? (\\d{1,2})${ORD}\\b(?:(?:, ?| )(20\\d{2}))?`, "g");
const RE_MONTH_GEN_DAY = new RegExp(`\\b(${MONTH_ALT})['’]?n?[iu]n (\\d{1,2})\\b`, "g");
const RE_DAY_ONLY_TR = new RegExp(`\\bayin (\\d{1,2})${SUFFIX}(?:( ?[-–] ?| (?:ile|ve|ila) | )(\\d{1,2})(['’][a-z]{1,6})?)?`, "g");
const RE_DAY_ORDINAL_TR = /\b(\d{1,2})['’](?:n?[iu]nde|s[iu]nde)\b/g;
const RE_DAY_ONLY_EN = /\bthe (\d{1,2})(?:st|nd|rd|th)\b(?: (?:and|or|to|-) (?:the )?(\d{1,2})(?:st|nd|rd|th)?)?/g;
/** "the 1st floor": sıra sayısından sonra gelen bu sözcükler tarihi değil BAŞKA bir şeyi sayar. */
const EN_ORDINAL_NOUNS = new Set(["floor", "time", "person", "people", "guest", "guests", "night", "nights", "room", "bedroom", "stop", "exit", "door", "day", "week", "one", "place", "row", "level", "building", "entrance", "car", "cars", "key", "keys", "parking", "spot", "bag", "bags", "bed", "beds", "bathroom", "flat", "apartment", "unit", "option", "photo", "house"]);
const RE_RELATIVE: readonly [RegExp, number][] = [
  [/\b(?:obur gun|yarindan sonra|day after tomorrow)\b/g, 2],
  [/\b(?:yarin|tomorrow)\b/g, 1],
  [/\b(?:bugun|bu aksam|bu gece|today|tonight|this evening)\b/g, 0],
];
const RE_WEEKEND = /\b(?:(bu|this|gelecek|haftaya|onumuzdeki|next) )?(hafta sonu|weekend)\b/g;
const RE_WEEKDAY = new RegExp(
  `\\b(?:(bu|this|gelecek|haftaya|onumuzdeki|next|bir sonraki)(?: (hafta(?:nin)?|week(?:'s)?))? )?(${WEEKDAY_ALT})\\b( gunu)?`,
  "g",
);
/** Hafta günü adından sonra gelince gün DEĞİL: "cuma namazı", "salı pazarı". Sonraki sözcük EŞLEŞMEYE KATILMAZ (tur 4: "cuma yarın"
 *  "yarın"ı yutup göreli günle çakışmayı gizliyordu) — eşleşmenin ardındaki metne bakılır. */
const WEEKDAY_NOT_A_DAY_NEXT = /^ (?:namaz|pazar)/;
const NEXT_WORD = /^ ([a-z]+)/;
const NEXT_WEEK_PREFIXES = new Set(["gelecek", "haftaya", "next", "bir sonraki"]);
const RE_RES_ARRIVAL = /\b(?:giris gunu|varis gunu|check-?in day|arrival day)\b/g;
const RE_RES_DEPARTURE = /\b(?:cikis gunu|check-?out day|departure day)\b/g;
/** Yılsız sayısal biçimin önünde / ardında bunlar varsa saat, para ya da puandır. */
const NUMERIC_TIME_BEFORE = /saat ?$/;
const NUMERIC_NOT_DATE_AFTER = /^ ?(?:tl|lira|try|eur|euro|usd|dolar|puan|hizmet|indirim|fark|ucret|fiyat|kdv|[$€])/;

type PieceKind = "explicit" | "relative" | "weekday" | "weekend" | "reservation" | "day_only";

interface Piece {
  kind: PieceKind;
  dates: NightKey[];
  alternatives: NightKey[];
  basis: DateBasis;
  confidence: DateConfidence;
  assumed: AssumedPart[];
  reasons: string[];
  ambiguous: boolean;
  /** Yalnız hafta günü parçası: istenen gün (0 = Pazar). */
  dow?: number;
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
function dowOf(k: NightKey): number {
  return new Date(`${k}T00:00:00Z`).getUTCDay();
}
function fullYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}
/** Yıl verilmemiş gün + ay → en yakın gelecek (bugün dahil); 29 Şubat bir sonraki artık yıla kadar aranır. */
function nearestFuture(today: NightKey, m: number, d: number): NightKey | null {
  const y = Number(today.slice(0, 4));
  for (let i = 0; i <= 8; i++) {
    const k = keyOf(y + i, m, d);
    if (k && k >= today) return k;
  }
  return null;
}
function definite(kind: PieceKind, k: NightKey, basis: DateBasis, confidence: DateConfidence, assumed: AssumedPart[] = [], reasons: string[] = []): Piece {
  return { kind, dates: [k], alternatives: [], basis, confidence, assumed, reasons, ambiguous: false };
}
function dayMonthPiece(today: NightKey, m: number, d: number, year: number | null): Piece | null {
  if (year !== null) {
    const k = keyOf(year, m, d);
    return k ? definite("explicit", k, "explicit_full", "high") : null;
  }
  const k = nearestFuture(today, m, d);
  if (!k) return null;
  const far = nightsBetween(today, k) > FAR_ASSUMPTION_NIGHTS;
  return definite("explicit", k, "explicit_day_month", far ? "low" : "medium", ["year"], far ? ["far_future_assumption"] : []);
}
/** Ayı bilinmeyen gün: bugünden itibaren önümüzdeki iki geçerli ay seçenek; konuşmada ay varsa o ay. */
function dayOnlyPiece(today: NightKey, day: number, conversationMonth: { y: number; m: number } | null): Piece | null {
  if (conversationMonth) {
    const k = keyOf(conversationMonth.y, conversationMonth.m, day);
    if (k) return definite("day_only", k, "conversation_month", "medium");
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
  return { kind: "day_only", dates: [], alternatives: alts, basis: "explicit_day_month", confidence: "low", assumed: ["month", "year"], reasons: ["day_without_month"], ambiguous: true };
}
function weekdayFrom(today: NightKey, target: number): NightKey {
  return addNights(today, (target - dowOf(today) + 7) % 7);
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
  let pieces: Piece[] = [];
  const consumed: [number, number][] = [];
  const free = (m: RegExpMatchArray) => {
    const i = m.index ?? 0;
    return !consumed.some(([a, b]) => i < b && i + m[0].length > a);
  };
  const take = (m: RegExpMatchArray) => consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const push = (m: RegExpMatchArray, ...ps: (Piece | null)[]) => {
    const ok = ps.filter((p): p is Piece => p !== null);
    if (ok.length === 0) return;
    take(m);
    pieces.push(...ok);
  };

  // Konuşmada EN SON anılan açık tarih (sıra = çağıranın verdiği sıra; inceleme 10-09 #15).
  const lastConv = ctx.conversationDates && ctx.conversationDates.length > 0 ? ctx.conversationDates[ctx.conversationDates.length - 1] : null;
  const convMonth = lastConv ? { y: Number(lastConv.slice(0, 4)), m: Number(lastConv.slice(5, 7)) } : null;

  for (const m of t.matchAll(RE_ISO)) {
    if (!free(m)) continue;
    const k = keyOf(Number(m[1]), Number(m[2]), Number(m[3]));
    push(m, k ? definite("explicit", k, "explicit_full", "high") : null);
  }
  for (const m of t.matchAll(RE_LIST_DAY_MONTH)) {
    if (!free(m)) continue;
    const days = [...m[1].split(",").map((x) => x.trim()), ...(m[2] ? [m[2]] : [])];
    const ps = days.map((d) => dayMonthPiece(today, MONTHS[m[3]], Number(d), null));
    if (ps.every((p) => p !== null)) push(m, ...ps);
  }
  for (const m of t.matchAll(RE_RANGE_DAY_MONTH)) {
    if (!free(m)) continue;
    const year = m[4] ? fullYear(m[4]) : null;
    const a = dayMonthPiece(today, MONTHS[m[3]], Number(m[1]), year);
    const b = dayMonthPiece(today, MONTHS[m[3]], Number(m[2]), year);
    if (a && b) push(m, a, b);
  }
  for (const m of t.matchAll(RE_RANGE_MONTH_DAY)) {
    if (!free(m)) continue;
    const year = m[4] ? fullYear(m[4]) : null;
    const a = dayMonthPiece(today, MONTHS[m[1]], Number(m[2]), year);
    const b = dayMonthPiece(today, MONTHS[m[1]], Number(m[3]), year);
    if (a && b) push(m, a, b);
  }
  for (const m of t.matchAll(RE_DAY_MONTH)) {
    if (free(m)) push(m, dayMonthPiece(today, MONTHS[m[2]], Number(m[1]), m[3] ? fullYear(m[3]) : null));
  }
  for (const m of t.matchAll(RE_MONTH_DAY)) {
    if (free(m)) push(m, dayMonthPiece(today, MONTHS[m[1]], Number(m[2]), m[3] ? fullYear(m[3]) : null));
  }
  for (const m of t.matchAll(RE_MONTH_GEN_DAY)) {
    if (free(m)) push(m, dayMonthPiece(today, MONTHS[m[1]], Number(m[2]), null));
  }
  for (const m of t.matchAll(RE_NUMERIC)) {
    if (!free(m)) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const year = m[4] ? fullYear(m[4]) : null;
    if (year === null) {
      // İkinci parça iki haneli olmalı ("14.10"): "1.5 saat", "2.5 kişi", "3/4 kişi" ondalık / kesirdir.
      if (m[3].length !== 2) continue;
      const i = m.index ?? 0;
      // "saat 10.12", "1.10 TL", "10/10 hizmet": saat, para, puan (inceleme 10-09 #9).
      if (NUMERIC_TIME_BEFORE.test(t.slice(Math.max(0, i - 6), i)) || NUMERIC_NOT_DATE_AFTER.test(t.slice(i + m[0].length, i + m[0].length + 8))) continue;
    }
    const dayFirst = dayMonthPiece(today, b, a, year);
    // 🚨 Noktalı YILSIZ biçim saat de olabilir ("9.10'da gelirim", "14.10'da" = 14:10; inceleme 10-09 tur 4): tarih SEÇENEĞİ, karar değil.
    if (year === null && m[2] === "." && dayFirst) {
      take(m);
      pieces.push({ kind: "explicit", dates: [], alternatives: dayFirst.dates, basis: "explicit_day_month", confidence: "low", assumed: ["year"], reasons: ["dotted_time_or_date"], ambiguous: true });
      continue;
    }
    const monthFirst = m[2] === "/" && a !== b && a <= 12 && b <= 12 ? dayMonthPiece(today, a, b, year) : null;
    if (dayFirst && monthFirst) {
      take(m);
      pieces.push({
        kind: "explicit",
        dates: [],
        alternatives: [...new Set([...dayFirst.dates, ...monthFirst.dates])].sort(),
        basis: "explicit_day_month",
        confidence: "low",
        assumed: year === null ? ["year"] : [],
        reasons: ["numeric_order_ambiguous"],
        ambiguous: true,
      });
    } else push(m, dayFirst ?? monthFirst);
  }
  for (const m of t.matchAll(RE_DAY_ONLY_TR)) {
    if (!free(m)) continue;
    const days = [m[1]];
    // İkinci gün yalnız bir bağlaçla ("ile / ve / -") ya da kendi ekiyle ("3'ünden 5'ine") yazıldıysa.
    if (m[3] && ((m[2] ?? "").trim() !== "" || m[4])) days.push(m[3]);
    push(m, ...days.map((d) => dayOnlyPiece(today, Number(d), convMonth)));
  }
  for (const m of t.matchAll(RE_DAY_ORDINAL_TR)) {
    if (free(m)) push(m, dayOnlyPiece(today, Number(m[1]), convMonth));
  }
  for (const m of t.matchAll(RE_DAY_ONLY_EN)) {
    if (!free(m)) continue;
    const nextWord = NEXT_WORD.exec(t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16))?.[1];
    if (nextWord && EN_ORDINAL_NOUNS.has(nextWord)) continue; // "the 1st floor"
    push(m, ...[m[1], m[2]].filter(Boolean).map((d) => dayOnlyPiece(today, Number(d), convMonth)));
  }
  for (const [re, offset] of RE_RELATIVE) {
    for (const m of t.matchAll(re)) {
      if (free(m)) push(m, definite("relative", addNights(today, offset), "relative", "high"));
    }
  }
  for (const m of t.matchAll(RE_WEEKEND)) {
    if (!free(m)) continue;
    const sat = weekdayFrom(today, 6);
    const days = dowOf(today) === 0 ? [today] : [sat, addNights(sat, 1)];
    if (m[1] && NEXT_WEEK_PREFIXES.has(m[1])) {
      take(m);
      pieces.push({ kind: "weekend", dates: [], alternatives: [...days, ...days.map((d) => addNights(d, 7))].sort(), basis: "weekday", confidence: "low", assumed: [], reasons: ["next_weekday_ambiguous"], ambiguous: true });
    } else push(m, ...days.map((d) => definite("weekend", d, "weekday", "medium")));
  }
  for (const m of t.matchAll(RE_WEEKDAY)) {
    if (!free(m)) continue;
    const prefix = m[1] ?? null;
    const weekWord = m[2] ?? null;
    const name = m[3];
    if (WEEKDAY_NOT_A_DAY_NEXT.test(t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 10))) continue; // "cuma namazı", "salı pazarı"
    // "pazar" aynı zamanda "çarşı / pazar yeri": yalnız önek ya da "günü" ile gün sayılır.
    if (name === "pazar" && !prefix && !m[4]) continue;
    const dow = WEEKDAYS[name];
    const first = weekdayFrom(today, dow);
    const nextWeek = (prefix !== null && NEXT_WEEK_PREFIXES.has(prefix)) || (weekWord !== null && prefix !== "bu" && prefix !== "this");
    take(m);
    if (nextWeek) {
      const alts = [...new Set([first === today ? addNights(first, 7) : first, addNights(first, first === today ? 14 : 7)])].sort();
      pieces.push({ kind: "weekday", dates: [], alternatives: alts, basis: "weekday", confidence: "low", assumed: [], reasons: ["next_weekday_ambiguous"], ambiguous: true, dow });
    } else {
      pieces.push({ ...definite("weekday", first, "weekday", "medium"), dow });
    }
  }
  for (const [re, side] of [[RE_RES_ARRIVAL, "arrival"], [RE_RES_DEPARTURE, "departure"]] as const) {
    for (const m of t.matchAll(re)) {
      if (!free(m)) continue;
      const k = ctx.reservation?.[side] ?? null;
      take(m);
      pieces.push(
        k
          ? definite("reservation", k, "reservation", "high")
          : { kind: "reservation", dates: [], alternatives: [], basis: "reservation", confidence: "low", assumed: [], reasons: ["reservation_unknown"], ambiguous: true },
      );
    }
  }

  // ── Tutarlılık (inceleme 10-09 #8, #14, tur 4): açık tarihle çelişen göreli gün; açık tarih YA DA göreli günle çelişen hafta günü
  // BELİRSİZDİR ("15 Ekim Cuma", "yarın, 15 Ekim", "yarın cuma"); tutarlıysa tekrarı düşer.
  const explicitDates = new Set(pieces.filter((p) => (p.kind === "explicit" || p.kind === "day_only") && !p.ambiguous).flatMap((p) => p.dates));
  if (explicitDates.size > 0) {
    pieces = pieces.flatMap((p): Piece[] => {
      if (p.kind !== "relative") return [p];
      return explicitDates.has(p.dates[0]) ? [] : [{ ...p, alternatives: p.dates, dates: [], ambiguous: true, confidence: "low", reasons: ["conflicting_dates"] }];
    });
  }
  const anchors = new Set([...explicitDates, ...pieces.filter((p) => p.kind === "relative" && !p.ambiguous).flatMap((p) => p.dates)]);
  if (anchors.size > 0) {
    pieces = pieces.flatMap((p): Piece[] => {
      if (p.kind !== "weekday" || p.ambiguous || p.dow === undefined) return [p];
      return [...anchors].some((k) => dowOf(k) === p.dow) ? [] : [{ ...p, dates: [], ambiguous: true, confidence: "low", reasons: ["weekday_mismatch"] }];
    });
  }

  if (pieces.length === 0) {
    return { status: "none", dates: [], basis: null, confidence: "low", assumed: [], timeZone: ctx.timeZone, today, alternatives: [], reasons: [] };
  }
  const ambiguous = pieces.some((p) => p.ambiguous);
  const weakest = pieces.reduce((a, b) => (CONF_ORDER[b.confidence] < CONF_ORDER[a.confidence] ? b : a));
  const weakestBasis = pieces.reduce((a, b) => (BASIS_ORDER[b.basis] < BASIS_ORDER[a.basis] ? b : a));
  const dates = [...new Set(pieces.flatMap((p) => p.dates))].sort();
  const reasons = new Set(pieces.flatMap((p) => p.reasons));
  if (dates.some((k) => k < today)) reasons.add("past_date");
  return {
    status: ambiguous ? "ambiguous" : "resolved",
    dates,
    basis: weakestBasis.basis,
    confidence: ambiguous ? "low" : weakest.confidence,
    assumed: [...new Set(pieces.flatMap((p) => p.assumed))].sort() as AssumedPart[],
    timeZone: ctx.timeZone,
    today,
    alternatives: [...new Set(pieces.flatMap((p) => p.alternatives))].sort(),
    reasons: [...reasons].sort(),
  };
}
