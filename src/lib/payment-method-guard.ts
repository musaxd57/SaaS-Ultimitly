// ---------------------------------------------------------------------------
// EV SAHİBİ METNİNDE ÖDEME YÖNTEMİ (09-25; eski `OFFER_PAYMENT_METHOD_RX`in yerine). Ev sahibinin misafire AYNEN
// giden metni (geç çıkış teklifi, erken giriş notu) platform dışı ödeme yöntemi ya da ödeme YERİ adlandıramaz —
// Airbnb/Booking şartları nakit/havale/kapıda ödeme gibi düzenlemeleri yasaklar. Kayıtta reddedilir; misafir mesajına
// UYGULANMAZ.
//
// 🚨 YÖN: şüphede REDDET. Yanlış ret ev sahibine bir cümleyi yeniden yazdırır; kaçak ise yapay zekânın misafire platform
// dışı ödeme talimatı iletmesi demektir. Üç inceleme turu (09-25) bunu ölçtü: bağlamı daraltan her sürüm eski kalıbın
// yakaladığı gerçek talimatları geçirdi ("Ödeme: kapıda", "parayı kapıdaki kutuya bırakın", "Ödeme eldendir").
//
// Kök neden ("kapıda" vakası): eski kalıp bağlamsız alt dizeydi ve Türkçe büyük harfi katlamıyordu. Düzeltilen, eski
// kalıbın GEVŞETİLMESİ değil, iki dar ve kanıtlanabilir durumdur:
//  · ÜCRET BAĞLAMI YOKSA yer/biçim sözcüğü ödeme değildir: ücretsiz erken giriş kuralının notu "Kapıda şifreli kilit
//    var" diyebilir. (Geç çıkış teklifi her zaman fiyat teklifidir → bağlam hep var; ücretli kuralın notu da onay
//    metnindeki ücret cümlesinin yanına eklendiği için bağlam var.)
//  · ANAHTAR/ERİŞİM cümlesi: metin bir erişim nesnesi (anahtar, kod, şifre, kilit, lockbox) anlatıyor VE metnin
//    kendisinde hiçbir para/ödeme sözcüğü yoksa "kapıda/kapıdaki" konumdur ("Anahtar kapıdaki kutuda"). Metinde para
//    sözcüğü varsa ("bedelini de oraya bırakın") istisna düşer.
// Ek sıkılaştırma: Türkçe katlama ("İBAN", "KAPIDA ÖDEME", "NAKİT"), yeni ödeme rayları, IBAN biçimli numara, yöntem adsız
// yön talimatı ("pay the cleaner directly", "ücreti hesabıma gönderin"). "Libanlı" artık yöntem değil (sözcük başı).
// Bilinen sınırlar: olumsuzlanan yöntem ("Nakit gerekmez") de reddedilir; "ücreti temizlikçiye verin" gibi yer/yöntem/yön
// sözcüğü taşımayan düz talimat yakalanmaz; gizlenmiş yazım (I-B-A-N) kapsam dışı — süzgeç ev sahibini YANLIŞLIKLA kural
// ihlalinden korur, kötü niyete karşı savunma değildir. Anlamı gerçekten çözmek (anlam katmanı) ayrı öneri:
// `docs/MESAJ-ANLAMA-CEKIRDEGI-2026-09-25.md` §4.
// Metin katlanır (Türkçe büyük/küçük harf + aksan): kalıplar ASCII küçük harfle yazılır. Saf; bağımlılık yok.
// ---------------------------------------------------------------------------

/** Türkçe duyarlı katlama: "KAPIDA ÖDEME" → "kapida odeme", "İBAN" → "iban", "NAKİT" → "nakit". */
export function foldPaymentText(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("tr").replace(/ı/g, "i");
}

// Sözcük başı (yalnız KISA/çok anlamlı adlarda): "Libanlı" ≠ IBAN, "left" ≠ EFT. Uzun ve tek anlamlı adlar alt dize
// olarak aranır ("300TLnakit" de yakalansın — eski kalıpla aynı).
const W = "(?<![a-z])";

/** Kendi başına ödeme yöntemi (bağlam gerekmez). */
const METHOD_WORDS = new RegExp(
  `nakit|nakden|havale|western union|money ?gram|papara|wire transfer|bank transfer|paypal|venmo|zelle|revolut|payoneer|` +
    `apple pay|google pay|cash ?app|kripto|crypto|bitcoin|banka hesab|hesap numara|bank account|account number|` +
    `${W}(?:iban|eft(?![a-z])|cash(?![a-z])|sepa(?![a-z])|usd[tc](?![a-z])|wise(?![a-z]))|` +
    // DE/FR/ES/IT/RU/AR: yalnız çok anlamlı olmayanlar (tek başına ES "efectivo" = "etkili" de, DE "bar" = "bar" da).
    `barzahlung|bargeld|${W}bar (?:be)?zahlen|zahlen sie bar|${W}in bar(?![a-z])|uberweisung|especes|en liquide|virement|` +
    `en efectivo|contanti|bonifico|наличн|نقد`,
);

