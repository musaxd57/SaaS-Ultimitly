/* ---------------------------------------------------------------------------
 * PARA İFADESİ — konaklama değişikliği isteğinde ERTELEYEN cevap para taşıyamaz (dilim 8, 09-24).
 *
 * Kurucu senaryo 16-17: "onay + model ücret uydurdu → engel; onay + model indirim pazarlığı yaptı → engel".
 * Hassas istekte (erken giriş · geç çıkış · ek gece · tarih değişikliği) modelin yazdığı cevap ancak İKİ model
 * ertelemeyi doğrularsa gider (`evaluateAvailability`). O erteleme "ev sahibinize soruyorum" derken bir tutar,
 * yüzde, indirim, muafiyet ("ücretsiz / ek ücret yok") ya da pazarlık da söylerse misafire host'un hiç koymadığı bir
 * fiyat gider. Ücret YALNIZ host'un kuralından, KODDA kurulan onay metniyle söylenir (`lib/early-checkin/reply.ts`).
 *
 * Bu dosya DETERMİNİSTİK katmandır (biçim: sembol / kod / para adı / yüzde + dar bir indirim-muafiyet sözlüğü);
 * anlamsal katman bekçinin `reply_states_price` hükmüdür. İkisi birleşimdir, ikisi de yalnız SIKILAŞTIRIR.
 *  · Bugün izinli tutar kümesi BOŞTUR: modele host'un ücreti verilmiyor (yol planı: "kuralı modele salt-okunur ver"
 *    bu kontrole bağlı). O açılırken kuraldaki tutar izinli kümeye girer — tek kaynak kural.
 *  · Ücretin VARLIĞINDAN tutarsız söz ("ev sahibiniz uygunluğu ve olası ücreti bildirecek") para ifadesi DEĞİLDİR.
 *  · `ai/claim-support.ts` (gölge ölçüm) BİLEREK kullanılmaz: hiçbir kapı onu içe aktaramaz (mekanik pin).
 *  · SAF: DB yok, ağ yok, LLM yok. Katlama `restrictiveMatchForms` (yalnız engelleyen yollar).
 * ------------------------------------------------------------------------- */

import { restrictiveMatchForms } from "@/lib/ai/fallback";

/** Harf sınırları (rakam serbest: "500TL", "30€" bitişik yazılır). */
const LB = "(?<!\\p{L})";
const RB = "(?!\\p{L})";
/** Kelime sınırları (harf ve rakam). */
const NL = "(?<![\\p{L}\\p{N}])";
const NR = "(?![\\p{L}\\p{N}])";

const rx = (parts: readonly string[]) => parts.map((p) => new RegExp(p, "u"));

/**
 * Tutar biçimleri. Para birimi SEMBOLÜ (`\p{Sc}`: $ € £ ₺ ₽ …) tek başına yeter. Para birimi ADI / kodu her zaman para
 * sayılır; yalnız başka anlamı da olan kısaltmalar (try, rub, sar, aed, pound, franc) bir RAKAMA bitişikse sayılır.
 * Kalıplar katlanmış biçimde yazılır (küçük harf; Türkçe harfler ASCII — "yüzde" → "yuzde").
 */
const AMOUNT = rx([
  "\\p{Sc}",
  // Kodlar ve kısaltmalar (bitişik de olur: "500TL", "EUR30").
  `${LB}(?:tl|eur|usd|gbp|chf)${RB}`,
  `\\p{Nd}\\s?(?:try|rub|sar|aed|pounds?|francs?|franken)${RB}`,
  `${LB}(?:try|rub|sar|aed)\\s?\\p{Nd}`,
  // Para adları (Türkçe ek alabilir; "europe/europa" para değil).
  `${LB}(?:lira|avro|dolar|sterlin)\\p{L}*`,
  `${LB}euro(?!p)\\p{L}{0,3}${RB}`,
  `${LB}(?:dollars?|d[oó]lares)${RB}`,
  // Rusça: евро · доллар(ов) · рубль/рублей · руб. · лира/лир.
  `${NL}(?:евро|доллар\\p{L}*|рубл\\p{L}*|руб|лир(?:а|ы|у|ой|ах)?)${NR}`,
  // Arapça: ek/önek bitişik yazılır ("باليورو") → alt dizi.
  "يورو|دولار|ليرة|ليره|ريال|درهم|جنيه|دينار",
]);

/** Yüzde: işaret rakama bitişik (her iki yanda) ya da yüzde sözcüğü. */
const PERCENT = rx([
  "[%٪]\\s?\\p{Nd}",
  "\\p{Nd}\\s?[%٪]",
  `${NL}yuzde${NR}`,
  `${NL}(?:percent\\p{L}*|per\\s+cent|prozent\\p{L}*|pour\\s?cent\\p{L}*|por\\s+ciento|процент\\p{L}*)`,
  "بالمئة|بالمائة|في المئة|في المائة",
]);

