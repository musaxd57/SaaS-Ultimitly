import { describe, it, expect } from "vitest";
import { gasDetectorSounding } from "@/lib/ai/gas-detector-alarm";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";
import { isSafetyEmergencyText } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// G4 (kurucu kararı 10-13 "Olası gaz acili say"; DENETIM 08-09 #15): gaz / CO DEDEKTÖRÜ ötüyor → yapay zekâ cevaplamaz, ev sahibine
// acil. Önce: "Der Kohlenmonoxidmelder piept", "CO alarm is beeping", "Gaz alarmı ötüyor" QR'da tehlike YOK sayılıyordu ("Gaz alarmı
// ötüyor" → none), Almanca / CO kısaltmalı biçimler kanal ağında da acil değildi → bilgi cevabı gidebilirdi.
// ---------------------------------------------------------------------------

const SOUNDING: Array<[string, string]> = [
  ["tr", "Karbonmonoksit dedektörü ötüyor"],
  ["tr", "Gaz alarmı ötüyor"],
  ["tr", "Doğalgaz alarmı çalıyor, ne yapalım"],
  ["tr", "CO dedektörü sürekli bipliyor"],
  ["tr (soru)", "Gaz alarmı neden çalıyor?"],
  ["tr ('ne' soru, olumsuz değil)", "Gaz dedektörü ne ötüyor böyle"],
  ["en", "The carbon monoxide detector is beeping"],
  ["en", "CO alarm is beeping"],
  ["en", "The CO detector keeps chirping"],
  ["en", "Our gas alarm went off"],
  ["en (pil uyarısı da ev sahibine)", "The CO detector battery is low, it chirps every minute"],
  ["de", "Der Kohlenmonoxidmelder piept"],
  ["de", "Der CO-Melder piept seit einer Stunde"],
  ["de (ters sıra)", "Es piept der Gasmelder im Flur"],
  ["fr", "Le détecteur de monoxyde de carbone sonne"],
  ["fr", "Le détecteur de CO sonne depuis ce matin"],
  ["es", "El detector de monóxido de carbono suena"],
  ["es", "La alarma de gas está sonando"],
  ["es (ters sıra)", "Suena la alarma de gas"],
];

const NOT_SOUNDING: Array<[string, string]> = [
  ["yer sorusu", "Karbonmonoksit dedektörü nerede?"],
  ["yer sorusu", "Where is the CO detector?"],
  ["yer sorusu", "Wo ist der Kohlenmonoxidmelder?"],
  ["varlık sorusu", "Is there a carbon monoxide detector?"],
  ["varlık sorusu", "Gibt es einen CO-Melder?"],
  ["yer cümlesi ('is on')", "The CO detector is on the ceiling"],
  ["olumsuz", "The CO alarm is not beeping"],
  ["olumsuz", "Karbonmonoksit dedektörü ötmüyor"],
  ["olumsuz", "Der CO-Melder piept nicht"],
  ["olumsuz", "Le détecteur de gaz ne sonne pas"],
  ["olumsuz", "El detector de CO no suena"],
  ["varsayım", "If the CO alarm goes off, what should we do?"],
  ["varsayım", "Wenn der Gasmelder piept, was sollen wir tun?"],
  ["varsayım", "Eğer gaz alarmı çalarsa ne yapmalıyım?"],
  ["Türkçe koşul eki", "Gaz alarmı çalıyorsa ne yapalım?"],
  ["başka cümlede ses", "Can you check the gas bill? Also the alarm clock is beeping"],
  ["CO2 dedektör değil", "The CO2 monitor is beeping"],
  ["duman dedektörü (bu kuralın konusu değil)", "The smoke detector is beeping"],
];

describe("gasDetectorSounding — gaz / CO dedektörü ötüyor", () => {
  it.each(SOUNDING)("🚨 %s: %s", (_l, text) => {
    expect(gasDetectorSounding(text)).toBe(true);
  });
  it.each(NOT_SOUNDING)("KONTROL %s: %s", (_l, text) => {
    expect(gasDetectorSounding(text)).toBe(false);
  });
  it("boş / tanımsız → false", () => {
    expect(gasDetectorSounding("")).toBe(false);
    expect(gasDetectorSounding(null)).toBe(false);
    expect(gasDetectorSounding(undefined)).toBe(false);
  });
});

describe("iki ağ da aynı kuralı okur", () => {
  it.each(SOUNDING)("QR %s: açık gaz tehlikesi (model çağrılmaz)", (_l, text) => {
    expect(hazardEvidenceOf(text)).toEqual({ level: "clear", kinds: ["gas"] });
  });
  it.each(SOUNDING)("kanal %s: acil sözcük ağı", (_l, text) => {
    expect(isSafetyEmergencyText(text)).toBe(true);
  });

  it("QR: yer / varlık sorusu ve olumsuz ses açık tehlike DEĞİL (bugünkü davranış aynen)", () => {
    expect(hazardEvidenceOf("Where is the CO detector?").level).toBe("none");
    expect(hazardEvidenceOf("Wo ist der Kohlenmonoxidmelder?").level).toBe("none");
    expect(hazardEvidenceOf("The CO alarm is not beeping").level).toBe("none");
    expect(hazardEvidenceOf("Is there a carbon monoxide detector?").level).toBe("mentioned");
  });

  it("QR: başka açık tür korunur (yangın + gaz alarmı)", () => {
    const r = hazardEvidenceOf("The kitchen is on fire and the CO alarm is beeping");
    expect(r.level).toBe("clear");
    expect([...r.kinds].sort()).toEqual(["fire", "gas"]);
  });

  it("QR: duman dedektörü bugünkü kuralında (olası duman, karar modele)", () => {
    expect(hazardEvidenceOf("Der Rauchmelder piept")).toEqual({ level: "possible", kinds: ["smoke"] });
  });

  it("kanal: Almanca bileşik önce kaçıyordu, şimdi acil (kırmızı-önce kanıtı bu satır)", () => {
    expect(isSafetyEmergencyText("Der Kohlenmonoxidmelder piept")).toBe(true);
    expect(isSafetyEmergencyText("Wo ist der Kohlenmonoxidmelder?")).toBe(false);
  });
});

describe("maliyet — misafir metninde karesel iş yok", () => {
  it.each([
    ["uzun tek sözcük", "a".repeat(50_000)],
    ["boşluk dizisi", `co${" ".repeat(50_000)}x`],
    ["tekrarlanan dedektör adı", "co alarm ".repeat(6_000)],
    ["tekrarlanan ses fiili", "beeping ".repeat(6_000)],
    ["ad + uzak fiil", `gas alarm ${"x ".repeat(25_000)}beeping`],
  ])("%s → 300 ms altında", (_l, text) => {
    const t0 = performance.now();
    gasDetectorSounding(text);
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it("tekrarlanan ad + fiil hâlâ doğru sonuç verir (tavan kesmez)", () => {
    expect(gasDetectorSounding(`${"hello ".repeat(10_000)}. The CO alarm is beeping`)).toBe(true);
  });
});
