/* ---------------------------------------------------------------------------
 * PARA İFADESİ — konaklama değişikliği isteğinde ERTELEYEN cevap para taşıyamaz (dilim 8, 09-24).
 *
 * Kurucu senaryo 16-17: "onay + model ücret uydurdu → engel; onay + model indirim pazarlığı yaptı → engel".
 * Hassas istekte (erken giriş · geç çıkış · ek gece · tarih değişikliği) modelin yazdığı cevap ancak İKİ model
 * ertelemeyi doğrularsa gider (`evaluateAvailability`). O erteleme "ev sahibinize soruyorum" derken bir tutar,
 * yüzde, indirim, muafiyet ("ücretsiz / ek ücret yok") ya da pazarlık da söylerse misafire host'un hiç koymadığı bir
 * fiyat gider. Ücret YALNIZ host'un kaydından söylenir: kodda kurulan onay metni (`lib/early-checkin/reply.ts`) ya da
 * host'un kendi geç çıkış teklifi (tutarı AYNEN — çeviri/kısmi aktarım tutarı değiştirmediyse).
 *
 * Bu dosya DETERMİNİSTİK YEDEK katmandır (biçim: para sembolü / kod / ad, yüzde, dar bir indirim-muafiyet-pazarlık
 * sözlüğü — her dilde KANONİK biçimler); anlamsal katman bekçinin `reply_amounts` + `reply_price_terms` hükmüdür.
 * Birleşim, ikisi de yalnız SIKILAŞTIRIR. Sözlük bir kör bataryaya göre BÜYÜTÜLMEZ (aşırı uyum): "size ekstra bir
 * maliyeti olmaz" gibi serbest anlatım bekçinin işidir.
 *  · İzinli tutarlar (`allowed`) = host'un kaydındaki tutarlar; metindeki her tutar onlardan biri değilse, ya da tutar
 *    dışında bir para sinyali (yüzde, indirim, ücretsiz, çözülemeyen para birimi) kalırsa → para ifadesi VAR.
 *  · Ücretin VARLIĞINDAN tutarsız söz ("ev sahibiniz uygunluğu ve olası ücreti bildirecek") para ifadesi DEĞİLDİR.
 *  · Para birimi sözlüğü + tutar çözümlemesi TEK KAYNAK `money-lexicon.ts` (iddia desteği gölge ölçümüyle ortak);
 *    `ai/claim-support.ts` BİLEREK içe aktarılmaz (hiçbir kapı onu okumaz — mekanik pin).
 *  · SAF: DB yok, ağ yok, LLM yok. Katlama `restrictiveMatchForms` (yalnız engelleyen yollar).
 * ------------------------------------------------------------------------- */

import { restrictiveMatchForms } from "@/lib/ai/fallback";
import { CURRENCY_AFTER, CURRENCY_BEFORE, NUM, currencyCode, parseAmount, sameMoney, type MoneyAmount } from "@/lib/ai/money-lexicon";

/** Harf sınırları (rakam serbest: "500TL", "30€" bitişik yazılır). */
const LB = "(?<!\\p{L})";
const RB = "(?!\\p{L})";
/** Kelime sınırları (harf ve rakam). */
const NL = "(?<![\\p{L}\\p{N}])";
const NR = "(?![\\p{L}\\p{N}])";

const rx = (parts: readonly string[]) => parts.map((p) => new RegExp(p, "u"));

/**
 * Tutar biçimleri. Para birimi SEMBOLÜ (`\p{Sc}`: $ € £ ₺ ₽ …) tek başına yeter. Kodlar (tl, eur, usd, gbp, chf) ve
 * kesin para adları her zaman para sayılır. Başka anlamı da olan sözcükler yalnız bir RAKAMA bitişikse sayılır:
 * "dolar" (Türkçe "dolmak": "otopark çabuk dolar"), try ("try 10 minutes" — önek biçimi HİÇ sayılmaz), rub, sar,
 * aed, pound, franc. Kalıplar katlanmış biçimde yazılır (küçük harf; Türkçe harfler ASCII — "yüzde" → "yuzde").
 */
