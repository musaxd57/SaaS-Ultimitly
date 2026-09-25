import { describe, it, expect } from "vitest";
import { foldPaymentText, namesPaymentMethod } from "@/lib/payment-method-guard";
import {
  EARLY_CHECKIN_NOTE_PAYMENT_ERROR,
  EARLY_CHECKIN_RULE_ERROR,
  earlyCheckinRuleErrorMessage,
  validateEarlyCheckinRuleInput,
} from "@/lib/early-checkin/rules";

// The host-written late-checkout offer / early check-in note is relayed to guests as the host's word and
// can be auto-surfaced, so it must never carry a payment METHOD or PLACE (Airbnb/Booking TOS forbid off-platform/cash).
// 09-25 kök neden turu ("kapıda" vakası) + üç inceleme: şüphede REDDET (yanlış ret = bir cümle yeniden yazılır; kaçak =
// yapay zekâ misafire platform dışı ödeme talimatı iletir). Eski kalıbın yakaladığı HİÇBİR gerçek talimat geçmez
// (↓regresyon bataryası); yalnız iki dar ve kanıtlanabilir durum serbest kalır: ücret bağlamı yoksa yer sözcüğü, ve para
// sözcüğü taşımayan anahtar/erişim cümlesindeki "kapıda/kapıdaki".
const OLD_REGEX =
  /elden|nakit|nakden|kapıda|iban|havale|\beft\b|western union|money ?gram|papara|\bcash\b|wire transfer|bank transfer|paypal|venmo|zelle/i;

const GENUINE_INSTRUCTIONS = [
  // Eski kalıbın yakaladıkları (üç incelemenin bulduğu yazımlar dahil — ilk iki sürüm bunları GEÇİRİYORDU).
  "12:00'ye kadar geç çıkış 300 TL, elden ödeme",
  "Ekstra gece 500 TL, nakit alırız",
  "IBAN'a havale yapabilirsiniz: 250 TL",
  "Late checkout €40 via PayPal",
  "Extra night, pay cash on arrival",
  "Kapıda ödeme ile 200 TL",
  "Ödeme: kapıda",
  "Ödeme şekli: elden",
  "Geç çıkış ücreti 300 TL, elden.",
  "Geç çıkış 300 TL (kapıda)",
  "Ücret 300 TL. Kapıda alınır.",
  "Ödeme\nkapıda",
  "Geç çıkış 300 TL; parayı kapıdaki kutuya bırakın.",
  "Geç çıkış ücretini kapıdaki görevliye ödeyin.",
  "Ödeme eldendir.",
  "Geç çıkış bedeli kapıda alınır.",
  "Tutar kapıda alınır.",
  "Geç çıkış 300 TRY, kapıda.",
  "Geç çıkış 50 CHF elden",
  "Geç çıkış 500, kapıda.",
  "Geç çıkış mümkün; kapıda alırız.",
  "300TLnakit",
  "Anahtar kapıdaki kutuda; bedelini de oraya bırakın.",
  // Türkçe büyük harf (JS /i "İ/I"yı katlamaz — eski kalıp bunları KAÇIRIYORDU).
  "KAPIDA ÖDEME alınır.",
  "İBAN ile ödeyin.",
  "NAKİT ödeme.",
  // Yöntem adı geçmeyen yön talimatı, IBAN biçimli numara, yeni raylar, diğer diller.
  "Please pay the cleaner directly.",
  "Transfer the fee to my account.",
  "Ücreti hesabıma gönderin.",
  "Ödeme için: TR12 0006 1005 1978 6457 8413 26",
  "Payments are taken at the door",
  "Fees are collected in person",
  "Pay on check-in, 20 EUR",
  "Ücreti girişte alınır.",
  "Revolut ile gönderin",
  "Payable via Wise",
  "Banka hesabımıza yatırın",
  "Bitte zahlen Sie bar",
  "Zahlung in bar",
  "Paiement en liquide",
  "Pago en efectivo",
  "Оплата наличными",
];

