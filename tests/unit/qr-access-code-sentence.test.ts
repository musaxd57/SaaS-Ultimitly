import { describe, it, expect } from "vitest";
import { qrReplyHasDoorCode, redactDoorCodes, withoutQrSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// QR "KAPI KODU YOK" deliği (sızma testi 11-14, E-1; bağımsız doğrulama V-E1). Kurucu kuralı: QR'da kapı / anahtar kutusu kodu HİÇBİR
// biçimde verilmez (F02, kurucu kararı 10-11). Kod sözcüğü ("kod / şifre") geçmeyen doğal cümleler — "Kutuyu 4590 ile açabilirsiniz",
// "the combination is 4590" — `checkin` dışı kategoride bilgi tabanı süzgecinden ve cevap taramasından geçiyordu; bilgi tabanı muafiyeti
// de ters çalışıyordu ("PIN: 4590" cevabı, 4590 bilgi tabanında geçtiği için gidiyordu). Ayrıca taramada yazıyla, virgülle ve tuş başlığı
// emojisiyle yazılmış kod tanınmıyordu.
// ---------------------------------------------------------------------------

const kb = (title: string, content: string, category = "general") => ({ category, title, content });
const TR_ITEM = kb("Anahtar", "Anahtar kapının yanındaki gri kutuda. Kutuyu 4590 ile açabilirsiniz.");
const EN_ITEM = kb("Arrival", "The key is in the grey box by the front door; the combination is 4590.", "welcome");

describe("bilgi tabanı (QR): erişim adı + kod benzeri sayı aynı cümlede → kalem QR modeline GİTMEZ", () => {
  it("🚨 kod sözcüğü olmadan yazılmış anahtar kutusu kodu (TR / EN) düşer", () => {
    expect(withoutQrSecretKbItems([TR_ITEM])).toEqual([]);
    expect(withoutQrSecretKbItems([EN_ITEM])).toEqual([]);
    expect(withoutQrSecretKbItems([kb("Giriş", "Anahtarlar kasada, kasa 2580.")])).toEqual([]);
    expect(withoutQrSecretKbItems([kb("Keys", "Keys are in the lockbox, use 7391 to open it.")])).toEqual([]);
  });

  it("aşırı uygulama yok: sayısız erişim cümlesi, fiyat, yıl, daire, telefon, 3 hane, sokak kalır", () => {
    const keep = [
      kb("Anahtar", "Anahtarı çıkışta masaya bırakın."),
      kb("Ücretler", "Anahtar kaybı 1500 TL."),
      kb("Bina", "Bina 1985 yapımı, anahtarlar kapıcıda."),
      kb("Çöp", "Çöp kutuları 150 metre ileride."),
      kb("Adres", "Daire 1204, anahtar kutuda."),
      kb("Kapıcı", "Kapıcı 0532 111 2233, anahtar onda."),
      kb("Konum", "Anahtar ofisimiz Atatürk Caddesi No 1453 adresinde."),
      kb("Otopark", "Otopark 2. katta, 24 saat açık."),
    ];
    expect(withoutQrSecretKbItems(keep)).toEqual(keep);
  });
});

describe("cevap taraması (QR): aynı cümle ve kodlanmış biçimler yakalanır", () => {
  it("🚨 bilgi tabanından aynen yazılan erişim cümlesi", () => {
    expect(qrReplyHasDoorCode("Anahtar kapının yanındaki gri kutuda. Kutuyu 4590 ile açabilirsiniz.", [])).toBe(true);
    expect(qrReplyHasDoorCode("The key is in the grey box by the front door; the combination is 4590.", [])).toBe(true);
  });

  it("🚨 bilgi tabanı muafiyeti erişim cümlesindeki sayıyı KAPSAMAZ (PIN / şifre / kutunun kodu)", () => {
    const allowed = ["Anahtar kapının yanındaki gri kutuda. Kutuyu 4590 ile açabilirsiniz."];
    expect(qrReplyHasDoorCode("PIN: 4590", allowed)).toBe(true);
    expect(qrReplyHasDoorCode("Kutunun kodu 4590.", allowed)).toBe(true);
    // Muafiyet ERİŞİMSİZ cümlede sürer ("Daire 4590" bilgi tabanında daire numarası).
    expect(qrReplyHasDoorCode("Daire kodu 4590 olan kat 3'tedir.", ["Daire 4590, 3. kat."])).toBe(false);
  });

  it("🚨 yazıyla / virgülle / tuş başlığı emojisiyle yazılmış kod (etiketli)", () => {
    expect(qrReplyHasDoorCode("Kapı kodu: dört beş dokuz sıfır.", [])).toBe(true);
    expect(qrReplyHasDoorCode("The door code is four five nine zero.", [])).toBe(true);
    expect(qrReplyHasDoorCode("Kapı kodu 4, 5, 9, 0", [])).toBe(true);
    expect(qrReplyHasDoorCode("Kapı kodu 4\uFE0F\u20E35\uFE0F\u20E39\uFE0F\u20E30\uFE0F\u20E3", [])).toBe(true);
  });

  it("aşırı uygulama yok: sayı sözcüğü / virgüllü liste kapı bağlamı olmadan sızıntı değil", () => {
    expect(qrReplyHasDoorCode("Bir iki üç gün kalabilirsiniz; dört kişilik yatak var.", [])).toBe(false);
    expect(qrReplyHasDoorCode("Odalar 1, 2, 3, 4 numaralı katlarda.", [])).toBe(false);
    expect(qrReplyHasDoorCode("Anahtarı çıkışta masaya bırakın.", [])).toBe(false);
    expect(qrReplyHasDoorCode("Anahtar kaybı 1500 TL.", [])).toBe(false);
  });

  it("geçmiş maskesi de erişim cümlesindeki kodu gizler", () => {
    expect(redactDoorCodes("Kutuyu 4590 ile açabilirsiniz, anahtar içinde.")).not.toContain("4590");
  });

  // Mutasyon 11-14 (Q7–Q9): aşağıdaki üç yol testsizdi — virgüllü kodun maskelenmesi, TEK erişim adı "combination", kod sözcüğü OLMADAN
  // aralıklı / yazıyla yazılmış kod.
  it("🚨 geçmiş maskesi virgülle yazılmış kodu da gizler (rakamlar arası virgül + boşluk ayraçtır)", () => {
    const out = redactDoorCodes("Kapı kodu: 4, 5, 9, 0");
    expect(out.replace(/\D/g, "")).not.toContain("4590");
    expect(out).not.toMatch(/4,\s?5,\s?9,\s?0/);
  });

  it("🚨 tek erişim adı 'combination' (anahtar / kutu / lock geçmeyen cümle) yine erişim cümlesidir", () => {
    expect(withoutQrSecretKbItems([kb("Bike", "Bike storage: the combination is 7391.")])).toEqual([]);
    expect(qrReplyHasDoorCode("The combination is 7391.", [])).toBe(true);
  });

  it("🚨 kod sözcüğü OLMADAN aralıklı ya da yazıyla yazılmış kod (erişim cümlesinde)", () => {
    expect(withoutQrSecretKbItems([kb("Anahtar", "Anahtar gri kutuda; kutuyu 4 5 9 0 ile açabilirsiniz.")])).toEqual([]);
    expect(withoutQrSecretKbItems([kb("Anahtar", "Anahtar gri kutuda; kutuyu dört beş dokuz sıfır ile açabilirsiniz.")])).toEqual([]);
    expect(qrReplyHasDoorCode("Anahtar gri kutuda; kutuyu 4 5 9 0 ile açabilirsiniz.", [])).toBe(true);
  });
});