const AMOUNT = rx([
  "\\p{Sc}",
  `${LB}(?:tl|eur|usd|gbp|chf)${RB}`,
  // Ortak sözlükteki her birim + birkaç ek kısaltma, rakamdan sonra. Türkçe ek YALNIZ Türkçede çekimlenen birimlerde
  // ("100 dolara", "20 euroluk") — kısaltmalara ek izni "2 sarı havlu"yu 2 SAR sanardı.
  `\\p{Nd}\\s?(?:${CURRENCY_AFTER}|rub|sar|aed|francs?|franken|pesos?)${RB}`,
  `\\p{Nd}\\s?(?:tl|lira|dolar|avro|sterlin|euro)['’]?\\p{L}{1,5}${RB}`,
  `${LB}(?:rub|sar|aed)\\s?\\p{Nd}`,
  // Kesin para adları (Türkçe ek alabilir; "europe/europa" para değil).
  `${LB}(?:lira|avro|sterlin)\\p{L}*`,
  `${LB}euro(?!p)\\p{L}{0,3}${RB}`,
  `${LB}(?:dollars?|d[oó]lares|pesos)${RB}`,
  // Rusça: евро · доллар(ов) · рубль/рублей · руб. · лира/лир.
  `${NL}(?:евро|доллар\\p{L}*|рубл\\p{L}*|руб|лир(?:а|ы|у|ой|ах)?)${NR}`,
  // Arapça: ek/önek bitişik yazılır ("باليورو") → alt dizi; noktalı kısaltmalar (د.إ, ر.س).
  "يورو|دولار|ليرة|ليره|ريال|درهم|جنيه|دينار|د\\.إ|ر\\.س",
  // Birimsiz tutar: ücret sözcüğü + rakam ("fee is 45.00", "ücreti 500"). Saat bu biçimden sayılmaz ("12:00"). Başka
  // anlamı olan sözcükler yok: "charge" (telefon şarjı), "Preis…" türevleri ("preisgekrönt").
  `${NL}(?:fees?|costs?|price|ucret\\p{L}*|fiyat\\p{L}*|geb[uü]hr\\p{L}*|preise?|frais|prix|tarif\\p{L}*|precio|coste?|costo|стоимост\\p{L}*|цен[аы]|رسوم|سعر|تكلفة)${NR}(?:\\s+(?:is|of|would\\s+be|will\\s+be))?\\s*[:=]?\\s*\\p{Nd}+(?!\\p{Nd})(?:[.,]\\p{Nd}+)?(?![.:]\\p{Nd})`,
]);

/** Yüzde: işaret rakama bitişik (her iki yanda) ya da yüzde sözcüğü ("yüzde yüz" = kesinlik deyimi, sayılmaz). */
const PERCENT = rx([
  "[%٪]\\s?\\p{Nd}",
  "\\p{Nd}\\s?[%٪]",
  `${NL}yuzde${NR}(?!\\s+yuz${NR})`,
  `${NL}(?:percent\\p{L}*|per\\s+cent|prozent\\p{L}*|pour\\s?cent\\p{L}*|por\\s+ciento|процент\\p{L}*)`,
  "بالمئة|بالمائة|في المئة|في المائة",
]);

/**
 * İndirim / muafiyet / pazarlık — DAR ve yüksek kesinlikli, her dilde KANONİK biçimler (anlam bekçinin işi; bu yalnız
 * yedek). Tuzaklar ölçüldü: "feel free to" (çıplak "free" YOK), "remise des clés" (Fransızca anahtar teslimi), ücretin
 * varlığından tutarsız söz ("any possible fee").
 */
