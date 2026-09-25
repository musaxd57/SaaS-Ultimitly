// ---------------------------------------------------------------------------
// EV SAHİBİ METNİNDE ÖDEME YÖNTEMİ (09-25; eski `OFFER_PAYMENT_METHOD_RX`in yerine). Ev sahibinin misafire AYNEN
// giden metni (geç çıkış teklifi, erken giriş notu) platform dışı ödeme yöntemi adlandıramaz — Airbnb/Booking
// şartları nakit/havale gibi düzenlemeleri yasaklar. Kayıtta reddedilir; misafir mesajına UYGULANMAZ.
//
// Kök neden (denetim 09-25, "kapıda" vakası): eski kalıp bağlamsız alt dizeydi. "Anahtar kapıdaki kutuda" (kapı
// konumu) ve "anahtarlar elden teslim edilir" (anahtar teslimi) ödeme yöntemi sayılıyor, erken giriş kuralı genel bir
// hatayla kaydedilemiyordu; "Libanlı" içindeki "iban" da. Öte yandan JS `/i` Türkçe büyük harfi katlamaz: "KAPIDA
// ÖDEME", "İBAN", "NAKİT" geçiyordu. Bir kelimeye istisna eklemek yerine anlam parçalara ayrıldı:
//  · Kendi başına ödeme yöntemi olan adlar (nakit, IBAN, havale, PayPal…) ve IBAN biçimli numara her yerde yöntemdir.
//  · YER/BİÇİM sözcükleri ("kapıda", "elden", "at the door", "on arrival", "in person") ile YÖN sözcükleri
//    ("directly", "doğrudan", "hesabıma", "to my account") METNİN HERHANGİ bir yerinde ödeme/ücret/para birimi sözcüğü
//    varsa yöntemdir. 🚨 Kapsam CÜMLECİK DEĞİL, METİN (iki inceleme 09-25): cümlecik bölmek "Ödeme: kapıda", "Ücret 300 TL.
//    Kapıda alınır.", "300 TL (kapıda)" gibi doğal yazımları geçiriyordu — eski kalıbın yakaladığı bir gerileme.
//  · "kapıdaki" (kapıda BULUNAN — nesnenin yeri) yer sözcüğü DEĞİLDİR: "anahtar kapıdaki kutuda" ücretle aynı metinde
//    olsa da yöntem sayılmaz. "ücretsiz" ödeme bağlamı değildir.
// Erken giriş notu: ücret kuralın AYRI alanında ve onay metnine kodla yazılır → not tek başına para sözcüğü taşımasa da
// ödeme bağlamı VARDIR ("Kapıda alırız." ücret cümlesinin yanına eklenir) — çağıran `paymentContext: true` verir.
// Bilinen sınırlar (ölçüldü, bilinçli): olumsuzlanan yöntem ("Nakit gerekmez") de reddedilir (güvenli yön: ev sahibi
// cümleyi değiştirir); "ücreti temizlikçiye verin" gibi yöntemsiz/yönsüz düz talimat yakalanmaz; gizlenmiş yazım
// (I-B-A-N) kapsam dışı — süzgeç ev sahibini yanlışlıkla kural ihlalinden korur, kötü niyete karşı savunma değildir.
// Metin katlanır (Türkçe büyük/küçük harf + aksan): kalıplar ASCII küçük harfle yazılır. Saf; bağımlılık yok.
// ---------------------------------------------------------------------------

/** Türkçe duyarlı katlama: "KAPIDA ÖDEME" → "kapida odeme", "İBAN" → "iban", "NAKİT" → "nakit". */
export function foldPaymentText(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("tr").replace(/ı/g, "i");
}

// Sözcük başı: önünde harf yok (Türkçe ekler sona gelir → "IBAN'a", "havaleyle", "nakiten" yakalanır).
const W = "(?<![a-z])";

/** Kendi başına ödeme yöntemi (bağlam gerekmez). */
const METHOD_WORDS = new RegExp(
  `${W}(?:nakit|nakden|iban|havale|eft(?![a-z])|western union|money ?gram|papara|cash(?![a-z])|wire transfer|bank transfer|` +
    `paypal|venmo|zelle|revolut|payoneer|apple pay|google pay|cash app|sepa(?![a-z])|kripto|crypto|bitcoin|usdt(?![a-z])|usdc(?![a-z])|` +
    `banka hesab|hesap numara|bank account|account number|` +
    // DE/FR/ES/IT/RU/AR: yalnız çok anlamlı olmayanlar (tek başına ES "efectivo" = "etkili" de, DE "bar" = "bar" da).
    `barzahlung|bargeld|bar (?:be)?zahlen|zahlen sie bar|uberweisung|especes|en liquide|virement|en efectivo|contanti|bonifico)` +
    `|наличн|نقد`,
);

/** IBAN biçimi: ülke kodu + 2 kontrol hanesi + en az 10 rakam (boşluklu yazım dahil). */
const IBAN_SHAPE = /(?<![a-z0-9])[a-z]{2}\d{2}(?:\s?[a-z0-9]){11,30}(?![a-z0-9])/g;
function hasIbanNumber(folded: string): boolean {
  for (const m of folded.matchAll(IBAN_SHAPE)) {
    if ((m[0].match(/\d/g) ?? []).length >= 12) return true;
  }
  return false;
}

/** Yer/biçim/yön: yalnız ödeme bağlamıyla yöntem olur. "kapidaki" (kapıda bulunan) bilinçli dışarıda. */
const PLACE_OR_MANNER = new RegExp(
  `${W}(?:kapida(?!ki)|elden(?![a-z])|at the door|on arrival|upon arrival|in person|directly|dogrudan|direkt(?![a-z])|` +
    `hesab(?:im|imiz)(?:a|dan)?(?![a-z])|(?:my|our) (?:bank )?account)`,
);

/** Ödeme bağlamı: ödeme fiili/adı, ücret, para, para birimi ("ücretsiz" değil). */
const PAYMENT_CONTEXT = new RegExp(
  `${W}(?:ode(?:m|n|y|r|d|s)|tahsil|ucret(?!siz)|para(?![vgm])|fiyat|pay(?:s|ed|ing|ment|ments|able)?(?![a-z])|paid|fees?(?![a-z])|` +
    `charg(?:e|es|ed)(?![a-z])|price|cost|tl(?![a-z])|lira|euro|eur(?![a-z])|avro|usd(?![a-z])|dolar|dollar|gbp(?![a-z])|sterlin)|[₺€$£]`,
);

/**
 * Metin platform dışı bir ödeme YÖNTEMİ adlandırıyor mu. Yalnız ev sahibinin yazdığı ve misafire aynen giden metin
 * için (kayıt doğrulaması); misafir mesajının anlamını çözmek için KULLANILMAZ. `paymentContext`: metin bir ücret
 * cümlesinin yanında gidecekse (erken giriş notu + kayıtlı ücret) — para sözcüğü metnin kendisinde olmasa da bağlam var.
 */
export function namesPaymentMethod(text: string, opts: { paymentContext?: boolean } = {}): boolean {
  const folded = foldPaymentText(text);
  if (METHOD_WORDS.test(folded) || hasIbanNumber(folded)) return true;
  return PLACE_OR_MANNER.test(folded) && (opts.paymentContext === true || PAYMENT_CONTEXT.test(folded));
}
