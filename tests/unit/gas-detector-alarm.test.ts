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
  // Mutasyon 10-13 (G4d): ses başta, dedektör 80 karakterden UZAKTA sağda — yakınlık iki yönde de sınanır.
  ["uzak sağdaki dedektör", `My phone keeps beeping ${"and ".repeat(30)}the CO alarm is on the wall`],
  // Haiku 3. inceleme — yanlış pozitifler:
  ["TR ad + EN 'ringing' (çalan telefon)", "CO dedektörü nerede, telefon ringing"],
  ["başka özneli kısa cümle", "Gaz dedektörü mutfakta. Telefon çalıyor."],
  ["'stop' olumsuzdan ÖNCE (çift olumsuz değil)", "Stop it, the CO alarm isn't ringing"],
  ["es 'para' = için", "Para el detector de gas no suena"],
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
    // Haiku 5. tur: yoğun kısa cümle (devam cümlesi okuması her cümlede) — dedektörsüz cümle atlanır, dedektör adları tek taramada.
    ["yoğun kısa cümle + kaynak", "CO alarm. it's my phone. ".repeat(2_000)],
    ["yoğun kısa cümle + olumsuz kaynak", "CO alarm. not my phone. ".repeat(2_000)],
    ["yoğun kısa cümle + ses", "CO alarm. it beeps. ".repeat(2_500)],
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
    ["söndürücü sorusu", "Is there a fire extinguisher?"],
    // Haiku incelemesi (H3) — yanlış pozitif:
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
// GEÇMİŞ ZAMAN İNDİRİMİ YOK (Haiku son kontrolü 10-13, üç tur): "dün gece öttü, şimdi iyi" ayrımı sözcük listesiyle güvenli kurulamadı —
// "bitti" sözcüğü başka nesneyi anlatıyordu ("kombi durdu", "bebek sustu", "I checked the boiler and it's fine"). Dedektör öttü bildirimi
// geçmişte de ev sahibine (G4'ün itilmiş hâli; H3 "öterse doğrudan ev sahibine"). Önce: 673a896–461a8dc bu satırları anılış sayıyordu.
// ---------------------------------------------------------------------------
describe("geçmiş zaman indirimi yok — dedektör öttü bildirimi geçmişte de ev sahibine", () => {
  it.each([
    ["H3 eski pin artık ev sahibine", "Last night the smoke alarm went off but it's out now.", "smoke"],
    ["tr geçmiş + şimdi sorun yok", "Dün gece duman dedektörü öttü, şimdi sorun yok", "smoke"],
    ["tr geçmiş sürerlik + sustu", "Dün gece duman alarmı ötüyordu, şimdi sustu.", "smoke"],
    ["en geçmiş sürerlik + fine now", "Last night the smoke alarm was beeping but it's fine now", "smoke"],
    ["de geçmiş + alles gut", "Gestern hat der Rauchmelder gepiept, jetzt ist alles gut", "smoke"],
    ["es geçmiş + ya está bien", "Anoche sonó la alarma de humo, ya está bien", "smoke"],
    // Haiku 3. tur (461a8dc) — "bitti" sözcüğü başka nesnede (hepsi o sürümde yanlış negatifti):
    ["boiler it's fine", "Last night the CO alarm went off, I checked the boiler and it's fine.", "gas"],
    ["tr kombi durdu", "Dün gece gaz alarmı öttü ve kombi durdu.", "gas"],
    ["tr bebek sustu", "Dün gece duman alarmı öttü, bebek sustu.", "smoke"],
    ["de Baby wieder ruhig", "Gestern hat der Rauchmelder gepiept, danach war das Baby wieder ruhig.", "smoke"],
    ["we're all good now", "The smoke alarm went off last night, but we're all good now.", "smoke"],
    ["tr kombide sorun yok", "Dün gece gaz alarmı öttü, kombide sorun yok.", "gas"],
    ["es la estufa", "Anoche sonó la alarma de gas, ya está bien la estufa.", "gas"],
    ["it stopped me from sleeping", "Last night the CO alarm went off and it stopped me from sleeping.", "gas"],
    ["belirsizlik (I think it stopped)", "Last night the CO alarm went off and I think it stopped.", "gas"],
    ["tr belirsizlik (sanırım sustu)", "Dün gece CO alarmı öttü, sanırım sustu.", "gas"],
  ])("🚨 %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(true);
    expect(hazardEvidenceOf(text)).toEqual({ level: "clear", kinds: [kind] });
    expect(isSafetyEmergencyText(text)).toBe(true);
  });

  // DURDU / ARTIK ÖTMÜYOR = ses ÇALMIŞ (Haiku 4. tur; H4 güvenli varsayılanı). Önce (itilmiş G4) bu satırlar yapay zekâya kalıyordu —
  // "The CO alarm stopped beeping, should we stay in the house?" dahil.
  it.each([
    ["en durdu", "The CO alarm stopped beeping an hour ago", "gas"],
    ["en durdu + soru", "The CO alarm stopped beeping, should we stay in the house?", "gas"],
    ["en geçmiş durdu", "Last night the CO alarm stopped beeping.", "gas"],
    ["es durdu", "El detector de gas dejó de sonar", "gas"],
    ["fr durdu", "Le détecteur de CO a cessé de sonner", "gas"],
    ["de durdu", "Der CO-Melder hat aufgehört zu piepen", "gas"],
    ["duman durdu", "The smoke detector stopped beeping an hour ago", "smoke"],
    ["anymore", "The CO alarm doesn't beep anymore.", "gas"],
    ["no longer", "The CO alarm no longer beeps.", "gas"],
    ["de nicht mehr", "Der CO-Melder piept nicht mehr.", "gas"],
    ["fr ne … plus", "Le détecteur de CO ne sonne plus.", "gas"],
    ["es ya no", "El detector de gas ya no suena.", "gas"],
    // H4 kurucu sorusu örneği (güvenli varsayılan: ev sahibine):
    ["pil değişti, artık ötmüyor", "I replaced the battery and the CO alarm doesn't beep anymore, is that OK?", "gas"],
    // Kaynak ÖNCEKİ cümlecikte (virgülden önce) — durdu sesi dedektörün kendisi (mutasyon T2: cümlecik sınırı).
    ["kaynak önceki cümlecikte", "My phone is fine, the CO alarm stopped beeping.", "gas"],
    // Haiku 6. tur — cümlecikte dedektör adı varsa durdu sesi onundur (5. tur kuralı bunları yutuyordu):
    ["dedektör + yanındaki cihaz", "The CO alarm next to the oven stopped beeping.", "gas"],
    ["dedektör + yanındaki TV + soru", "The CO alarm next to the TV stopped beeping, is it ok?", "gas"],
    ["önce telefon, sonra dedektör", "Since I charged my phone the CO alarm stopped beeping.", "gas"],
    ["telefon çaldı ve dedektör durdu", "The phone rang and the CO alarm stopped beeping.", "gas"],
    ["taşınabilir dedektör", "The portable CO alarm stopped beeping.", "gas"],
    ["dedektör arabada", "The CO alarm in the car stopped beeping.", "gas"],
    ["tr durdu", "Telefonum çalarken CO alarmı durdu.", "gas"],
    ["tr sustu", "CO alarmı sustu.", "gas"],
    // Haiku 7. tur — virgüllü liste: dedektör adı sesten önce aynı cümlede → ses onundur. BİLİNÇLİ BEDEL: "The CO alarm is fine, the
    // microwave stopped beeping." de ev sahibine (önce bildirim değildi; kaçırmamak gürültüden önce gelir).
    ["virgüllü liste", "The CO alarm, the phone and the kettle stopped beeping.", "gas"],
    ["bedel: CO iyi + mikrodalga durdu", "The CO alarm is fine, the microwave stopped beeping.", "gas"],
  ])("🚨 %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(true);
    expect(hazardEvidenceOf(text)).toEqual({ level: "clear", kinds: [kind] });
    expect(isSafetyEmergencyText(text)).toBe(true);
  });

  it.each([
    ["hiç çalmamış (en)", "The CO alarm is not beeping."],
    ["hiç çalmamış (de)", "Der CO-Melder hat nicht gepiept"],
    ["hiç çalmamış (fr)", "Le détecteur de CO ne sonne pas."],
    ["hiç çalmamış (es)", "El detector de CO no suena nunca"],
    // Haiku 5. tur — durdu sesi BAŞKA cihazın (aynı cümlecikte kaynak öznesi):
    ["mikrodalga durdu", "The microwave stopped beeping, is the CO alarm okay?"],
    ["fırın durdu + CO iyi", "The oven stopped beeping, and the CO alarm is fine."],
    ["su ısıtıcısı artık ötmüyor", "The kettle no longer beeps, the CO alarm is not beeping."],
    ["buzdolabı durdu", "The fridge stopped beeping and the CO alarm is not beeping."],
  ])("KONTROL %s: %s → bildirim değil", (_l, text) => {
    expect(gasDetectorSounding(text)).toBe(false);
  });
});