/**
 * İndirim / muafiyet / pazarlık — DAR ve yüksek kesinlikli sözlük (anlam bekçinin işi; bu yalnız yedek). Tuzaklar
 * ölçüldü: "feel free to" (çıplak "free" YOK), "remise des clés" (Fransızca anahtar teslimi), ücretin varlığından
 * tutarsız söz ("any possible fee").
 */
const CONCESSION = rx([
  // TR
  `${NL}(?:indirim|tenzilat|iskonto|ucretsiz|bedava|parasiz)\\p{L}*`,
  `${NL}ozel\\s+fiyat\\p{L}*`,
  `${NL}(?:ek|ekstra|ilave|fazladan)\\s+(?:bir\\s+)?(?:ucret|odeme|para|masraf)\\p{L}*\\s+(?:yok\\p{L}*|olmadan|olmayacak|olmaz|alinmaz|alinmayacak|alinmadan|istenmez|istenmeyecek|gerekmez|gerekmiyor|gerekmeyecek|odemeden)${NR}`,
  `${NL}ucret\\p{L}*\\s+(?:yok\\p{L}*|alinmaz|alinmayacak|almayacag\\p{L}*|almiyoruz|almayiz|istemiyoruz|istemeyecegiz|talep\\s+etmiyoruz|talep\\s+etmeyecegiz)${NR}`,
  // EN
  `${NL}(?:discount\\p{L}*|complimentary|waive\\p{L}*)`,
  `${NL}(?:free\\s+of\\s+(?:charge|cost)|for\\s+free|free\\s+(?:early|late)\\p{L}*)${NR}`,
  `${NL}(?:is|are|be)\\s+free${NR}(?!\\s+to${NR})`,
  `${NL}at\\s+no\\s+(?:extra\\s+|additional\\s+)?(?:cost|charge)${NR}`,
  `${NL}no\\s+(?:extra\\s+|additional\\s+)?(?:charge|fee|cost)s?${NR}`,
  `${NL}without\\s+(?:any\\s+)?(?:extra\\s+|additional\\s+)?(?:charge|fee|cost)s?${NR}`,
  `${NL}(?:reduced|special|lower|better|cheaper)\\s+(?:price|rate)s?${NR}`,
  `${NL}half[\\s-]price${NR}`,
  // DE
  `${NL}(?:kostenlos\\p{L}*|gratis|umsonst|rabatt\\p{L}*|nachlass\\p{L}*|sonderpreis\\p{L}*|erm[aä](?:ss|ß)igung\\p{L}*)`,
  `${NL}ohne\\s+(?:aufpreis|zusatzkosten|aufschlag|geb[uü]hr\\p{L}*|(?:zus[aä]tzliche\\s+)?kosten)${NR}`,
  `${NL}keine\\s+(?:zus[aä]tzlichen\\s+)?(?:kosten|geb[uü]hr\\p{L}*|aufpreis)${NR}`,
  // FR ("remise des clés" = anahtar teslimi, para değil)
  `${NL}(?:gratuit\\p{L}*|rabais|r[eé]duction\\p{L}*)`,
  `${NL}remise(?!\\s+(?:des|de\\s+la|du)\\s+(?:cl[eé]s?|clefs?|badges?|cartes?))`,
  `${NL}sans\\s+(?:frais|suppl[eé]ment\\p{L}*|co[uû]t\\p{L}*)`,
  `${NL}aucun(?:e)?\\s+(?:frais|suppl[eé]ment)`,
  `${NL}prix\\s+sp[eé]cial\\p{L}*`,
  // ES
  `${NL}(?:descuento\\p{L}*|rebaja\\p{L}*)`,
  `${NL}sin\\s+(?:costo|coste|cargo)\\p{L}*`,
  `${NL}precio\\s+especial`,
  // RU
  `${NL}(?:бесплатн\\p{L}*|скидк\\p{L}*|даром)`,
  `${NL}без\\s+(?:доплат\\p{L}*|дополнительн\\p{L}*\\s+(?:плат\\p{L}*|оплат\\p{L}*))`,
  `${NL}специальн\\p{L}*\\s+цен\\p{L}*`,
  // AR (ek/önek bitişik → alt dizi)
  "مجان|خصم|تخفيض",
  "(?:بدون|بلا)\\s+(?:أي\\s+)?(?:رسوم|تكلفة|مقابل)",
]);

const ALL = [...AMOUNT, ...PERCENT, ...CONCESSION];

/**
 * Metin bir tutar, para birimi, yüzde, indirim, muafiyet ya da pazarlık söylüyor mu? Yalnız ENGELLEMEK için
 * kullanılır (tüm katlamalar sınanır — eşleşme eklenir, çıkarılmaz).
 */
export function hasMoneyStatement(text: string): boolean {
  if (typeof text !== "string" || text.trim() === "") return false;
  for (const form of restrictiveMatchForms(text)) {
    for (const re of ALL) if (re.test(form)) return true;
  }
  return false;
}