describe("ev sahibi metninde ödeme yöntemi/yeri — şüphede REDDET", () => {
  it("gerçek talimatların HEPSİ reddedilir (teklif bağlamında)", () => {
    for (const s of GENUINE_INSTRUCTIONS) expect(namesPaymentMethod(s, { paymentContext: true }), s).toBe(true);
  });

  it("🚨 REGRESYON YOK: eski kalıbın yakaladığı her gerçek talimat yeni süzgeçte de reddedilir", () => {
    const caughtByOld = GENUINE_INSTRUCTIONS.filter((s) => OLD_REGEX.test(s));
    expect(caughtByOld.length).toBeGreaterThan(15); // anti-vakum
    for (const s of caughtByOld) expect(namesPaymentMethod(s, { paymentContext: true }), s).toBe(true);
  });

  it("bayrak olmadan da: metnin KENDİ para sözcüğü bağlamdır (bedel/tutar/TRY/CHF/₺ — ücretsiz kuralın notunda da)", () => {
    for (const s of [
      "Geç çıkış bedeli kapıda alınır.",
      "Tutar kapıda alınır.",
      "Geç çıkış 300 TRY, kapıda.",
      "Geç çıkış 50 CHF elden",
      "Masraf kapıda ödenir.",
      "₺300 kapıda",
    ]) {
      expect(namesPaymentMethod(s), s).toBe(true);
    }
  });

  it("temiz fiyat/koşul satırı geçer (teklif bağlamında)", () => {
    for (const s of [
      "13:00'e kadar geç çıkış 250 TL, uygunluğa bağlı.",
      "Ekstra bir gece kalış mümkün, gecelik 600 TL.",
      "Late checkout until 2pm is 40 EUR, subject to the next booking.",
      "Havalandırmayı açık bırakın; geç çıkış 100 TL.",
      "Geç çıkış 20 EUR; parasols are on the balcony.",
      "", // empty = clears the offer, must be allowed
    ]) {
      expect(namesPaymentMethod(s, { paymentContext: true }), s).toBe(false);
    }
  });

  it("ücret bağlamı YOKSA yer sözcüğü ödeme değildir (ücretsiz erken giriş notu); bağlam varsa ödeme yeridir", () => {
    const cases: [string, boolean][] = [
      // [metin, ücret bağlamında reddedilir mi]
      ["12:00'de kapıda karşılarız.", true],
      ["Anahtarlar elden teslim edilir.", true],
      ["In person check-in: we meet you at the flat", true],
      ["Kapıda ücretsiz otopark var.", true],
      // Erişim nesnesi (kilit) + para sözcüğü yok → konum, ücret bağlamında da serbest.
      ["Kapıda şifreli kilit var.", false],
    ];
    for (const [s, withFee] of cases) {
      expect(namesPaymentMethod(s), s).toBe(false);
      expect(namesPaymentMethod(s, { paymentContext: true }), `${s} (ücretli)`).toBe(withFee);
    }
  });

  it("anahtar/erişim cümlesi: para sözcüğü TAŞIMIYORSA 'kapıda/kapıdaki' konumdur — ücret bağlamında da", () => {
    for (const s of ["Anahtar kapıdaki kutuda.", "Anahtar kapıdaki kilitli kutudadır.", "Anahtarı kapıdaki kutuya bırakın.", "Kapı kodu kapıdaki panelde yazıyor."]) {
      expect(namesPaymentMethod(s, { paymentContext: true }), s).toBe(false);
    }
    // Metinde para sözcüğü varsa istisna DÜŞER: anahtar cümlesinin yanında ödeme anlatılıyor olabilir.
    for (const s of ["Anahtar kapıdaki kutuda; bedelini de oraya bırakın.", "Anahtar kapıdaki kutuda ve ücret Airbnb üzerinden ödenir"]) {
      expect(namesPaymentMethod(s, { paymentContext: true }), s).toBe(true);
    }
    // Erişim nesnesi yoksa "kapıdaki kutu" ödeme kutusu olabilir.
    expect(namesPaymentMethod("Kapıdaki kutuya bırakın.", { paymentContext: true })).toBe(true);
  });

  it("Türkçe katlama; yöntem adı sözcük başında aranır ('Libanlı' ≠ IBAN, 'left' ≠ EFT); IBAN biçimi en az 12 rakam", () => {
    expect(foldPaymentText("KAPIDA ÖDEME İBAN NAKİT Işık")).toBe("kapida odeme iban nakit isik");
    for (const s of [
      "Libanlı komşumuz yardımcı olur.",
      "Turn left after the gate.",
      "Ödevinizi bitirince çıkabilirsiniz.",
      "Kapı kodu AB12 3456, geç çıkış 300 TL.",
      "Wi-Fi şifresi Lale2025DE12345678; geç çıkış 20 EUR",
      "Rezervasyon kodunuz HM12ABCDEFGHJKLM, geç çıkış 20 EUR",
      "Anahtar kutusu doğrudan giriş kapısının yanında; geç çıkış 20 EUR.",
    ]) {
      expect(namesPaymentMethod(s, { paymentContext: true }), s).toBe(false);
    }
  });

  it("⚠️ bilinen bedeller (pinli, güvenli yön — ev sahibi cümleyi yeniden yazar)", () => {
    // Fiyatla aynı metinde "kapıda": park yeri de olsa ödeme yeri sayılır.
    expect(namesPaymentMethod("Kapıda ücretsiz otopark var; geç çıkış 100 TL.", { paymentContext: true })).toBe(true);
    // Olumsuzlanan yöntem de reddedilir.
    expect(namesPaymentMethod("Nakit gerekmez, her şey Airbnb üzerinden.")).toBe(true);
  });
});