describe("devam cümlesi (Haiku 3. tur)", () => {
  it.each([
    ["varsayım SESTEN SONRA (even if)", "Where is the CO detector? It keeps beeping even if I open the window.", "gas"],
    ["zamirle başlar, ses başka kaynaktan ÖNCE", "Where is the CO detector? It keeps beeping and the phone is ringing too.", "gas"],
    ["de varsayım sesten sonra (wenn)", "Wo ist der CO-Melder? Er piept immer noch, wenn ich das Fenster öffne.", "gas"],
    ["kendi dedektör adını taşıyan cümle kendi turunda (duman)", "The CO alarm is in the kitchen. The smoke alarm is still beeping.", "smoke"],
    ["devam sözcüğüyle başlayan öteki dedektör cümlesi (duman)", "The CO alarm is in the kitchen. Now the smoke alarm is beeping.", "smoke"],
    // Haiku 4. tur — devam cümlesinde öteki dedektör YALNIZ anılıyor (ses ondan ÖNCE):
    ["ses öteki dedektörden önce", "Where is the CO detector? It keeps beeping, the smoke alarm is fine.", "gas"],
    ["ses öteki dedektörden önce (ikisi de)", "The CO alarm is in the hall. Still beeping, the smoke alarm too.", "gas"],
    ["de ses öteki dedektörden önce", "Wo ist der CO-Melder? Er piept, der Rauchmelder ist ok.", "gas"],
    ["ters yön (duman, CO anılıyor)", "Where is the smoke alarm? It keeps beeping, the CO detector is fine.", "smoke"],
    ["even though + öteki dedektör", "Where is the CO detector? It keeps beeping even though the smoke alarm is fine.", "gas"],
    ["sesin önünde özne zamiri (Last night it went off)", "Where is the CO detector? Last night it went off, we are fine now.", "gas"],
    ["kaynak olumsuzlanmış ('not the phone')", "Where is the CO detector? It keeps beeping, it's not the phone.", "gas"],
    // Haiku 5. tur — olumsuzlanan kaynak adı kaynak değildir:
    ["it is not my phone", "Where is the CO detector? It is not my phone, it is beeping.", "gas"],
    ["not my phone", "Where is the CO detector? Not my phone, it keeps beeping.", "gas"],
    // Haiku 6. tur:
    ["isn't my phone", "Where is the CO detector? It isn't my phone, it keeps beeping.", "gas"],
    ["wasn't the phone", "Where is the CO detector? It wasn't the phone, it keeps beeping.", "gas"],
    ["konum edatı kaynak değil (next door to)", "Where is the CO detector? It's next door to the kitchen and it keeps beeping.", "gas"],
    ["fr à côté de", "Où est le détecteur de CO ? Il est à côté de la cuisine et il sonne.", "gas"],
    ["es al lado de", "¿Dónde está el detector de CO? Está al lado de la cocina y suena.", "gas"],
    ["de nebenan", "Wo ist der CO-Melder? Er hängt nebenan in der Küche und piept.", "gas"],
    // Geriye atıf — ses önceki cümlede, bu cümle onu dedektöre bağlıyor:
    ["geriye atıf (It's the CO alarm)", "Something keeps beeping. It's the CO alarm.", "gas"],
    ["tr geriye atıf", "Bir şey sürekli ötüyor. CO alarmıymış.", "gas"],
    ["de geriye atıf", "Es piept ständig. Es ist der CO-Melder.", "gas"],
    ["geriye atıf soru", "Something is beeping. Is it the CO alarm?", "gas"],
    ["geriye atıf (The CO alarm is in the kitchen)", "It keeps beeping. The CO alarm is in the kitchen.", "gas"],
    ["duman geriye atıf", "Something is beeping in the hallway. I think it's the smoke alarm.", "smoke"],
    ["geriye atıf, tanıtım kalıbı yok (mutasyon V5)", "Something keeps beeping. Where is the CO alarm?", "gas"],
    // Haiku 7. tur — kaynak denetimi sesin CÜMLECİĞİNDE, tanıtım kalıbı yok, araya sessiz cümle girebilir:
    ["öteki cümlecikte telefon kapalı", "Something keeps beeping, my phone is off. It's the CO alarm.", "gas"],
    ["öteki cümlecikte su ısıtıcısı", "Something keeps beeping, the kettle is off. It's the CO alarm.", "gas"],
    ["new CO alarm", "Something keeps beeping. It's the new CO alarm.", "gas"],
    ["your CO alarm", "Something keeps beeping. It's your CO alarm.", "gas"],
    ["seems to be", "Something keeps beeping. It seems to be the CO alarm.", "gas"],
    ["probably", "Something keeps beeping. It's probably the CO alarm.", "gas"],
    ["maybe", "Something keeps beeping. Maybe it's the CO alarm.", "gas"],
    ["öteki dedektör değil, bu", "Something keeps beeping. It's not the smoke alarm, it's the CO alarm.", "gas"],
    ["araya sessiz cümle", "Something keeps beeping. Please help. It's the CO alarm.", "gas"],
    ["dedektör cümlesinde yanındaki cihaz", "Something keeps beeping. It's the CO alarm next to the TV.", "gas"],
    ["olumsuz ses + sesin cümleciğinde kaynak yok", "Where is the CO detector? My phone is not beeping, it keeps beeping.", "gas"],
    // Haiku 8. tur — yer tamlayıcısındaki cihaz kaynak değil; "TV room" bağlama değil; geri alma yalnız gerçek geri alma:
    ["near the kettle", "Something keeps beeping near the kettle. It's the CO alarm.", "gas"],
    ["next to the kettle", "Something keeps beeping in the kitchen next to the kettle. It's the CO alarm.", "gas"],
    ["tr çaydanlığın yanında", "Bir şey çaydanlığın yanında sürekli ötüyor. CO alarmıymış.", "gas"],
    ["TV room", "Where is the CO alarm? It's the TV room one, it keeps beeping.", "gas"],
    ["'No, it keeps beeping' geri alma değil", "Something keeps beeping. Is it the CO alarm? No, it keeps beeping!", "gas"],
    ["'No idea' geri alma değil", "Something keeps beeping. Is it the CO alarm? No idea.", "gas"],
    // Haiku 9. tur — cihaz adı yalnız sesin DİLBİLGİSİ KOMŞUSUYSA kaynaktır (yer tamlaması / bileşik ad değil):
    ["dryer room", "Something keeps beeping in the dryer room. It's the CO alarm.", "gas"],
    ["elevator lobby", "Something keeps beeping in the elevator lobby. It's the CO alarm.", "gas"],
    ["with the washing machine", "Something keeps beeping in the laundry room with the washing machine. It's the CO alarm.", "gas"],
    ["in front of the oven", "Something keeps beeping in front of the oven. It's the CO alarm.", "gas"],
    ["on top of the fridge", "Something keeps beeping on top of the fridge. It's the CO alarm.", "gas"],
    ["es al lado del horno", "Algo suena al lado del horno. Es la alarma de CO.", "gas"],
    ["fr à côté du téléphone", "Quelque chose sonne à côté du téléphone. C'est le détecteur de CO.", "gas"],
    ["car park", "Something keeps beeping in the car park. It's the CO alarm.", "gas"],
    ["the one next to the kettle", "Where is the CO detector? The one next to the kettle is beeping.", "gas"],
    ["olumsuzlanan özne-kaynak (mutasyon Y5)", "Where is the CO detector? It is not my phone that is beeping.", "gas"],
    // Haiku 10. tur — yer edatı (kısaltmalı biçimler dahil) ve bağlaçla gelen ses:
    ["in the car park beeping", "Where is the CO alarm? It's in the car park beeping.", "gas"],
    ["in the dryer room beeping", "Where is the CO alarm? It's in the dryer room beeping.", "gas"],
    ["es al lado del horno y suena", "¿Dónde está la alarma de CO? Está al lado del horno y suena.", "gas"],
    ["es junto al teléfono y suena", "¿Dónde está la alarma de CO? Está junto al teléfono y suena.", "gas"],
    ["fr à côté du téléphone et elle sonne", "Où est l'alarme CO ? Elle est à côté du téléphone et elle sonne.", "gas"],
    ["de im Auto und piept", "Wo ist der CO-Melder? Er hängt im Auto und piept.", "gas"],
    ["yalnız bağlaç (mutasyon Z1)", "¿Dónde está la alarma de CO? Ahora apagué el horno y suena.", "gas"],
    ["yalnız kısaltmalı edat (mutasyon Z2)", "¿Dónde está la alarma de CO? Está junto al teléfono sonando.", "gas"],
    // Haiku 11. tur — çok sözcüklü yer edatı:
    ["in front of the oven beeping", "Where is the CO alarm? It's in front of the oven beeping.", "gas"],
    ["on top of the fridge beeping", "Where is the CO alarm? It's on top of the fridge beeping.", "gas"],
    ["de auf dem Kühlschrank", "Wo ist der CO-Melder? Er ist auf dem Kühlschrank und piept.", "gas"],
    ["fr devant le four", "Où est le détecteur de CO ? Il est devant le four et il sonne.", "gas"],
    // Haiku 12. tur — dil değişimi (soru İngilizce, devam Fransızca); başka dilin fiili yalnız özne zamiri hemen önündeyse:
    ["dil değişimi: Il sonne", "Where is the CO alarm? Il sonne.", "gas"],
    ["dil değişimi: Elle sonne toujours", "Where is the CO alarm? Elle sonne toujours.", "gas"],
    ["dil değişimi + en face du", "Where is the CO alarm? Il est en face du téléphone et il sonne.", "gas"],
    // Haiku 13. tur — çıplak dedektör adı devam işaretidir; geçmiş süreklilik (sonnait / sonaba / piepte):
    ["dil değişimi + çıplak ad (Le détecteur sonne)", "Where is the CO alarm? Le détecteur sonne.", "gas"],
    ["çıplak ad (The alarm keeps beeping)", "Where is the CO detector? The alarm keeps beeping.", "gas"],
    ["fr sonnait", "Où est l'alarme CO ? Elle sonnait hier soir.", "gas"],
    ["es sonaba", "La alarma de gas sonaba toda la noche.", "gas"],
    ["de piepte", "Der CO-Melder piepte die ganze Nacht.", "gas"],
    // Haiku 14. tur — "sounds" İngilizce ses fiili değildi (itilmiş G4'te de kaçıyordu); çıplak ad + yer tamlaması:
    ["sounds again", "The CO alarm sounds again.", "gas"],
    ["sounds (yer tamlamalı)", "The CO alarm in the kitchen sounds.", "gas"],
    // Haiku 16. tur — ses fiilsiz "durmuyor" biçimleri ve ses betimlemesi:
    ["won't stop", "The CO alarm won't stop.", "gas"],
    ["devam: It won't stop!", "Where is the CO alarm? It won't stop!", "gas"],
    ["sounds like a siren", "The smoke alarm sounds like a siren.", "smoke"],
    ["devam: It sounds like a siren", "Where is the CO alarm? It sounds like a siren.", "gas"],
    ["de hört nicht auf", "Der CO-Melder hört nicht auf.", "gas"],
    ["fr ne s'arrête pas", "Le détecteur de CO ne s'arrête pas.", "gas"],
    ["es no para", "La alarma de gas no para.", "gas"],
    ["tr durmuyor", "CO alarmı durmuyor.", "gas"],
    // Haiku 17. tur — eksik ses fiilleri:
    ["won't stop shrieking", "The CO alarm won't stop shrieking.", "gas"],
    ["is shrieking", "The smoke alarm is shrieking.", "smoke"],
    ["keeps screeching", "The CO alarm keeps screeching.", "gas"],
    ["squealing", "The CO alarm keeps squealing.", "gas"],
    ["wailing", "The smoke alarm is wailing.", "smoke"],
    ["devam: It's shrieking", "Where is the CO alarm? It's shrieking.", "gas"],
    ["geriye: Something is shrieking", "Something is shrieking. It's the CO alarm.", "gas"],
    // Haiku 19. tur — çekim biçimleri, Türkçe çığlık, ortak özne:
    ["screams", "The CO alarm screams.", "gas"],
    ["screamed all night", "The CO alarm screamed all night.", "gas"],
    ["tr çığlık atıyor", "CO alarmı çığlık atıyor.", "gas"],
    ["ortak özne (alarm + köpek)", "The CO alarm and the dog are howling.", "gas"],
    ["ortak özne (duman + köpek)", "The smoke alarm and the dog are howling.", "smoke"],
    ["ortak özne (alarm + çocuklar)", "The CO alarm and the kids are screaming.", "gas"],
    ["ortak özne (alarm + komşunun köpeği)", "The CO alarm and the neighbour's dog are howling.", "gas"],
    ["çıplak ad + sounds", "Where is the CO alarm? Alarm sounds again.", "gas"],
    ["çıplak ad + yer tamlaması", "Where is the CO alarm? The alarm in the kitchen keeps beeping.", "gas"],
    ["geri alma + dedektör yeniden", "Something keeps beeping. Is it the CO alarm? No, the kettle isn't the problem, it's the CO alarm.", "gas"],
  ])("🚨 %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(true);
  });

  it.each([
    ["konum sorusu + komşu müziği", "Is there a CO detector? The neighbours are still blaring music.", "gas"],
    ["konum sorusu + araba alarmı", "Where is the smoke alarm? The neighbour's car alarm keeps going off.", "smoke"],
    ["konum sorusu + su ısıtıcısı", "Where is the CO detector? The kettle is still beeping.", "gas"],
    ["tr konum sorusu + komşu müziği", "CO dedektörü nerede? Komşuda müzik hâlâ çalıyor.", "gas"],
    ["konum sorusu + yazıcı", "Where is the CO detector? The printer keeps beeping.", "gas"],
    ["öteki dedektörün cümlesi (gaz DEĞİL)", "The CO alarm is in the kitchen. The smoke alarm is still beeping.", "gas"],
    ["devam sözcüğüyle başlasa da öteki dedektörün cümlesi (gaz DEĞİL — mutasyon Q1)", "The CO alarm is in the kitchen. Now the smoke alarm is beeping.", "gas"],
    ["varsayım SESTEN ÖNCE", "Where is the CO detector? If it beeps, what should I do?", "gas"],
    ["zamirle başlar ama kaynak sesten ÖNCE", "Where is the CO detector? It's my phone beeping", "gas"],
    // Haiku 4. tur — sesi kaynağa BAĞLAYAN cümle:
    ["that's my phone", "Where is the CO detector? It keeps beeping, that's my phone.", "gas"],
    ["it's just the oven", "Where is the CO detector? It keeps beeping, it's just the oven.", "gas"],
    ["de das ist mein Handy", "Wo ist der CO-Melder? Er piept, das ist mein Handy.", "gas"],
    ["it's the kettle", "Where is the CO detector? It's the kettle, it keeps beeping.", "gas"],
    ["it's the neighbour's alarm", "Where is the CO detector? It keeps beeping, it's the neighbour's alarm.", "gas"],
    // Geriye atıf KONTROLLERİ:
    ["önceki cümlede kaynak (kettle)", "The kettle keeps beeping. The CO alarm is fine.", "gas"],
    ["önceki cümlede kaynak (alarm clock)", "My alarm clock beeps every morning. The CO alarm is in the hallway, right?", "gas"],
    ["varsayım", "If something beeps, is it the CO alarm?", "gas"],
    ["önceki cümle olumsuz (nothing)", "Nothing is beeping. The CO alarm is quiet.", "gas"],
    ["önceki cümle olumsuz (not)", "It is not beeping. It's the CO alarm, right?", "gas"],
    ["önceki cümle varsayım", "If it beeps. It's the CO alarm.", "gas"],
    // Haiku 7. tur — geri alma (bağlama bu ya da ardındaki cümlede):
    ["geri alma ardındaki cümlede", "Something keeps beeping. Is it the CO alarm? No, it's the kettle.", "gas"],
    ["geri alma aynı cümlede", "Something keeps beeping. It's the CO alarm, no, it's the kettle.", "gas"],
    ["önceki cümlede telefon sesi", "My phone keeps beeping. Where is the CO alarm?", "gas"],
    ["önceki cümlede bağlama başka cümlecikte (mutasyon W7)", "It keeps beeping, that's my phone. Where is the CO alarm?", "gas"],
    // Haiku 8. tur — kapalı listede olmayan cihazlar eklendi; çıplak "No." / "No, the kettle." geri almadır:
    ["kurutma makinesi", "The dryer is beeping. Where is the CO alarm?", "gas"],
    ["dizüstü", "The laptop is beeping. Where is the CO alarm?", "gas"],
    ["dil değişimi: zamirsiz Almanca 'Sonne' (güneş) fiil değil (mutasyon AB2)", "Wo ist der CO-Melder? Immer die Sonne hier.", "gas"],
    ["çıplak ad + araba alarmı (kaynak öznesi)", "Where is the CO detector? My car alarm keeps going off.", "gas"],
    ["hırsız alarmı (Haiku 14. tur)", "Where is the CO alarm? The burglar alarm keeps beeping.", "gas"],
    // Haiku 15. tur — "sounds" + değerlendirme görüştür, ses değil:
    ["sounds like a good idea", "The CO alarm sounds like a good idea.", "gas"],
    ["sounds great", "Your smoke alarm setup sounds great.", "smoke"],
    ["test sounds fine", "The fire alarm test sounds fine.", "smoke"],
    ["Sounds good + konum", "Sounds good, the smoke alarm is in the hall.", "smoke"],
    ["plan sounds perfect", "That CO detector plan sounds perfect, thanks.", "gas"],
    ["başkasının durmayan eylemi (won't stop + -ing)", "The CO alarm is fine but the kids won't stop crying.", "gas"],
    ["keeps going on about (konuşma)", "The dog keeps going on about the smoke alarm.", "smoke"],
    // Haiku 18. tur — canlı / hava öznesi (aynı cümlede yeni fiiller):
    ["rüzgâr ıslık çalıyor", "The wind is whistling, where is the CO detector?", "gas"],
    ["çocuklar kahkaha", "The kids are howling with laughter and the CO alarm is fine.", "gas"],
    ["trafik korna", "The traffic is honking near the CO alarm.", "gas"],
    ["çocuklar çığlık", "The kids are screeching next to the smoke alarm.", "smoke"],
    ["köpek uluyor", "The dog is howling, where is the smoke alarm?", "smoke"],
    ["virgülle ayrılmış: alarm iyi, köpek uluyor", "The smoke alarm is fine, the dog is howling.", "smoke"],
    // Haiku 20. tur — ortak özne değil (dedektörün kendi yüklemi var):
    ["alarm iyi ve köpek uluyor", "The CO alarm is fine and the dog is howling.", "gas"],
    ["alarm test edildi ve çocuklar çığlık", "The CO alarm was tested and the kids are screaming outside.", "gas"],
    ["alarm koridorda ve trafik korna", "My CO alarm is in the hall and the traffic is honking.", "gas"],
    ["duman alarmı çalışıyor ve rüzgâr ıslık", "The smoke alarm works and the wind is whistling.", "smoke"],
    // Türkçe ünsüz yumuşaması (çaydanlık → çaydanlığı, müzik → müziği) — kaynak yine tanınır (mutasyon X2: kaynak hiç tanınmıyordu):
    ["tr çaydanlığı ötüyor", "Çaydanlığım sürekli ötüyor. CO alarmı nerede?", "gas"],
    ["tr müziği çalıyor", "Komşunun müziği hâlâ çalıyor. CO dedektörü nerede?", "gas"],
    ["çıplak No", "Something keeps beeping. Is it the CO alarm? No.", "gas"],
    ["No + kaynak", "Something keeps beeping. Is it the CO alarm? No, the kettle.", "gas"],
    ["öteki dedektör (gaz değil)", "Something keeps beeping. It's the smoke alarm.", "gas"],
  ])("KONTROL %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(false);
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
    ["geçmiş + 'nobody stopped it' (çıplak stopped bitti değildir — mutasyon M11)", "Last night the CO alarm went off and nobody stopped it", "gas"],
    ["yordam biçimi + sürüyor beyanı (won't stop)", "Whenever the CO alarm beeps it won't stop", "gas"],
    ["bitti beyanı sesten ÖNCE sayılmaz", "Everything is fine, but last night the CO alarm went off", "gas"],
    ["zaman belirteci yok + bitti → yine ev sahibine (CO)", "The CO alarm went off but it's fine now", "gas"],
    // Haiku 2. son kontrol (77c9a85) — 17 yanlış negatif, hepsi ölçüldü:
    ["eylem başka nesnede (gaz vanası)", "Last night the gas alarm went off and we turned off the gas valve.", "gas"],
    ["tr eylem başka nesnede (fırın)", "Dün gece CO alarmı öttü, fırını kapattım.", "gas"],
    ["tr eylem ardındaki cümlede", "Dün gece gaz dedektörü öttü. Gazı kapattık.", "gas"],
    ["de eylem ardındaki cümlede (Herd ist aus)", "Gestern hat der Gasmelder gepiept. Der Herd ist aus.", "gas"],
    ["es eylem ardındaki cümlede (se apagó)", "Anoche sonó la alarma de gas. Se apagó la estufa.", "gas"],
    ["ardındaki cümlede eylem (turned off the stove)", "Last night the CO alarm went off. We opened the windows and turned off the stove.", "gas"],
    ["ardındaki cümle güvenilmez (bilinçli: 'fine now')", "Last night the smoke alarm went off. Everything is fine now.", "smoke"],
    ["ardındaki cümle başka nesne (wifi)", "Last night the CO alarm went off. The wifi is fine now.", "gas"],
    ["aynı cümlede öznesiz 'fine now' başka nesne", "Last night the CO alarm went off, the wifi is fine now.", "gas"],
    ["sürüyor beyanlı devam cümlesi", "Last night the CO alarm went off. We turned it off, but it keeps beeping.", "gas"],
    ["tr sürüyor beyanlı devam cümlesi", "Dün gece CO alarmı öttü. Kapattık ama hâlâ ötüyor.", "gas"],
    ["olumsuz iki sözcük önde (could not get it fixed)", "Last night the CO alarm went off and we could not get it fixed.", "gas"],
    ["belirsizlik (I don't know if it stopped)", "Last night the CO alarm went off and I don't know if it stopped.", "gas"],
    ["tr soru eki (sorun yok mu)", "Dün gece CO alarmı öttü, sorun yok mu?", "gas"],
    ["sürme fiili (will stay)", "The CO alarm will stay beeping until I reset it.", "gas"],
    ["sürme fiili (will still)", "The CO alarm will still beep.", "gas"],
    ["de sürme fiili (wird noch)", "Der CO-Melder wird noch piepen.", "gas"],
    ["yordam biçimi + 'does not stop'", "When the CO alarm goes off it does not stop.", "gas"],
    ["yordam biçimi + 'doesn't stop'", "When the CO alarm goes off it doesn't stop.", "gas"],
    ["çift olumsuz (won't stop beeping)", "The CO alarm won't stop beeping.", "gas"],
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
    // Haiku 2. son kontrol — iyelikli yordam sorusu (77c9a85'te gerilemeydi) + "won't" olumsuzu:
    ["iyelikli yordam (her)", "When her CO alarm goes off, what should I do?", "gas"],
    ["es iyelikli yordam (mi)", "Cuando mi alarma de gas suena, ¿qué hago?", "gas"],
    ["fr iyelikli yordam (mon)", "Quand mon détecteur de CO sonne, que dois-je faire ?", "gas"],
    ["won't olumsuzu", "The CO alarm won't beep.", "gas"],
    ["devam cümlesi başka ses kaynağı (sürüyor beyanlı)", "Where is the smoke detector? My phone keeps ringing", "smoke"],
  ])("KONTROL %s: %s", (_l, text, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(text) : smokeDetectorSounding(text)).toBe(false);
  });
});

