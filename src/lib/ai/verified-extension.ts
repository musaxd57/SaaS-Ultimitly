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
// Sayı sözcüğünden önce tire de sınırdır DEĞİL: "twenty-one" / "yirmi-bir" 1 okunmasın (Haiku 10-09 ikinci tur, P1).
const LN = "(?<![\\p{L}\\d-])";
const R = "(?![\\p{L}\\d])";
const TR_COUNT = new RegExp(`${LN}(bir|iki|üç|dört|beş|altı|yedi|\\d{1,2})\\s+(?:gece|gün)\\s+(?:daha|fazla)${R}`, "gu");
const EN_COUNT = new RegExp(`${LN}(one|two|three|four|five|six|seven|an?|\\d{1,2})\\s+(?:more|extra|additional)\\s+(?:nights?|days?)${R}`, "gu");
const EN_ANOTHER = new RegExp(`${L}another\\s+(?:night|day)${R}`, "gu");
// "on bir gece daha" (11) / "twenty one more nights": sayı öncesi onluk sözcüğü → tutarsız (Haiku 10-09: 11 gece 1 gece okunuyordu).
const TENS = new RegExp(`${L}(?:on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan|yüz|ten|twenty|thirty|forty|fifty|hundred)(?:\\s+|\\s*-\\s*)(?:bir|iki|üç|dört|beş|altı|yedi|one|two|three|four|five|six|seven)${R}`, "u"); // `.test` → durumsuz (g bayrağı YOK)

// İstek ŞEKLİ (Haiku 10-09, P1/P2): metin yalnız misafirin KENDİ kalma / uzatma isteğinde kurulur.
//  · birinci şahıs istek kalıbı ŞART ("kalabilir miyiz", "kalsak", "uzatmak istiyorum", "can we stay", "we'd like to extend");
//  · erken / önce ("Bir gece daha ÖNCE gelebilir miyiz?" = erken geliş), üçüncü kişi ("Arkadaşım bir gece daha kalabilir mi?"),
//    olumsuzluk ("mümkün değilse", "not") geçerse → ev sahibine. Bildirim ("bir gece daha uzattık") kalıba uymaz → ev sahibine.
const TR_ASK = new RegExp(
  `${L}(?:(?:kalabilir|uzatabilir)\\s+mi(?:yiz|yim)|kalsak|kalsam|uzatsak|uzatsam|(?:kalmak|uzatmak)\\s+ist(?:iyoruz|iyorum|eriz|erim|erdik|erdim))${R}`,
  "u",
);
const EN_ASK = new RegExp(
  `${L}(?:(?:can|could|may)\\s+(?:we|i)\\s+(?:stay|extend)|(?:we|i)(?:'d|’d|\\s+would)\\s+like\\s+to\\s+(?:stay|extend)|(?:we|i)\\s+(?:want|wish)\\s+to\\s+(?:stay|extend))${R}`,
  "u",
);
const EARLIER = new RegExp(`${L}(?:önce|erken|earlier|early|before|sooner)${R}`, "u");
const THIRD_PARTY = new RegExp(
  `${L}(?:arkadaş\\p{L}{0,8}|annem|babam|kardeş\\p{L}{0,6}|eşim|kızım|oğlum|ailem|misafir\\p{L}{0,6}|friends?|parents?|mother|father|sister|brother|wife|husband|partner|karım|kocam|they|he|she|someone|somebody)${R}`,
  "u",
);
// Desteklenmeyen süre ("bir hafta daha", "sekiz gece", "a week") → aralık KURULMAZ (Haiku 10-09 ikinci tur: tarih yolu 1 gece sanıyordu).
const OTHER_DURATION = new RegExp(
  `${L}(?:hafta\\p{L}{0,6}|ay(?:lık)?|sekiz|dokuz|weeks?|fortnight|months?|eight|nine|ten)${R}`,
  "u",
);
// Alıntı / geçmiş anlatım / kararsızlık / başka yer: misafirin ŞİMDİKİ kendi isteği değil (Haiku 10-09 ikinci tur).
const NOT_A_LIVE_ASK = new RegExp(
  `${L}(?:diye|sormuştum|sormuştuk|kalmasak|kalmasam|asked|said|told|another\\s+(?:property|apartment|place|flat|house|hotel|listing)|başka\\s+(?:daire|ev|yer|otel|mülk)\\p{L}{0,4})${R}`,
  "u",
);
const NEGATION = new RegExp(`${L}(?:değil\\p{L}{0,6}|hayır|istemiyoruz|istemiyorum|not|no|don't|don’t|won't|won’t|cannot|can't|can’t)${R}`, "u");