const CONCESSION = rx([
  // TR
  // "pazarlık" → "pazarlığa" (ünsüz yumuşaması: ASCII katlamada k → g).
  `${NL}(?:indirim|tenzilat|iskonto|ucretsiz|bedava|parasiz|pazarli[kg])\\p{L}*`,
  `${NL}(?:ozel|yari)\\s+fiyat\\p{L}*`,
  `${NL}bizden\\s+olsun${NR}`,
  `${NL}(?:ek|ekstra|ilave|fazladan)\\s+(?:bir\\s+)?(?:ucret|odeme|para|masraf)\\p{L}*\\s+(?:yok\\p{L}*|olmadan|olmayacak|olmaz|alinmaz|alinmayacak|alinmadan|istenmez|istenmeyecek|gerekmez|gerekmiyor|gerekmeyecek|odemeden)${NR}`,
  `${NL}ucret\\p{L}*\\s+(?:yok\\p{L}*|alinmaz|alinmayacak|almayacag\\p{L}*|almiyoruz|almayiz|istemiyoruz|istemeyecegiz|talep\\s+etmiyoruz|talep\\s+etmeyecegiz)${NR}`,
  // EN
  `${NL}(?:discount\\p{L}*|complimentary|waive\\p{L}*)`,
  `${NL}(?:free\\s+of\\s+(?:charge|cost)|for\\s+free|free\\s+(?:early|late)\\p{L}*|on\\s+the\\s+house)${NR}`,
  `${NL}(?:is|are|be)\\s+free${NR}(?!\\s+to${NR})`,
  `${NL}no\\s+(?:extra\\s+|additional\\s+)?(?:charge|fee|cost)s?${NR}`,
  `${NL}without\\s+(?:any\\s+)?(?:extra\\s+|additional\\s+)?(?:charge|fee|cost)s?${NR}`,
  `${NL}(?:reduced|special|lower|better|cheaper)\\s+(?:price|rate)s?${NR}`,
  `${NL}half[\\s-]price${NR}`,
  // DE
  `${NL}(?:kostenlos\\p{L}*|gratis|umsonst|rabatt\\p{L}*|nachlass\\p{L}*|sonderpreis\\p{L}*|erm[aä](?:ss|ß)igung\\p{L}*)`,
  `${NL}(?:halbe[nmr]?\\s+preis\\p{L}*|aufs\\s+haus)${NR}`,
  `${NL}ohne\\s+(?:aufpreis|zusatzkosten|aufschlag|geb[uü]hr\\p{L}*|(?:zus[aä]tzliche\\s+)?kosten)${NR}`,
  `${NL}keine\\s+(?:zus[aä]tzlichen\\s+)?(?:kosten|geb[uü]hr\\p{L}*|aufpreis)${NR}`,
  // FR ("remise des clés" = anahtar teslimi, para değil)
  `${NL}(?:gratuit\\p{L}*|rabais|r[eé]duction\\p{L}*|geste\\s+commercial)`,
  `${NL}remise(?!\\s+(?:des|de\\s+la|du)\\s+(?:cl[eé]s?|clefs?|badges?|cartes?))`,
  `${NL}sans\\s+(?:frais|suppl[eé]ment\\p{L}*|co[uû]t\\p{L}*)`,
  `${NL}aucun(?:e)?\\s+(?:frais|suppl[eé]ment)`,
  `${NL}(?:prix\\s+sp[eé]cial\\p{L}*|moiti[eé]\\s+prix|[aà]\\s+titre\\s+gracieux)`,
  // ES
  `${NL}(?:descuento\\p{L}*|rebaja\\p{L}*|de\\s+cortes[ií]a)`,
  `${NL}sin\\s+(?:costo|coste|cargo)\\p{L}*`,
  `${NL}(?:precio\\s+especial|mitad\\s+de\\s+precio|mejor\\p{L}*\\s+(?:\\p{L}+\\s+)?precio)`,
  // RU
  `${NL}(?:бесплатн\\p{L}*|скидк\\p{L}*|даром|полцены)`,
  `${NL}без\\s+(?:доплат\\p{L}*|дополнительн\\p{L}*\\s+(?:плат\\p{L}*|оплат\\p{L}*))`,
  `${NL}(?:специальн\\p{L}*\\s+цен\\p{L}*|половин\\p{L}*\\s+цен\\p{L}*|за\\s+наш\\s+сч[её]т|договор\\p{L}*\\s+о\\s+цен\\p{L}*)`,
  // AR (ek/önek bitişik → alt dizi)
  "مجان|خصم|تخفيض|نصف السعر|على حسابنا",
  "(?:بدون|بلا)\\s+(?:أي\\s+)?(?:رسوم|تكلفة|مقابل)",
  "سعر\\S*\\s+(?:خاص|أفضل)",
]);