describe("erken giriş notu: kural doğrulaması + ev sahibine ÖZEL hata", () => {
  const base = { mode: "auto", earliest: "12:00", fee: { amount: 300, currency: "TRY" } };
  it("anahtar konumu notu ücretli kuralda da geçerli; ödeme yeri notu geçersiz", () => {
    for (const note of ["Anahtar kapıdaki kilitli kutuda.", "Anahtarı kapıdaki kutuya bırakın."]) {
      expect(validateEarlyCheckinRuleInput({ ...base, note })?.note, note).toBe(note);
    }
    // Ücretsiz kuralda "kapıda / elden" ödeme değildir.
    for (const note of ["Kapıda karşılarız.", "Anahtarlar elden teslim edilir."]) {
      expect(validateEarlyCheckinRuleInput({ ...base, fee: null, note })?.note, note).toBe(note);
    }
    // Ücretli kuralda: onay metnindeki ücret cümlesinin yanında "Kapıda alırız." kapıda ödemedir.
    for (const note of ["Kapıda alırız.", "Ücreti kapıda alırız.", "KAPIDA ÖDEME alınır.", "İBAN ile ödeyin.", "Anahtarlar elden teslim edilir."]) {
      expect(validateEarlyCheckinRuleInput({ ...base, note }), note).toBeNull();
    }
  });

  it("ev sahibi neyi düzelteceğini görür: ödeme notunda ÖZEL metin, başka hatada genel metin", () => {
    expect(earlyCheckinRuleErrorMessage({ ...base, note: "Kapıda alırız." })).toBe(EARLY_CHECKIN_NOTE_PAYMENT_ERROR);
    expect(earlyCheckinRuleErrorMessage({ ...base, note: "Lütfen sessiz olun.", earliest: "25:00" })).toBe(EARLY_CHECKIN_RULE_ERROR);
    expect(earlyCheckinRuleErrorMessage({ ...base, fee: null, note: "Kapıda karşılarız.", earliest: "noon" })).toBe(EARLY_CHECKIN_RULE_ERROR);
    expect(earlyCheckinRuleErrorMessage(null)).toBe(EARLY_CHECKIN_RULE_ERROR);
  });
});