describe("Y1 (10-14 dış inceleme): nezaket girişi gerçekleşen tehlikeyi varsayıma ÇEVİRMEZ", () => {
  it.each([
    ["If you have a moment, our CO alarm is beeping.", "gas"],
    ["If you get a chance, the smoke alarm is going off", "smoke"],
    ["When you have a moment, the CO detector keeps beeping", "gas"],
    ["Eğer müsaitseniz, gaz alarmı ötüyor", "gas"],
    ["Vaktiniz olursa, CO alarmı ötüyor", "gas"],
    ["Si vous avez un moment, le détecteur de CO sonne.", "gas"],
    ["Wenn Sie Zeit haben, der CO-Melder piept.", "gas"],
    // Haiku 10-14 ikinci tur: başka nezaket biçimleri + devam / geriye atıf cümleleri.
    ["If it's not too much trouble, the CO alarm is beeping.", "gas"],
    ["If you're free, the CO alarm is beeping.", "gas"],
    ["If you've got a moment, the CO alarm is beeping.", "gas"],
    ["If you wouldn't mind, the CO alarm is beeping.", "gas"],
    ["If it's no bother, the CO alarm is beeping.", "gas"],
    ["In case you have a moment, the CO alarm is beeping.", "gas"],
    ["Wenn es Ihnen recht ist, piept der Kohlenmonoxidmelder.", "gas"],
    ["Wenn du Zeit hast, der CO-Melder piept.", "gas"],
    ["Eğer rahatsız etmezse, CO dedektörü ötüyor.", "gas"],
    ["Eğer sakıncası yoksa, CO dedektörü ötüyor.", "gas"],
    ["Eğer müsait iseniz, CO dedektörü ötüyor.", "gas"],
    ["En caso de que tenga un momento, la alarma de CO está sonando.", "gas"],
    ["The CO alarm is in the kitchen. If you have a moment, it keeps beeping.", "gas"],
    ["If you have a moment, something keeps beeping. It is the CO alarm.", "gas"],
  ])("🚨 %j → çıplak hâliyle AYNI sonuç: dedektör ötüyor + iki ağda acil", (m, kind) => {
    expect(kind === "gas" ? gasDetectorSounding(m) : smokeDetectorSounding(m)).toBe(true);
    expect(isSafetyEmergencyText(m)).toBe(true);
    expect(hazardEvidenceOf(m).level).toBe("clear");
  });
  it.each([
    "If the CO alarm beeps, what should we do?",
    "If you have a moment, what should we do if the CO alarm beeps?",
    // Belirsizlik nezaket DEĞİL — dedektör okuyucusunda soru olarak kalır (ilk Y1 sürümü bunu bildirime çeviriyordu).
    "I'm not sure if the CO alarm beeps when I cook.",
  ])(
    "KONTROL: gerçek varsayım %j → bildirim değil",
    (m) => {
      expect(gasDetectorSounding(m)).toBe(false);
      expect(hazardEvidenceOf(m).level).not.toBe("clear");
    },
  );
  it("süre: uzun nezaket dizisi doğrusal", () => {
    const t0 = performance.now();
    gasDetectorSounding(`${"if you have a moment, ".repeat(2_000)}the co alarm is beeping`);
    hazardEvidenceOf(`${"eger musaitseniz ".repeat(3_000)}gaz alarmi otuyor`);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("Claude 2. dalga #18 / #53 (10-21): bağlaçla biten olumsuzluk ve başka cümlecikteki varsayım sesi düşürmez", () => {
  it.each([
    "The CO alarm is not working and beeping loudly",
    "Der CO-Melder ist nicht kaputt und piept die ganze Zeit",
    "Sorry if this is silly but the CO alarm is beeping",
    "I don't know if it matters but the CO detector is beeping nonstop",
    "Not sure if it's serious, the CO alarm keeps beeping",
    "Ich weiß nicht, ob es wichtig ist, aber der CO-Melder piept",
  ])("canlı ses: %s", (m) => {
    expect(gasDetectorSounding(m)).toBe(true);
  });

  it.each([
    "The CO alarm is not beeping",
    "The CO alarm is not working and not beeping",
    "If the CO alarm beeps, what should we do?",
    "If we cook, will the CO alarm beep?",
    "I'm not sure if the CO alarm beeps when I cook",
    "Not sure, but if the CO alarm beeps should we leave",
    "Wenn der CO-Melder piept, was sollen wir tun?",
  ])("KONTROL (aşırı uygulama yok) — bildirim değil: %s", (m) => {
    expect(gasDetectorSounding(m)).toBe(false);
  });

  it("duman dedektöründe de aynı kural", () => {
    expect(smokeDetectorSounding("The smoke alarm is not working and beeping")).toBe(true);
    expect(smokeDetectorSounding("The smoke alarm is not beeping")).toBe(false);
  });
});
