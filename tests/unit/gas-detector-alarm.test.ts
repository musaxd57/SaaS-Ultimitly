import { describe, it, expect } from "vitest";
import { gasDetectorSounding, smokeDetectorSounding } from "@/lib/ai/gas-detector-alarm";
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
  // Haiku incelemesi 10-13 — yanlış negatifler:
  ["en (devam cümlesi)", "The CO detector is in the kitchen. It keeps beeping!"],
  ["tr (devam cümlesi)", "Karbonmonoksit dedektörü mutfakta. Sürekli ötüyor!"],
  ["en (varsayım sözcüğü SESTEN SONRA)", "The gas alarm is beeping and I don't know if it's serious."],
  ["tr (varsayım sözcüğü SESTEN SONRA)", "CO dedektörü ötüyor, eğer gaz varsa ne yapmalıyım?"],
  ["tr ('susmuyor' = ses sürüyor)", "CO dedektörü susmuyor!"],
  ["en (buzzing)", "The gas alarm is buzzing"],
  ["de (ertönt)", "Der Gasmelder ertönt"],
  ["fr (se met à sonner)", "Le détecteur de CO se met à sonner"],
  ["tr (tireli)", "CO-dedektörü ötüyor"],
  ["tr (alıntılı yansıma sesi)", 'CO dedektörü "bip bip" yapıyor'],
  // Haiku 2. inceleme 10-13 — yanlış negatifler:
  ["dil karışımı (TR ad + EN fiil)", "CO alarmı sürekli beeping yapıyor"],
  ["en çift olumsuz (doesn't stop)", "The CO alarm doesn't stop beeping"],
  ["en çift olumsuz (did not stop)", "The gas detector did not stop chirping all night"],
  ["de çift olumsuz (hört nicht auf)", "Der CO-Melder hört nicht auf zu piepen"],
  ["es çift olumsuz (no para de)", "La alarma de gas no para de sonar"],
  ["tr geçmiş sürerlik (ötüyordu)", "CO dedektörü bütün gece ötüyordu"],
  ["tr başlama (çalmaya başladı)", "Gaz alarmı çalmaya başladı"],
  ["tr 'detektör' yazımı", "CO detektörü ötüyor"],
  // Mutasyon 10-13 (G4a): devam cümlesinde YALNIZ kendi dilinin fiili ("sonne" dil karışımı kümesinde yok).
  ["fr devam cümlesi (kendi dilinin fiili)", "Le détecteur de CO est dans la cuisine. Il sonne!"],
  // Haiku 3. inceleme:
  ["de çift olumsuz geçmiş (hat nicht aufgehört)", "Der CO-Melder hat nicht aufgehört zu piepen"],
  ["tek sözcük devam", "Karbonmonoksit dedektörü mutfakta. Ötüyor!"],
  // Haiku son kontrolü 10-13 (önceki düzeltmenin gerilemeleri):
  ["es çift olumsuz (no ha dejado de)", "La alarma de gas no ha dejado de sonar"],
  ["es çift olumsuz (no dejó de)", "El detector de CO no dejó de sonar"],
  ["en çift olumsuz (has not stopped)", "The CO alarm has not stopped beeping"],
  ["de çift olumsuz (nicht wirklich aufgehört)", "Der CO-Melder hat nicht wirklich aufgehört zu piepen"],
  ["de ayrılabilir (hört leider nicht auf)", "Der CO-Melder hört leider nicht auf zu piepen"],
  ["tr zarflı devam (Şimdi ötüyor)", "Karbonmonoksit dedektörü mutfakta. Şimdi ötüyor!"],
  ["es ses fiiliyle başlayan devam", "El detector de gas está en la cocina. Suena sin parar!"],
  // Haiku son kontrolü (2): "hiç durmadı" = ses sürüyor.
  ["en hiç durmadı (never stopped)", "The CO alarm has never stopped beeping"],
  ["es hiç durmadı (nunca ha dejado de)", "La alarma de gas nunca ha dejado de sonar"],
  ["de hiç durmadı (nie aufgehört)", "Der CO-Melder hat nie aufgehört zu piepen"],
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
  ["duman dedektörü (gaz kuralının konusu değil — ayrı kural ↓)", "The smoke detector is beeping"],
  // Haiku incelemesi 10-13 — yanlış pozitifler:
  ["tr olumsuz çekim (bip sesi çıkarmıyor)", "CO dedektörü bip sesi çıkarmıyor, pil mi bitti?"],
  ["en olumsuz, araya iki sözcük", "The CO detector is not making any beeps"],
  ["de olumsuz geçmiş", "Der CO-Melder hat nicht gepiept"],
  ["de 'Sonne' (güneş) Fransızca fiil değil", "Der CO-Melder hängt in der Sonne"],
  ["tr ad-fiil + olumsuz ('öttüğünü duymadım')", "Gaz dedektörünün öttüğünü duymadım"],
  ["başka cihaz ayrı cümlede", "Where is the CO detector? My phone is beeping."],
  // Haiku 2. inceleme: dil karışımında çakışmaya açık fiil (Almanca 'Sonne' = güneş) yine eşleşmez.
  ["en ad + de 'Sonne'", "The CO alarm hangs in der Sonne"],
  ["en olumsuz geçmiş (stopped)", "The CO alarm stopped beeping an hour ago"],
  // Mutasyon 10-13 (G4d): ses başta, dedektör 80 karakterden UZAKTA sağda — yakınlık iki yönde de sınanır.
  ["uzak sağdaki dedektör", `My phone keeps beeping ${"and ".repeat(30)}the CO alarm is on the wall`],
  // Haiku 3. inceleme — yanlış pozitifler:
  ["TR ad + EN 'ringing' (çalan telefon)", "CO dedektörü nerede, telefon ringing"],
  ["başka özneli kısa cümle", "Gaz dedektörü mutfakta. Telefon çalıyor."],
  ["'stop' olumsuzdan ÖNCE (çift olumsuz değil)", "Stop it, the CO alarm isn't ringing"],
  ["es 'para' = için", "Para el detector de gas no suena"],
  ["es durdu", "El detector de gas dejó de sonar"],
  ["fr durdu", "Le détecteur de CO a cessé de sonner"],
  ["de durdu", "Der CO-Melder hat aufgehört zu piepen"],
  // Haiku son kontrolü (2): devam cümlesi BAŞKA bir ses kaynağından söz ediyor.
  ["devam cümlesinde telefon (en)", "Where is the CO detector? Now my phone is beeping."],
  ["devam cümlesinde telefon (ses fiiliyle başlıyor)", "Where is the CO detector? Beeping phone is mine."],
  ["devam cümlesinde Handy (de)", "Wo ist der CO-Melder? Piept mein Handy."],
  ["devam cümlesinde telefon (tr)", "Karbonmonoksit dedektörü nerede? Şimdi telefonum ötüyor."],
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

  it("QR: duman dedektörü öterse açık DUMAN tehlikesi (H3, kurucu 10-13) — gaz değil", () => {
    expect(hazardEvidenceOf("Der Rauchmelder piept")).toEqual({ level: "clear", kinds: ["smoke"] });
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
    // Haiku incelemesi 10-13: ad ve fiil AYNI cümlede binlerce kez (eski çift döngü D×S) — sıralı işaretçiyle doğrusal.
    ["binlerce ad + binlerce fiil", "gas alarm is on the wall and the clock is ringing ".repeat(1_500)],
    ["binlerce ad + binlerce uzak fiil", `${"co alarm ".repeat(5_000)}${"x ".repeat(100)}${"beeping ".repeat(5_000)}`],
    // Haiku son kontrolü (2): çok sayıda varsayım sözcüğü + ses aynı cümlede (eski ses × varsayım taraması).
    ["binlerce 'if' + binlerce ses", `${"if ".repeat(8_000)}${"beep ".repeat(5_000)}gas alarm`],
    // H3 + son kontrol: geçmiş / yordam / bitti olguları ses başına cümleyi yeniden tarıyordu (ölçüldü 1,1–1,4 sn) → cümle başına bir kez.
    ["geçmiş belirteci + binlerce geçmiş fiil", `last night ${"the co alarm beeped ".repeat(2_600)}`],
    ["geçmiş sürerlik + binlerce ses", `this morning ${"co alarm was beeping ".repeat(2_400)}`],
    ["geçmiş + uzun bitti cümlesi", `last night the co alarm beeped ${"beeped ".repeat(3_500)}. ${"fine ".repeat(5_000)}`],
    ["yordam (when) + binlerce geniş zaman", "when the co alarm beeps ".repeat(2_100)],
    ["olumsuzlanmış bitti beyanı dizisi", `last night the co alarm beeped ${"not fixed ".repeat(5_000)}`],
  ])("%s → 300 ms altında", (_l, text) => {
    const t0 = performance.now();
    gasDetectorSounding(text);
    smokeDetectorSounding(text);
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it("tekrarlanan ad + fiil hâlâ doğru sonuç verir (tavan kesmez)", () => {
    expect(gasDetectorSounding(`${"hello ".repeat(10_000)}. The CO alarm is beeping`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H3 (kurucu kararı 10-13 "Evet, doğrudan ev sahibine"): duman / yangın dedektörü öterse de yapay zekâ cevaplamaz, ev sahibine acil.
// Önce: QR'da "olası duman" (karar modele) — "The smoke detector is beeping" için model bilgi cevabı yazabiliyordu.
// ---------------------------------------------------------------------------
describe("smokeDetectorSounding — duman / yangın dedektörü ötüyor (H3)", () => {
  it.each([
    ["en", "The smoke detector is beeping"],
    ["en (fire alarm)", "The fire alarm went off"],
    ["tr", "Duman dedektörü ötüyor"],
    ["tr (yangın alarmı)", "Yangın alarmı çalıyor"],
    ["de", "Der Rauchmelder piept"],
    ["de (bileşik)", "Der Rauchwarnmelder piept seit einer Stunde"],
    ["fr", "Le détecteur de fumée sonne"],
    ["es", "El detector de humo está sonando"],
    ["devam cümlesi", "The smoke alarm is in the hallway. It keeps chirping!"],
    ["geçmiş + hâlâ ötüyor (şimdiki zaman canlı)", "The smoke alarm went off last night and it is still beeping"],
    // Haiku incelemesi (H3) — yanlış negatifler:
    ["geçmiş belirteci + sürüyor (won't stop)", "This morning the smoke alarm went off and it won't stop"],
    ["de 'eben' (az önce)", "Gestern war alles ok, aber eben hat der Rauchmelder gepiept"],
    ["de 'hier' = burada (Fransızca dün değil)", "Der Rauchmelder hier hat gepiept"],
    ["de 'schlägt Alarm'", "Der Rauchmelder schlägt Alarm"],
  ])("🚨 %s: %s → QR açık duman + kanal acil", (_l, text) => {
    expect(smokeDetectorSounding(text)).toBe(true);
    expect(hazardEvidenceOf(text)).toEqual({ level: "clear", kinds: ["smoke"] });
    expect(isSafetyEmergencyText(text)).toBe(true);
  });

  it.each([
    ["yer sorusu", "Where is the smoke detector?"],
    ["olumsuz", "The smoke detector is not beeping"],
    ["varsayım", "If the smoke alarm goes off, what do we do?"],
    ["durdu", "The smoke detector stopped beeping an hour ago"],
    ["söndürücü sorusu", "Is there a fire extinguisher?"],
    ["geçmişte olup bitmiş (H3 eski pin)", "Last night the smoke alarm went off but it's out now."],
    ["tr geçmiş (dün gece öttü)", "Dün gece duman dedektörü öttü, şimdi sorun yok"],
    // Haiku incelemesi (H3) — yanlış pozitifler:
    ["tr geçmiş sürerlik (ötüyordu, sustu)", "Dün gece duman alarmı ötüyordu, şimdi sustu."],
    ["en geçmiş sürerlik (was beeping)", "Last night the smoke alarm was beeping but it's fine now"],
    ["planlı test + gelecek zaman", "The fire alarm test is on Monday. It will beep for five seconds."],
    ["yordam sorusu (when + geniş zaman)", "When the smoke alarm goes off, what do I do?"],
    ["gaz dedektörü (öteki kural)", "The CO alarm is beeping"],
  ])("KONTROL %s: %s", (_l, text) => {
    expect(smokeDetectorSounding(text)).toBe(false);
  });

  it("QR: duman + gaz dedektörü birlikte → iki tür", () => {
    const r = hazardEvidenceOf("The smoke detector and the CO alarm are both beeping");
    expect(r.level).toBe("clear");
    expect([...r.kinds].sort()).toEqual(["gas", "smoke"]);
  });

  it("KONTROL: yer sorusu QR'da açık tehlike DEĞİL (bugünkü davranış)", () => {
    expect(hazardEvidenceOf("Where is the smoke detector?").level).toBe("mentioned");
  });
});

// ---------------------------------------------------------------------------
// Haiku son kontrolü (673a896) — kural fazla dardı; her satır önce YANLIŞ negatifti (ölçüldü). Misafir pil uyarısını gerçek alarmdan
// ayıramaz; bittiğine / varsayım olduğuna dair kanıt yoksa karar ev sahibinin.
// ---------------------------------------------------------------------------
describe("Haiku son kontrolü: gelecek zaman / yordam / geçmiş kuralları bildirimi yutmasın", () => {
  it.each([
    ["sürme fiili gelecek değildir (going to keep)", "The CO alarm is going to keep beeping until someone comes", "gas"],
    ["sürme fiili (will keep)", "The CO alarm will keep beeping", "gas"],
    ["es sürme fiili (va a seguir)", "La alarma de gas va a seguir sonando", "gas"],
    ["de sürme fiili (wird weiter)", "Der CO-Melder wird weiter piepen", "gas"],
    ["es çıplak 'va' + ulaç = süren zaman", "La alarma de gas va sonando", "gas"],
    ["yan cümlenin kendi öznesi var → bildirim", "When I got home the CO alarm beeps", "gas"],
    ["when + kendi özneli yan cümle (duman)", "When I open the door the smoke alarm goes off", "smoke"],
    ["whenever artık varsayım değil (bildirim)", "Whenever I open the door the smoke alarm goes off", "smoke"],
    ["yordam + sürüyor beyanı", "When the smoke alarm goes off it keeps going, it is going off right now", "smoke"],
    ["geçmiş, bittiği söylenmemiş (was beeping)", "This morning the CO alarm was beeping", "gas"],
    ["geçmiş, bittiği söylenmemiş (beeped)", "This morning the CO alarm beeped three times", "gas"],
    ["geçmiş + olumsuz bitti ('not fixed')", "Last night the CO alarm went off, it's not fixed yet", "gas"],
    ["geçmiş + 'hasn't stopped' (çıplak stopped bitti değildir)", "The CO alarm went off last night and hasn't stopped", "gas"],
    ["tr geçmiş, bitti beyanı yok", "Dün gece duman alarmı öttü", "smoke"],
    ["geçmiş + yardımcı fiille olumsuz bitti (hasn't been fixed)", "Last night the CO alarm went off and it hasn't been fixed", "gas"],
    ["geçmiş + didn't get resolved", "Last night the CO alarm went off, didn't get resolved", "gas"],
    ["yordam biçimi + sürüyor beyanı (won't stop)", "Whenever the CO alarm beeps it won't stop", "gas"],
    ["bitti beyanı sesten ÖNCE sayılmaz", "Everything is fine, but last night the CO alarm went off", "gas"],
    ["zaman belirteci yok + bitti → yine ev sahibine (CO)", "The CO alarm went off but it's fine now", "gas"],
  ])("🚨 %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(true);
    expect(hazardEvidenceOf(text)).toEqual({ level: "clear", kinds: [kind] });
    expect(isSafetyEmergencyText(text)).toBe(true);
  });

  it.each([
    ["es gelecek (va a sonar)", "La alarma de gas va a sonar a las 5 para la prueba", "gas"],
    ["en gelecek (will beep)", "The CO alarm will beep when the battery is low", "gas"],
    ["en gelecek ('ll, devam cümlesi)", "Where is the CO alarm? It'll beep twice when you test it", "gas"],
    ["whenever + dedektör + geniş zaman = yordam", "Whenever the CO alarm beeps, should I open the windows?", "gas"],
    ["fr yordam (quand l'…)", "Quand l'alarme incendie sonne, que dois-je faire ?", "smoke"],
    ["es yordam (cuando la …)", "Cuando la alarma de humo suena, ¿qué hago?", "smoke"],
    ["geçmiş + ardındaki cümlede bitti", "Last night the smoke alarm went off. Everything is fine now.", "smoke"],
    ["de geçmiş + bitti", "Gestern hat der Rauchmelder gepiept, jetzt ist alles gut", "smoke"],
    ["es geçmiş + bitti", "Anoche sonó la alarma de humo, ya está bien", "smoke"],
  ])("KONTROL %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(false);
  });
});