const ALL = [...AMOUNT, ...PERCENT, ...CONCESSION];

/** Tek bir katlanmış biçimde herhangi bir para sinyali var mı. */
function formHasMoney(form: string): boolean {
  for (const re of ALL) if (re.test(form)) return true;
  return false;
}

/**
 * Metin bir tutar, para birimi, yüzde, indirim, muafiyet ya da pazarlık söylüyor mu? Yalnız ENGELLEMEK için
 * kullanılır (tüm katlamalar sınanır — eşleşme eklenir, çıkarılmaz).
 */
export function hasMoneyStatement(text: string): boolean {
  if (typeof text !== "string" || text.trim() === "") return false;
  return restrictiveMatchForms(text).some(formHasMoney);
}

const AMOUNT_AFTER_RX = new RegExp(`(?<![\\p{L}\\p{N}])(${NUM})\\s?(${CURRENCY_AFTER})`, "gu");
const AMOUNT_BEFORE_RX = new RegExp(`(?<!\\p{L})(${CURRENCY_BEFORE})\\s?(${NUM})(?!\\p{N})`, "gu");

/** Bir biçimdeki tutarları (değer + ISO kodu) sırayla verir. */
function amountSpans(form: string): { start: number; end: number; money: MoneyAmount }[] {
  const out: { start: number; end: number; money: MoneyAmount }[] = [];
  for (const m of form.matchAll(AMOUNT_AFTER_RX)) {
    const code = currencyCode(m[2]);
    out.push({ start: m.index, end: m.index + m[0].length, money: { amount: parseAmount(m[1]), currency: code === "X" ? null : code } });
  }
  for (const m of form.matchAll(AMOUNT_BEFORE_RX)) {
    const code = currencyCode(m[1]);
    out.push({ start: m.index, end: m.index + m[0].length, money: { amount: parseAmount(m[2]), currency: code === "X" ? null : code } });
  }
  return out;
}

/** Metnin tutarları (tekilleştirilmiş). Host'un teklif metni bu yolla çözülür → cevaptakiyle AYNI ayrıştırıcı. */
export function moneyAmountsOf(text: string | null | undefined): MoneyAmount[] {
  if (typeof text !== "string" || text.trim() === "") return [];
  const out: MoneyAmount[] = [];
  for (const form of restrictiveMatchForms(text)) {
    for (const s of amountSpans(form)) if (!out.some((o) => sameMoney(o, s.money))) out.push(s.money);
  }
  return out;
}

/**
 * İZİNLİ tutarlar DIŞINDA para var mı? İzinli tutarın geçişleri metinden çıkarılır, kalanda herhangi bir para sinyali
 * (başka tutar, çözülemeyen birim, yüzde, indirim/muafiyet/pazarlık) aranır. `allowed` boşsa `hasMoneyStatement`.
 */
export function hasUnallowedMoney(text: string, allowed: readonly MoneyAmount[]): boolean {
  if (typeof text !== "string" || text.trim() === "") return false;
  for (const form of restrictiveMatchForms(text)) {
    let rest = form;
    if (allowed.length > 0) {
      const spans = amountSpans(form).filter((s) => allowed.some((a) => sameMoney(s.money, a)));
      for (const s of spans.sort((x, y) => y.start - x.start)) rest = `${rest.slice(0, s.start)} ${rest.slice(s.end)}`;
    }
    if (formHasMoney(rest)) return true;
  }
  return false;
}