/** Misafirin KENDİ uzatma isteği şeklinde mi (birinci şahıs istek kalıbı var; erken / üçüncü kişi / olumsuzluk yok). */
export function isOwnExtensionRequest(text: string | null | undefined): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  // Türkçe küçük harf "I"yı "ı" yapar → İngilizce kalıplar yerel ayarsız küçük harfte okunur.
  const tr = text.toLocaleLowerCase("tr");
  const en = text.toLowerCase();
  if (!TR_ASK.test(tr) && !EN_ASK.test(en)) return false;
  return ![tr, en].some((t) => EARLIER.test(t) || THIRD_PARTY.test(t) || NEGATION.test(t) || NOT_A_LIVE_ASK.test(t));
}

/**
 * Metindeki "N gece daha" ifadeleri. Hiç yoksa null; birbirini tutmayan iki sayı ya da aralık dışı sayı → "conflict" (tahmin yok).
 */
export function extensionNightsRequested(text: string | null | undefined): number | null | "conflict" {
  if (typeof text !== "string" || text.length === 0) return null;
  const t = text.toLocaleLowerCase("tr");
  const en = text.toLowerCase(); // İngilizce: yerel ayarsız (Türkçe küçük harf "I"yı "ı" yapar)
  if (TENS.test(t) || TENS.test(en)) return "conflict";
  const found = new Set<number>();
  for (const [re, s] of [
    [TR_COUNT, t],
    [EN_COUNT, en],
  ] as const) {
    for (const m of s.matchAll(re)) {
      const n = NUM(m[1]);
      if (n === null) return "conflict";
      found.add(n);
    }
  }
  if ([...en.matchAll(EN_ANOTHER)].length > 0) found.add(1);
  if (found.size === 0) return null;
  if (found.size > 1) return "conflict";
  const n = [...found][0];
  return n >= 1 && n <= MAX_EXTENSION_NIGHTS ? n : "conflict";
}

/**
 * Uzatma aralığı [çıkış günü, çıkış + N). Rezervasyon (çıkış günü) ve misafirin KENDİ istek şekli (`isOwnExtensionRequest`) ŞART. Kabul:
 *  · yalnız "N gece daha" → N gece;
 *  · yalnız çıkış günü ("16 Ekim gecesi de kalabilir miyiz") → 1 gece;
 *  · ikisi birlikte yalnız TUTARLIYSA.
 * İKİ tarih ("16–18 Ekim" aralık mı, "16 ve 17 Ekim" gece listesi mi — Haiku 10-09: liste tek gece okunuyordu), çıkış gününe değmeyen tarih
 * ("18 Ekim'e kadar" — çıkış mı, gece mi belirsiz), belirsiz / geçmiş tarih, tutarsız sayı → null (ev sahibine).
 */
export function extensionQueryOf(text: string | null | undefined, ctx: DateResolutionContext): AvailabilityQuery | null {
  const departure = ctx.reservation?.departure;
  if (!departure || !isOwnExtensionRequest(text)) return null;
  const count = extensionNightsRequested(text);
  if (count === "conflict") return null;
  if (OTHER_DURATION.test((text ?? "").toLocaleLowerCase("tr")) || OTHER_DURATION.test((text ?? "").toLowerCase())) return null;
  const r = resolveGuestDates(text, ctx);
  if (r.status === "ambiguous" || r.reasons.includes("past_date")) return null;
  let fromDates: AvailabilityQuery | null = null;
  if (r.status === "resolved") {
    if (r.dates.length === 1 && r.dates[0] === departure) fromDates = { from: departure, to: addNights(departure, 1) };
    else return null; // çıkış gününe değmeyen / iki ya da daha çok tarih → belirsiz
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
