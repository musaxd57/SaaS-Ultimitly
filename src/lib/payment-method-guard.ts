// ---------------------------------------------------------------------------
// EV SAHİBİ METNİNDE ÖDEME YÖNTEMİ (09-25; eski `OFFER_PAYMENT_METHOD_RX`in yerine). Ev sahibinin misafire AYNEN
// giden metni (geç çıkış teklifi, erken giriş notu) platform dışı ödeme yöntemi adlandıramaz — Airbnb/Booking
// şartları nakit/havale gibi düzenlemeleri yasaklar. Kayıtta reddedilir; misafir mesajına UYGULANMAZ.
//
// Kök neden (denetim 09-25, "kapıda" vakası): eski kalıp bağlamsız alt dizeydi. "Anahtar kapıdaki kutuda" (kapı
// konumu) ve "anahtarlar elden teslim edilir" (anahtar teslimi) ödeme yöntemi sayılıyor, erken giriş kuralı genel bir
// hatayla kaydedilemiyordu; "Libanlı" içindeki "iban" da. Öte yandan JS `/i` Türkçe büyük harfi katlamaz: "KAPIDA
// ÖDEME", "İBAN", "NAKİT" geçiyordu. Bir kelimeye istisna eklemek yerine anlam iki parçaya ayrıldı:
//  · Kendi başına ödeme yöntemi olan adlar (nakit, IBAN, havale, PayPal…) her yerde yöntemdir.
//  · YER/BİÇİM sözcükleri ("kapıda", "elden", "at the door"…) ancak AYNI cümlecikte bir ödeme/ücret/para birimi
//    sözcüğüyle yöntem olur: "kapıda ödeme" evet, "kapıdaki kutu" hayır.
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
    `paypal|venmo|zelle|revolut|kripto|crypto|bitcoin|usdt(?![a-z])|banka hesab|hesap numara|bank account|account number|` +
    // DE/FR/IT/RU: yalnız çok anlamlı olmayanlar (ES "efectivo" = "etkili" de, alınmadı).
    `barzahlung|bargeld|uberweisung|especes|virement|contanti|bonifico)|наличн`,
);

/** Yer/biçim: yalnız aynı cümlecikte ödeme bağlamıyla yöntem olur. */
const PLACE_OR_MANNER = new RegExp(`${W}(?:kapida|elden(?![a-z])|at the door|on arrival|upon arrival|in person)`);

/** Ödeme bağlamı: ödeme fiili/adı, ücret, para, para birimi. */
const PAYMENT_CONTEXT = new RegExp(
  `${W}(?:ode(?:m|n|y|r|d|s)|tahsil|ucret|para(?![vgm])|fiyat|pay(?:s|ed|ment|able)?(?![a-z])|paid|fee(?![a-z])|charge|price|cost|` +
    `tl(?![a-z])|lira|euro|eur(?![a-z])|avro|usd(?![a-z])|dolar|dollar|gbp(?![a-z])|sterlin)|[₺€$£]`,
);

/** Cümlecik sınırı: noktalama ve satır sonu; iki rakam arasındaki nokta/virgül/iki nokta ("12.00", "1.500") bölmez. */
function clausesOf(folded: string): string[] {
  return folded.split(/(?<!\d)[.,:]|[.,:](?!\d)|[;!?\n()]/);
}

/**
 * Metin platform dışı bir ödeme YÖNTEMİ adlandırıyor mu. Yalnız ev sahibinin yazdığı ve misafire aynen giden metin
 * için (kayıt doğrulaması); misafir mesajının anlamını çözmek için KULLANILMAZ.
 */
export function namesPaymentMethod(text: string): boolean {
  const folded = foldPaymentText(text);
  if (METHOD_WORDS.test(folded)) return true;
  return clausesOf(folded).some((c) => PLACE_OR_MANNER.test(c) && PAYMENT_CONTEXT.test(c));
}
