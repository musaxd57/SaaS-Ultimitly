import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType, detectRiskTypes } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// KISA ACİL SÖZCÜKLERİ TAM SÖZCÜK (kurucu onayı 09-26, #51). Alt dize eşleşmesi canlıda yanlış acil üretiyordu: Almanca
// "Gastgeber" (ev sahibi) içindeki "gas", "fireplace" içindeki "fire", ASCII katlamada "açılıyor" → "acilıyor" içindeki
// "acil". Sonuç: bu mesajlara hiç otomatik cevap gitmiyor + acil rozeti. İKİ YÖNLÜ: gerçek acil (tam sözcük + bileşik
// listesi) AYNEN yakalanır.
// ---------------------------------------------------------------------------

const FALSE_ALARMS: [string, string][] = [
  ["Ich möchte mit dem Gastgeber sprechen.", "DE ev sahibi"],
  ["Danke an den Gastgeber, alles super!", "DE ev sahibine teşekkür"],
  ["Die Gastfreundschaft war toll.", "DE misafirperverlik"],
  ["Is the fireplace working?", "EN şömine"],
  ["Is there a firework show tonight?", "EN havai fişek"],
  ["Havuz ne zaman açılıyor?", "TR açılıyor (ASCII açıl→acil)"],
  ["Sauna kaçta açılıyor?", "TR açılıyor"],
  ["Kapı kolayca açıldı, teşekkürler.", "TR açıldı"],
  ["The facilities are great.", "EN facilities"],
  ["C'est facile, merci.", "FR facile"],
  // Onay paketi `docs/ONAY-acil-asci-carpismasi-2026-09-10.md` satırları + ASCII yazım + "acılı" (baharatlı).
  ["Market kaçta açılıyor?", "TR onay paketi"],
  ["Kahvaltı açılış saati nedir?", "TR açılış"],
  ["Balkon kapısı açılır mı?", "TR açılır"],
  ["What facilities does the apartment have?", "EN facilities soru"],
  ["Are there laundry facilities nearby?", "EN facilities yakın"],
  ["Es muy fácil llegar?", "ES fácil"],
  ["Havuz ne zaman acilir?", "TR ASCII açılır"],
  ["Kapi acildi tesekkurler", "TR ASCII açıldı (acildi BİLEREK listede yok)"],
  ["Acılı yemek önerir misiniz?", "TR acılı (acili BİLEREK listede yok)"],
  ["We had a campfire, lovely", "EN campfire"],
  ["Die Gasse ist ruhig", "DE Gasse (gas + e)"],
];

const TRUE_EMERGENCIES: [string, string][] = [
  ["I smell gas in the kitchen", "EN gas"],
  ["There is a gas leak!", "EN gas leak"],
  ["GAS! Please help", "EN büyük harf"],
  ["Es riecht nach Gas", "DE Gas tam sözcük"],
  ["Starker Gasgeruch in der Küche", "DE bileşik Gasgeruch"],
  ["Wir haben ein Gasleck!", "DE bileşik Gasleck"],
  ["Fire in the kitchen!", "EN fire"],
  ["The apartment is on fire", "EN on fire"],
  ["Should I call the firefighters?", "EN firefighters"],
  ["ACİL! Su her yeri bastı", "TR ACİL büyük harf"],
  ["Acil durum var, lütfen arayın", "TR acil durum"],
  ["Acilen gelir misiniz?", "TR acilen"],
  ["acil yardim lazim", "TR ASCII yazım"],
  // Alt dize eşleşmesinin tuttuğu biçimler GERİLEMESİN: Türkçe ad çekimleri + uzatılmış yazım + çoğul/bileşik.
  ["Acile gittik, lütfen arayın", "TR acile"],
  ["Acilde bekliyoruz", "TR acilde"],
  ["acilden döndük", "TR acilden"],
  ["Aciliyeti var lütfen", "TR aciliyeti"],
  ["Bu acildir!", "TR acildir"],
  ["çok acil", "TR çok acil"],
  ["ACİLLL YARDIM", "TR uzatılmış"],
  ["FIREEE", "EN uzatılmış"],
  ["gasss smell here", "EN uzatılmış gas"],
  ["There are wildfires near the house", "EN wildfires"],
  ["fires nearby!", "EN fires"],
  // ASCII katlama ı/i yazım hatasını da tutar (standart katlama tutmazdı).
  ["Acıl durum var, yardım edin", "TR ı/i yazım hatası"],
];

describe("kısa acil sözcükleri — tam sözcük", () => {
  for (const [m, why] of FALSE_ALARMS) {
    it(`yanlış alarm YOK: ${why} — "${m}"`, () => {
      expect(detectRiskTypes(m)).not.toContain("safety_emergency");
    });
  }
  for (const [m, why] of TRUE_EMERGENCIES) {
    it(`gerçek acil AYNEN: ${why} — "${m}"`, () => {
      expect(detectRiskType(m)).toBe("safety_emergency");
    });
  }
  it("büyük/küçük harf ve Türkçe büyük İ fark etmez (üç katlama adayı)", () => {
    for (const m of ["ACIL", "ACİL", "acil", "Acil", "GAS", "Fire", "ACİLEN"]) expect(detectRiskType(m)).toBe("safety_emergency");
  });
  it("aşırı uygulama yok: kapı açılmıyor ŞİKÂYET olarak tutulmaya devam eder (acil etiketi yerine)", () => {
    expect(classifyFallback("Kapı açılmıyor, kod çalışmıyor.").isComplaint).toBe(true);
    expect(detectRiskType("Kapı açılmıyor, kod çalışmıyor.")).toBe("complaint");
  });
});
