import { describe, it, expect } from "vitest";
import { withoutSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// SIR SÜZGECİ (QR + rezervasyonsuz misafir) — 15 ajan incelemesi A07 / A04 (10-01). Kaçan biçimler: tuş takımı, anahtar kasası, kilit kutusu,
// "kombinasyon" ve şifre sözcüğünün diğer dillerdeki karşılıkları. Yalnız SIR anlamı taşıyan sözcükler eklendi; "kasa" / "alarm" / "kilit"
// gibi çok anlamlı isimler BİLEREK yok (yıl / adres / fiyat yanlış elemesi — karakterizasyon `secret-detection-golden.test.ts`).
// ---------------------------------------------------------------------------

const dropped = (content: string, title = "Giriş") => withoutSecretKbItems([{ title, content }]).length === 0;

describe("A07 — yeni yakalanan sır biçimleri", () => {
  it.each([
    "Keypad: 4590",
    "Keypad code 4590#",
    "Tuş takımı: 4590",
    "Tuş takımı şifresi 4590",
    "Anahtar kasası: 7788",
    "Anahtar kasasının şifresi 7788",
    "Key safe 7788",
    "Lockbox: 7788",
    "Lock box code 7788",
    "Kasa kombinasyonu 4590",
    "Bina kapısı kombinasyonu: 4590",
    "The lockbox combination is 4590",
    "WLAN-Passwort: sonnig2024",
    "Mot de passe Wi-Fi : soleil2024",
    "Contraseña del wifi: sol2024",
    "Пароль от Wi-Fi: solnce2024",
    "Kennwort: 4590",
    // isim + kod sözcüğü (değer yazılmasa da — "kapı kodu" ile aynı muhafazakâr kural)
    "Anahtar kasasının şifresi resepsiyondan alınır.",
    "Keypad code is printed on your booking confirmation.",
  ])("🚨 %j → kalem modele GİTMEZ", (icerik) => {
    expect(dropped(icerik)).toBe(true);
  });

  // Değer kalıbı (iki noktasız) ve etiket kalıbı (rakamsız değer) AYRI AYRI — başlık nötr ("Giriş" başlığı isim + kod sözcüğü kalıbını
  // tetiklerdi, mutasyonda ikisi o yüzden yaşadı).
  it.each(["Kennwort 4590", "Mot de passe soleil2024", "Passwort: sonnig", "Contraseña: solazul"])(
    "🚨 %j (nötr başlık) → kalem modele GİTMEZ",
    (icerik) => {
      expect(dropped(icerik, "Bilgi")).toBe(true);
    },
  );

  it.each([
    "Tuş takımı kapının sağında, ışığı yanar.",
    "Kahvaltı kombinasyonu 250 TL.",
    "Passwort vergessen? Bitte schreiben Sie uns.",
    "Day pass for the gym: 20 EUR.",
    "Anahtar kasası bina girişinde, sol duvarda.",
    "Kilit 2019 yılında yenilendi.",
    "Kasada havlu bulabilirsiniz.",
    // Eski kusur (10-01 düzeltildi): ASCII katlamada "kapının" → "ka·pin·in" kod sözcüğü sanılıyor, kalem eleniyordu.
    "Giriş kapının yanında bir tuş takımı var.",
    "Anahtarlar giriş kapının hemen solundaki kutuda.",
  ])("KONTROL — sır değil, kalem KALIR: %j", (icerik) => {
    expect(dropped(icerik, "Bilgi")).toBe(false);
  });
});
