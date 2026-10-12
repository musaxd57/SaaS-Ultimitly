import { describe, it, expect } from "vitest";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";

// ---------------------------------------------------------------------------
// KARBONMONOKSİT — DİL PARİTESİ PİNİ (DENETIM 08-09 #15, 10-12 gece). Terimler `hazard-evidence.ts` gaz ağına eklenmişti ama hiçbir
// test onları anmıyordu (Haiku 10-12) → bir dilin satırı silinse kırmızı olmazdı. Bugünkü davranış AYNEN sabitlenir (yeni kural YOK).
// Bilinen sınır (sabah sorusu G4): "Kohlenmonoxidmelder piept" (dedektör ötüyor) bugün tehlike sayılmıyor — aşağıda belgeli.
// ---------------------------------------------------------------------------
describe("karbonmonoksit — her dilde gaz tehlikesi", () => {
  it.each([
    ["tr", "Evde karbonmonoksit var galiba, başım dönüyor"],
    ["en", "There is carbon monoxide in the flat"],
    ["de", "Ich glaube, es gibt Kohlenmonoxid in der Wohnung"],
    ["fr", "Il y a du monoxyde de carbone dans l'appartement"],
    ["es", "Creo que hay monóxido de carbono en el piso"],
    ["es (aksansız)", "Creo que hay monoxido de carbono en el piso"],
    ["ru", "Кажется, в квартире угарный газ"],
    ["ar", "أعتقد أن هناك أول أكسيد الكربون في الشقة"],
  ])("🚨 %s: açık gaz tehlikesi", (_dil, text) => {
    expect(hazardEvidenceOf(text)).toEqual({ level: "clear", kinds: ["gas"] });
  });

  it("KONTROL: dedektörün YERİNİ sormak tehlike değil", () => {
    expect(hazardEvidenceOf("Wo ist der Kohlenmonoxidmelder?").level).toBe("none");
    // "Der Kohlenmonoxidmelder piept" (ötüyor) bugün de "none" — bilinçli olarak PİNLENMEDİ: sabah sorusu G4 (kural önerisi).
  });
});
