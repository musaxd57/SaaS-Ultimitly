import { describe, it, expect } from "vitest";
import { qrReplyHasDoorCode, redactDoorCodes, withoutQrSecretKbItems, withoutSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// SIR SÜZGECİ — TEK ANLAMLI KİLİT / KUTU ADLARI (10-15, Opus derin denetimi F6; kurucu onayı "senin önerin mantıklıysa yap").
//
// Opus çalıştırarak ölçtü: "Dijital kilit: 4590", "Akıllı kilit 4590", "Use 4590 to open the lockbox" bilgi tabanı süzgecinden de QR çıktı
// taramasından da geçiyordu → bilgi tabanında böyle bir satır varsa QR'ı okutan herkes kodu alabilirdi (kurucu kararı 10-11: QR'da erişim kodu
// ASLA; onaylı rezervasyonda kanal yolu kodu verir — o yol değişmez). Kural: keypad kalıbıyla aynı biçim (ad + ≤20 harflik ayraç + 4–8 hane,
// iki sırada), yalnız TEK ANLAMLI bileşik adlarla. Çıplak "kilit" / "kutu" / "kasa" BİLEREK yok (ilk kalıbın ölçülmüş yıl / adres dersi).
// ---------------------------------------------------------------------------

const dropped = (content: string, title = "Bilgi") => withoutSecretKbItems([{ title, content }]).length === 0;
const droppedQr = (content: string) => withoutQrSecretKbItems([{ category: "general", title: "Giriş", content }]).length === 0;

const LEAKS = [
  "Dijital kilit: 4590",
  "Akıllı kilit 4590",
  "Akıllı kilide 4590 girip kolu çevirin.",
  "Şifreli kilide 4590 girin.",
  "Kodlu kilit için 4590 kullanın.",
  "Use 4590 to open the lockbox.",
  "Lockbox by the door: 4590.",
  "The smart lock opens with 4590.",
  "Keybox at the entrance: 4590",
  "Anahtar kutusu kapının sağında, 4590",
  "4590 ile akıllı kilidi açabilirsiniz.",
];

describe("tek anlamlı kilit / kutu adı + değer — yeni yakalanan biçimler", () => {
  it.each(LEAKS)("bilgi tabanı süzgeci (QR + rezervasyonsuz) eler: %s", (text) => {
    expect(dropped(text)).toBe(true);
    expect(droppedQr(text)).toBe(true);
  });

  it.each(LEAKS)("QR çıktı taraması yakalar ve geçmiş maskesi gizler: %s", (text) => {
    expect(qrReplyHasDoorCode(text, [])).toBe(true);
    // Değer bilgi tabanında geçse de kapı bağlamlı kalıp sızıntıdır (muafiyet yok).
    expect(qrReplyHasDoorCode(text, [text])).toBe(true);
    expect(redactDoorCodes(text)).not.toContain("4590");
  });
});

describe("aşırı eleme yok — ikizler (kalem kalır, cevap durmaz)", () => {
  it.each([
    "Anahtar kutusu kapının sağında, 2. katta.",
    "Akıllı kilidin pili 2024'te değişti.",
    "Dijital kilit 2023 yılında takıldı.",
    "Lockbox kullanım ücreti 1500 TL.",
    "Kutudan anahtarı 15:00'ten sonra alabilirsiniz.",
    "Lockbox 2B dairesinin yanında.",
    "Akıllı kilit pil değişimi için 0532 111 2233 numaralı teknik servisi arayın.",
    "Kilit 4590 numaralı dairenin karşısında.",
    "Kasa 1500 TL.",
  ])("%s", (text) => {
    expect(dropped(text)).toBe(false);
    expect(qrReplyHasDoorCode(text, [])).toBe(false);
  });
});

describe("kilit adı kalıpları — uzun girdide süre (karesel iş kuralı)", () => {
  it.each([
    ["uzun boşluk", `akıllı kilit${" ".repeat(23_000)}x`],
    ["tekrarlanan ad", "dijital kilit ".repeat(1_700)],
    ["rakam + ad dizisi", "4590 lockbox ".repeat(1_700)],
    ["sözcük", `lockbox${"a".repeat(23_000)}`],
  ])("%s", (_name, text) => {
    const t0 = performance.now();
    withoutSecretKbItems([{ title: "x", content: text }]);
    qrReplyHasDoorCode(text.slice(0, 2_000), []);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});

describe("Haiku 10-15 ikinci tur — ayraçta fiyat / tarih / kurulum / adres sözcüğü varsa sır DEĞİL", () => {
  it.each([
    "Dijital kilit bedeli 1500'dür.",
    "Akıllı kilit sistemi 2022 Mart'ta kuruldu.",
    "Akıllı kilitli site, B blok 1204 nolu daire.",
    "2019'da kurulan akıllı kilit çok sağlam.",
    "Smart lock installed in 2021.",
    "Akıllı kilidin pili 1500 saat dayanır.",
  ])("%s", (text) => {
    expect(dropped(text)).toBe(false);
    expect(qrReplyHasDoorCode(text, [])).toBe(false);
  });
});