/** IBAN biçimi: ülke kodu + 2 kontrol hanesi + devamı (boşluklu yazım dahil), en az 12 rakam. */
const IBAN_SHAPE = /(?<![a-z0-9])[a-z]{2}\d{2}(?:\s?[a-z0-9]){11,30}(?![a-z0-9])/g;
function hasIbanNumber(folded: string): boolean {
  for (const m of folded.matchAll(IBAN_SHAPE)) {
    if ((m[0].match(/\d/g) ?? []).length >= 12) return true;
  }
  return false;
}

/** Yer/biçim: ödeme bağlamında ödeme yeri/biçimi. "kapida" TÜM çekimleriyle ("kapidaki" dahil), "elden" ekleriyle. */
const KAPI = /(?<![a-z])kapida[a-z]*/;
const PLACE_OR_MANNER = new RegExp(
  `${W}(?:kapida|elden|at the door|on arrival|upon arrival|on check-?in|in person|girist[ae](?![a-z]))`,
);

/** Yön talimatı: yalnız AYNI cümlede ödeme fiiliyle ("pay … directly", "ücreti hesabıma gönderin"). */
const DIRECTION = new RegExp(`${W}(?:directly|dogrudan|direkt(?![a-z])|hesab(?:im|imiz)|(?:my|our) (?:bank )?account)`);
const PAY_VERB = new RegExp(
  `${W}(?:ode(?:m|n|y|r|d|s|t)|tahsil|pay(?:s|ed|ing|ment|ments|able)?(?![a-z])|paid|transfer|gonder|yatir|send)`,
);

/** Para/ödeme sözcüğü (metnin kendisinde): ödeme adı/fiili, ücret, bedel, tutar, para, para birimi, tutar biçimi. */
const MONEY = new RegExp(
  `${W}(?:ode(?:m|n|y|r|d|s|t)|tahsil|ucret(?!siz)|bedel|tutar|masraf|kira(?![a-z]*(?:lik|l[ia]k))|para(?!v|graf|metre|sol|lel|sut)|` +
    `fiyat|pay(?:s|ed|ing|ment|ments|able)?(?![a-z])|paid|fees?(?![a-z])|charg(?:e|es|ed)(?![a-z])|price|cost(?![a-z])|` +
    `tl(?![a-z])|ytl(?![a-z])|lira|euro(?![p])|eur(?![a-z])|avro|usd(?![a-z])|dolar|dollar|gbp(?![a-z])|sterlin|chf(?![a-z])|` +
    `rub(?![a-z])|rubl)|[₺€$£₽]|\\d\\s*try(?![a-z])`,
);

/** Erişim nesnesi (anahtar/kod/kilit) — "kapıda/kapıdaki" konumu anlatıyor olabilir. */
const ACCESS = /(?<![a-z])(?:anahtar|key|kod|code|sifre|password|kilit|lock|lockbox|kasa|keybox)/;

const CLAUSE = /[.;!?\n]+/;

/**
 * Metin platform dışı bir ödeme YÖNTEMİ ya da ödeme YERİ adlandırıyor mu. Yalnız ev sahibinin yazdığı ve misafire aynen
 * giden metin için (kayıt doğrulaması); misafir mesajının anlamını çözmek için KULLANILMAZ. `paymentContext`: metin bir
 * fiyat/ücret bağlamında gidiyor (geç çıkış teklifi · ücretli erken giriş kuralının notu).
 */
export function namesPaymentMethod(text: string, opts: { paymentContext?: boolean } = {}): boolean {
  const folded = foldPaymentText(text);
  if (METHOD_WORDS.test(folded) || hasIbanNumber(folded)) return true;
  if (folded.split(CLAUSE).some((c) => DIRECTION.test(c) && PAY_VERB.test(c))) return true;
  const ownMoney = MONEY.test(folded);
  if (!(opts.paymentContext === true || ownMoney)) return false;
  // Anahtar/erişim istisnası YALNIZ "kapıda" çekimlerine ve metinde para sözcüğü YOKKEN.
  const scanned = !ownMoney && ACCESS.test(folded) ? folded.replace(new RegExp(KAPI.source, "g"), " ") : folded;
  return PLACE_OR_MANNER.test(scanned);
}
