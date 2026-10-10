import { describe, it, expect } from "vitest";
import { withoutSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// SIR SÜZGECİ — "KAPI + AÇ- FİİLİ + DEĞER" (Haiku QR güvenlik taraması F1, 10-10). Kod sözcüğü olmadan ve bitişik olmayan kapı açma
// talimatı ("Kapı açma: 4590") QR bağlamına sızabiliyordu. Kalıp DAR: "serbest metin" izni yok (bitişik kalıbın ölçülmüş dersi — adres /
// telefon / yıl eleniyordu); değer ya iki nokta / "için" ardında ya da cümleyi bitiren / giriş fiiliyle biten çıplak değer. Sır OLMAYAN
// ikizler (yıl, fiyat, saat, adres, rakamsız talimat) kalem olarak KALIR — eleme "güvenli yön" değildir, kalem tümden düşer.
// ---------------------------------------------------------------------------

const dropped = (content: string, title = "Bilgi") => withoutSecretKbItems([{ title, content }]).length === 0;

describe("kapı + aç- fiili + değer", () => {
  it.each([
    "Kapı açma: 4590",
    "Kapı açılış 4590",
    "Girişteki kapı açma tuşu için 4590",
    "Kapıyı açmak için: 2580",
    "Kapıyı açmak için 2580 girin.",
    "Bina kapısını açmak için 25801 yazın",
    "KAPI AÇMA: 4590",
    "Kapı açılış: 4590 ve ardından yeşil tuşa basın.",
    "Dış kapı açılış 7788.",
    // Haiku incelemesi (10-10 gece): ayraç çeşitleri, "giriş" adı, İngilizce "door opens with".
    "Kapı açma - 4590",
    "Kapı açma – 4590",
    "Kapı açma (4590)",
    "Bina girişini açmak için 4590 yazın.",
    "Girişi açmak için 4590 girin",
    "The door opens with 4590.",
    "The front door unlocks with 4590",
  ])("🚨 %j → kalem modele GİTMEZ", (icerik) => {
    expect(dropped(icerik)).toBe(true);
  });

  it.each([
    "Kapıyı açarken 2024 model kilide dikkat edin.",
    "Kapı açma ücreti: 1500 TL",
    "Kapı açma ücreti: 1500 ₺",
    "Kapı açma saatleri 08:00–22:00",
    "Kapı açık, daire 3. katta.",
    "Kapıyı açmak için kartınızı okutun.",
    "Kapı açılışı 1990 yılında yapıldı.",
    "Kapıcı açık adres: Moda Cad. 12, 34710 Kadıköy",
    "Kapıyı açınca sağda 2 numaralı daire.",
    "Kapı açıkken klimayı kapatın.",
    // Haiku incelemesi (10-10 gece): para birimi yazımları, ondalık fiyat, "için" + yıl, telefon, saat.
    "Kapı açma ücreti: 1500 euro",
    "Kapı açma ücreti: 1500 EUR",
    "Kapı açma ücreti: 1500 dolar",
    "Kapı açma ücreti: 1500,00 TL",
    "Kapı açılış sistemi için 2024 yılında yenilendi.",
    "Girişi açmak için kapıcıyı arayın: 0532 111 2233",
    "Giriş açılış saati: 14:00",
    "The door opens at 9 am.",
  ])("KONTROL — sır değil, kalem KALIR: %j", (icerik) => {
    expect(dropped(icerik)).toBe(false);
  });

  it("süre: 24.000 karakterlik kötü niyetli tekrar (kapı açma + rakam yakın ıska) doğrusal kalır", () => {
    const attacks = [
      "kapı açma ".repeat(2_400),
      "kapıyı açmak için ".repeat(1_300),
      "kapı açma tuşu 12 ".repeat(1_300),
      `kapı ${"a".repeat(23_990)}`,
      // 🚨 Haiku incelemesi: BOŞLUK DİZİSİ — iki bitişik boşluk niceleyicisi (`\s*(?::|\s+için)`, ileriye bakışta `\s*…\s+`) burada
      // karesel geri izliyordu (23.000 boşlukta kalıp başına ~0,8–1,4 sn).
      `kapı açma${" ".repeat(23_800)}x`,
      `kapı açma 1234${" ".repeat(23_800)}x`,
      `kapı açma için${" ".repeat(23_800)}x`,
      `kapı açma${"\t".repeat(23_800)}x`,
      `giriş açma${" ".repeat(23_800)}1`,
      `door opens with${" ".repeat(23_800)}x`,
      // Aynı sınıf, 10-02 tuş paneli kalıplarında (geniş süre taraması 10-10 gece): "rakam + boşluk dizisi", "tuşla + boşluk dizisi".
      `1234${" ".repeat(23_800)}x`,
      `panel 1234${" ".repeat(23_800)}x`,
      `tuşlayın${" ".repeat(23_800)}x`,
      `tuşlayın${" \n".repeat(11_900)}x`,
    ];
    for (const a of attacks) {
      const t0 = performance.now();
      withoutSecretKbItems([{ title: "Bilgi", content: a.slice(0, 23_900) }]);
      expect(performance.now() - t0, a.slice(0, 20)).toBeLessThan(500);
    }
  });
});
