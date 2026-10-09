import { addNights, nightsBetween, type NightKey } from "@/modules/availability/core";
import { resolveGuestDates, type DateResolutionContext } from "@/lib/ai/date-resolution";
import { verifiedDayLabel, type AvailabilityQuery, type VerifiedAvailability, type VerifiedAvailabilityLang } from "@/lib/ai/verified-availability";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ UZATMA CEVABI (kurucu kararı 10-09: "Müsait + talep yolu"; anahtar `AI_VERIFIED_EXTENSION_ENABLED`, VARSAYILAN KAPALI).
//
// Misafir konaklamasını uzatmak istiyor ("Bir gece daha kalabilir miyiz?") ve uzatma geceleri takvimde kesin → KODDAN kurulan tek metin:
//   boş:  "16 Ekim gecesi daire müsait. Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi
//          gönderebilirsiniz; yeni tutarı Airbnb gösterir."
//   dolu: "Maalesef 16 Ekim gecesi daire müsait değil."
// Söz / fiyat / izin YOK: Airbnb'de uzatma misafirin değişiklik talebi + ev sahibinin kabulüyle olur, tutarı Airbnb gösterir. Ev sahibi
// kaynaklı teklif (özel teklif / değişiklik) bugün köprüden yapılamıyor (araştırma 10-09) → kapsam dışı.
// Takvim bayat / belirsiz / kısmen dolu, tarih ya da gece sayısı belirsiz, rezervasyon Airbnb dışı → null (ev sahibine kalır). SAF.
// ---------------------------------------------------------------------------

export const VERIFIED_EXTENSION_FLAG = "AI_VERIFIED_EXTENSION_ENABLED";
export function verifiedExtensionEnabled(): boolean {
  return process.env.AI_VERIFIED_EXTENSION_ENABLED === "1";
}

/** Tek mesajda istenebilecek en fazla ek gece (üstü ev sahibine — uzun uzatma ayrı konuşma). */
export const MAX_EXTENSION_NIGHTS = 7;

const TR_NUM: Readonly<Record<string, number>> = { bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7 };
const EN_NUM: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, a: 1, an: 1 };
const NUM = (m: string): number | null => {
  if (/^\d{1,2}$/.test(m)) return Number(m);
  return TR_NUM[m] ?? EN_NUM[m] ?? null;
};

// Doğrusal kalıplar (sınırlı alternasyon, iç içe niceleyici yok); sözcük sınırı harf / rakam ile (Türkçe harfler `\b`'yi bozar).
const L = "(?<![\\p{L}\\d])";
const R = "(?![\\p{L}\\d])";
const TR_COUNT = new RegExp(`${L}(bir|iki|üç|dört|beş|altı|yedi|\\d{1,2})\\s+(?:gece|gün)\\s+(?:daha|fazla)${R}`, "gu");
const EN_COUNT = new RegExp(`${L}(one|two|three|four|five|six|seven|an?|\\d{1,2})\\s+(?:more|extra|additional)\\s+(?:nights?|days?)${R}`, "gu");
const EN_ANOTHER = new RegExp(`${L}another\\s+(?:night|day)${R}`, "gu");

/**
 * Metindeki "N gece daha" ifadeleri. Hiç yoksa null; birbirini tutmayan iki sayı ya da aralık dışı sayı → "conflict" (tahmin yok).
 */
export function extensionNightsRequested(text: string | null | undefined): number | null | "conflict" {
  if (typeof text !== "string" || text.length === 0) return null;
  const t = text.toLocaleLowerCase("tr");
  const found = new Set<number>();
  for (const re of [TR_COUNT, EN_COUNT]) {
    for (const m of t.matchAll(re)) {
      const n = NUM(m[1]);
      if (n === null) return "conflict";
      found.add(n);
    }
  }
  if ([...t.matchAll(EN_ANOTHER)].length > 0) found.add(1);
  if (found.size === 0) return null;
  if (found.size > 1) return "conflict";
  const n = [...found][0];
  return n >= 1 && n <= MAX_EXTENSION_NIGHTS ? n : "conflict";
}

/**
 * Uzatma aralığı [çıkış günü, çıkış + N). Rezervasyon (çıkış günü) ŞART. Kabul edilen biçimler:
 *  · yalnız "N gece daha" → N gece;
 *  · yalnız çıkış günü ("16 Ekim gecesi de kalabilir miyiz") → 1 gece;
 *  · çıkış günü + sonraki gün ("16–18 Ekim") → o aralık;
 *  · ikisi birlikte yalnız TUTARLIYSA.
 * Çıkış gününe değmeyen tarih ("18 Ekim'e kadar" — çıkış mı, gece mi belirsiz), belirsiz / geçmiş tarih, tutarsız sayı → null.
 */
export function extensionQueryOf(text: string | null | undefined, ctx: DateResolutionContext): AvailabilityQuery | null {
  const departure = ctx.reservation?.departure;
  if (!departure) return null;
  const count = extensionNightsRequested(text);
  if (count === "conflict") return null;
  const r = resolveGuestDates(text, ctx);
  if (r.status === "ambiguous" || r.reasons.includes("past_date")) return null;
  let fromDates: AvailabilityQuery | null = null;
  if (r.status === "resolved") {
    if (r.dates.length === 1 && r.dates[0] === departure) fromDates = { from: departure, to: addNights(departure, 1) };
    else if (r.dates.length === 2 && r.dates[0] === departure && r.dates[1] > departure) fromDates = { from: departure, to: r.dates[1] };
    else return null; // çıkış gününe değmeyen / çok tarihli → belirsiz
  }
  const fromCount = count !== null ? { from: departure, to: addNights(departure, count) } : null;
  if (fromDates && fromCount && fromDates.to !== fromCount.to) return null;
  const q = fromDates ?? fromCount;
  if (!q || nightsBetween(q.from, q.to) < 1 || nightsBetween(q.from, q.to) > MAX_EXTENSION_NIGHTS) return null;
  return q;
}

const TR_TAIL = "Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi gönderebilirsiniz; yeni tutarı Airbnb gösterir.";
const EN_TAIL = "To extend your stay, you can send a reservation change request in the Airbnb app; Airbnb will show the new total.";

/** Kurucunun onayladığı metin (TR / EN). Yalnız tamamı boş ya da tamamı dolu araç sonucu için; başka sonuç → null. */
export function verifiedExtensionText(va: VerifiedAvailability, lang: VerifiedAvailabilityLang, today: NightKey): string | null {
  const v = va.result.value;
  if (!v || (v.verdict !== "available" && v.verdict !== "unavailable")) return null;
  const from = verifiedDayLabel(va.query.from, lang, today);
  const to = verifiedDayLabel(va.query.to, lang, today);
  const single = v.nights === 1;
  if (lang === "tr") {
    const span = single ? `${from} gecesi` : `${from} – ${to} arası ${v.nights} gece`;
    return v.verdict === "available" ? `${span} daire müsait. ${TR_TAIL}` : `Maalesef ${single ? `${from} gecesi` : `${from} – ${to} arası`} daire müsait değil.`;
  }
  if (v.verdict === "available") {
    return single
      ? `The apartment is available on the night of ${from}. ${EN_TAIL}`
      : `The apartment is available for ${v.nights} nights from ${from} to ${to}. ${EN_TAIL}`;
  }
  return single ? `Unfortunately, the apartment is not available on the night of ${from}.` : `Unfortunately, the apartment is not available from ${from} to ${to}.`;
}
