import { describe, it, expect } from "vitest";
import { redactContactsFromText, PHONE_MASK, EMAIL_MASK } from "@/lib/contact-redact";

// G7-a (kurucu kararı 10-13 "İkisi de"; DENETIM 08-09 #20): KVKK süpürgelerinde ad maskesinden SONRA metindeki telefon + e-posta.
describe("redactContactsFromText — telefon ve e-posta maskelenir", () => {
  it.each([
    ["kurucunun örneği", "[Misafir] Hanım, numaram +90 555 123 45 67", `[Misafir] Hanım, numaram ${PHONE_MASK}`],
    ["0 önekli GSM", "Beni 0555 123 45 67'den arayın", `Beni ${PHONE_MASK}'den arayın`],
    ["bitişik GSM", "tel: 05551234567", `tel: ${PHONE_MASK}`],
    ["öneksiz GSM", "555 123 45 67 numarasına yazın", `${PHONE_MASK} numarasına yazın`],
    ["sabit hat", "Ofis: 0212 555 12 34", `Ofis: ${PHONE_MASK}`],
    ["parantezli", "(0532) 123-45-67", `(${PHONE_MASK}`],
    ["0090", "0090 532 123 45 67", PHONE_MASK],
    ["uluslararası", "Call me at +49 30 12345678 please", `Call me at ${PHONE_MASK} please`],
    ["uluslararası tireli", "+1 (415) 555-0132", PHONE_MASK],
    ["e-posta", "Fatura için ayse.yilmaz@example.com adresine", `Fatura için ${EMAIL_MASK} adresine`],
    ["Türkçe harfli e-posta", "şükrü@örnek.com.tr yazın", `${EMAIL_MASK} yazın`],
    ["ikisi birden", "a@b.co ve +90 532 000 00 00", `${EMAIL_MASK} ve ${PHONE_MASK}`],
  ])("%s", (_l, input, expected) => {
    expect(redactContactsFromText(input)).toBe(expected);
  });
});

describe("KONTROL — telefon OLMAYAN sayılar AYNEN kalır", () => {
  it.each([
    ["tarih + saat", "Giriş 12.10.2026 15:00, çıkış 14.10.2026 11:00"],
    ["ISO tarih", "2026-10-12T15:00:00Z"],
    ["fiyat", "Toplam 1.500.000 TL, depozito 2.500 TL"],
    ["kapı kodu", "Kapı kodu 4821, kasa 739104"],
    ["Wi-Fi şifresi", "Şifre: 12345678"],
    ["IBAN", "TR12 0006 1005 1978 6457 8413 26"],
    ["daire / kat", "Daire 12, kat 3, 2 kişi"],
    ["saat aralığı", "15:00-17:45 arası"],
    ["kısa uluslararası", "+90 212"],
    ["10 haneli onay kodu (5 ile başlamıyor)", "Booking onay no 4123456789"],
    ["uzun sayının parçası", "Kargo 1234055512345671234"],
    // Mutasyon 10-13 (G7a): uluslararası biçim ama telefon hane sayısı dışında (8–9 ve 15'ten uzun).
    ["8 haneli uluslararası", "+49 30 1234"],
    ["15'ten uzun uluslararası", "+1 2345 6789 0123 4567"],
  ])("%s", (_l, input) => {
    expect(redactContactsFromText(input)).toBe(input);
  });

  it("boş metin", () => {
    expect(redactContactsFromText("")).toBe("");
  });
});

describe("idempotent + maliyet", () => {
  it("maskeli metin ikinci geçişte değişmez", () => {
    const once = redactContactsFromText("numaram +90 555 123 45 67, e-posta a@b.com");
    expect(redactContactsFromText(once)).toBe(once);
  });

  it.each([
    ["uzun rakam dizisi", "1".repeat(50_000)],
    ["boşluklu rakamlar", "1 ".repeat(25_000)],
    ["uzun yerel kısım, @ yok", "a".repeat(50_000)],
    ["uzun yerel kısım + @", `${"a".repeat(50_000)}@`],
    ["tekrarlanan + işareti", "+9 ".repeat(20_000)],
  ])("%s → 300 ms altında", (_l, text) => {
    const t0 = performance.now();
    redactContactsFromText(text);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
