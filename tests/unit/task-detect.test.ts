import { describe, it, expect } from "vitest";
import {
  detectOperationalTask,
  buildOperationalTaskData,
} from "@/lib/tasks/detect";
import { firstBreakdownDevice } from "@/lib/ai/fallback";

describe("detectOperationalTask", () => {
  it("routes an explicit breakage to an urgent-SLA maintenance task", () => {
    const d = detectOperationalTask("Klima çalışmıyor, çok sıcak", { intent: "amenity" });
    expect(d?.type).toBe("maintenance");
    expect(d?.slaHours).toBe(24);
  });

  it("routes a safety emergency to urgent maintenance with a tight SLA", () => {
    const d = detectOperationalTask("Gaz kokusu var, acil!", { riskType: "safety_emergency" });
    expect(d?.type).toBe("maintenance");
    expect(d?.priority).toBe("urgent");
    expect(d?.slaHours).toBe(2);
  });

  it("routes leaking/clogged EN faults to maintenance", () => {
    expect(detectOperationalTask("the sink is clogged", {})?.type).toBe("maintenance");
    expect(detectOperationalTask("bathroom is leaking", {})?.type).toBe("maintenance");
    expect(detectOperationalTask("no hot water in the shower", {})?.type).toBe("maintenance");
  });

  it("routes an item + lack signal to restock", () => {
    expect(detectOperationalTask("Havlu eksik, alabilir miyiz?", {})?.type).toBe("restock");
    expect(detectOperationalTask("we are out of toilet paper", {})?.type).toBe("restock");
    expect(detectOperationalTask("şampuan bitmiş", {})?.type).toBe("restock");
  });

  it("does NOT fire restock on a bare item question with no lack signal", () => {
    // "where are the towels?" — an informational question, not a restock request.
    expect(detectOperationalTask("havlular nerede acaba?", {})).toBeNull();
  });

  it("routes a cleanliness complaint to a cleaning task", () => {
    const d = detectOperationalTask("Oda temiz değildi, temizlik kötü", { intent: "cleaning" });
    expect(d?.type).toBe("cleaning");
    expect(d?.slaHours).toBe(12);
  });

  it("returns null for non-operational risk (refund / review threat / cancellation)", () => {
    expect(detectOperationalTask("Paramı iade edin, tazminat istiyorum", { riskType: "money_refund" })).toBeNull();
    expect(detectOperationalTask("Kötü yorum yazacağım", { riskType: "review_threat" })).toBeNull();
    expect(detectOperationalTask("Rezervasyonu iptal ediyorum", { riskType: "cancellation" })).toBeNull();
    expect(detectOperationalTask("Gerçek biriyle görüşmek istiyorum", { riskType: "human_request" })).toBeNull();
  });

  it("returns null for a neutral informational message", () => {
    expect(detectOperationalTask("Wifi şifresi nedir?", { intent: "wifi" })).toBeNull();
    expect(detectOperationalTask("Otopark var mı?", { intent: "parking" })).toBeNull();
  });

  it("prefers an explicit fault over a non-operational riskType fallback only when operational", () => {
    // A breakage with no risk signal still routes to maintenance.
    expect(detectOperationalTask("musluk akıtıyor", {})?.type).toBe("maintenance");
  });
});

describe("buildOperationalTaskData", () => {
  const now = new Date("2026-07-10T09:00:00.000Z"); // 12:00 Istanbul

  it("builds a PII-lean title (label + topic, no guest name) and a deterministic dedupe key", () => {
    const d = detectOperationalTask("musluk akıtıyor", {})!;
    const data = buildOperationalTaskData(d, { propertyId: "prop-1", message: "Ben Ahmet, musluk akıtıyor", now });
    expect(data.type).toBe("maintenance");
    expect(data.title).toBe("Bakım — misafir bildirimi: musluk"); // kurucu D4: doğrulanmış arıza gibi yazılmaz
    expect(data.title).not.toContain("Ahmet"); // guest name stays out of the title
    // Bakımda tekilleştirme konusu CİHAZDIR, belirti değil (kurucu 10-15: "Klima bozuk" ile "Musluk bozuk" birleşmemeli).
    expect(data.dedupeKey).toBe("prop-1:maintenance:cihaz:musluk:2026-07-10");
    // full text is preserved in the description for context
    expect(data.description).toContain("Ahmet");
  });

  it("sets dueAt = now + slaHours", () => {
    const d = detectOperationalTask("Gaz kokusu var", { riskType: "safety_emergency" })!;
    const data = buildOperationalTaskData(d, { propertyId: "p", message: "Gaz kokusu var", now });
    expect(data.dueAt.getTime()).toBe(now.getTime() + 2 * 3600_000);
  });

  it("keys the dedupe by Istanbul calendar day (late-UTC instant still same local day)", () => {
    const lateUtc = new Date("2026-07-10T22:30:00.000Z"); // 01:30 Istanbul next day
    const d = detectOperationalTask("havlu eksik", {})!;
    const data = buildOperationalTaskData(d, { propertyId: "p", message: "havlu eksik", now: lateUtc });
    expect(data.dedupeKey).toBe("p:restock:havlu:2026-07-11");
  });
});

describe("15 ajan A11 — görev ağı alt dize eşleştirmez (sahte görev yok)", () => {
  it.each([
    "Our team ran out of patience with the noise.",
    "The steakhouse nearby is closed, any other idea?",
    "It's a bleak day, but the flat is lovely.",
  ])("🚨 alt dize görev açmaz: %j", (m) => {
    expect(detectOperationalTask(m, {})).toBeNull();
  });

  it("KONTROL: gerçek sözcük + İngilizce çekim eki / Türkçe ek hâlâ eşleşir", () => {
    expect(detectOperationalTask("The towels are missing.", {})?.topic).toBe("towel");
    expect(detectOperationalTask("We ran out of tea.", {})?.topic).toBe("tea");
    expect(detectOperationalTask("The sink keeps leaking.", {})?.topic).toBe("leaking");
    expect(detectOperationalTask("Havlular bitmiş.", {})?.topic).toBe("havlu");
    expect(detectOperationalTask("Klima bozulmuş.", {})?.topic).toBe("klima"); // kurucu D4: konu mesajdaki cihaz
  });

  it("🚨 Türkçe sözcük BAŞI şartı: sözcük içindeki eşleşme görev açmaz (\"ko-CAY-a\" çay değildir); sözcük başındaki ekli biçim açar", () => {
    expect(detectOperationalTask("Kocaya söyledim, sorun yok.", {})).toBeNull();
    expect(detectOperationalTask("Bitmiş çaylar var mı?", {})?.topic).toBe("çay");
  });
});

describe("bakım tekilleştirme anahtarı — cihaz (kurucu 10-15)", () => {
  const now = new Date("2026-07-10T09:00:00.000Z");
  const key = (m: string) => buildOperationalTaskData(detectOperationalTask(m, {})!, { propertyId: "p", message: m, now }).dedupeKey;

  it("🚨 farklı cihaz + aynı belirti → FARKLI anahtar; aynı cihaz + farklı belirti → AYNI anahtar; çekimli yazım aynı cihaz", () => {
    expect(key("Klima bozuk")).not.toBe(key("Musluk bozuk"));
    expect(key("Kombi bozuk")).not.toBe(key("Klima bozuk"));
    expect(key("Klima bozuk")).toBe(key("Klima yine bozuldu"));
    expect(key("Musluk bozuk")).toBe(key("Musluğu akıtıyor"));
  });

  it("cihaz yoksa eski konu; acil güvenlik ve eksik eşya cihaza göre bölünmez", () => {
    expect(key("Wi-Fi çalışmıyor")).toBe("p:maintenance:çalışmıyor:2026-07-10");
    expect(key("Havlu eksik")).toBe("p:restock:havlu:2026-07-10");
    expect(key("Gaz kokusu var")).toBe("p:maintenance:acil-güvenlik:2026-07-10");
  });

  it("cihaz arama uzun girdide doğrusal (karesel iş yok)", () => {
    const t0 = performance.now();
    firstBreakdownDevice("a".repeat(50_000));
    firstBreakdownDevice("klima ".repeat(8_000));
    firstBreakdownDevice(`${" ".repeat(50_000)}x`);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});


// ---------------------------------------------------------------------------
// KURUCU D4 (10-15, aynen): "Görev tespitini genişletelim; fakat önceliği yalnız cihaz adına veya soru işaretine göre belirlemeyelim.
// Gerçek arıza bildirimi ile varsayım, olumsuzlama ve genel soruyu ayır. Görev başlığında “misafir bildirimi” olduğunu koru; doğrulanmış
// arıza gibi yazma. … 2/24 saat hedeflerini henüz kesinleştirme. Otomatik görev kapalıysa görev açılmasın."
// ---------------------------------------------------------------------------
describe("kurucu D4 — arıza görev tespiti genişledi; soru / varsayım / olumsuzlama ayrıldı", () => {
  const now = new Date("2026-07-10T09:00:00.000Z");
  const detect = (m: string) => detectOperationalTask(m, {});
  const title = (m: string) => buildOperationalTaskData(detect(m)!, { propertyId: "p", message: m, now }).title;

  it.each([
    ["Kapının kilidi bozuldu", "kapı"],
    ["Kapı kilitlenmiyor", "kapı"],
    ["Su akmıyor", "su"],
    ["Banyoda su akmıyor", "su"],
    ["Duştan su akmıyor", "duş"],
    ["Musluktan su gelmiyor", "musluk"],
    ["Sifon bozuldu", "sifon"],
    ["Kombi bu sabah bozuldu.", "kombi"],
  ])("🚨 bugün görev AÇMAYAN gerçek bildirim → bakım (normal öncelik, 24 sa — saat hedefi kesinleşmedi): %j", (m, topic) => {
    expect(detect(m)).toEqual({ type: "maintenance", priority: "standard", topic, slaHours: 24 });
    expect(title(m)).toBe(`Bakım — misafir bildirimi: ${topic}`);
  });

  it.each([
    "Su akmıyor mu acaba, gelmeden sormak istedim",
    "Sıcak su gelmiyor mu? Gelmeden önce soruyorum",
    "Klima bozulursa kime haber verelim?",
    "Kombi bozuksa ne yapmalıyız?",
    "Klima çalışmıyorsa kimi arayalım?",
    "Eğer su gelmiyor ise ne yapalım?",
    "Klima bozuk değil, sadece kumandayı bulamadık",
    "Musluk bozuk değil sanırım, sadece sert",
    "Kilit bozulmadı, sadece sıkı",
    "Is the AC broken?",
    "What should we do if the AC is broken?",
    "The AC isn't broken, we just couldn't find the remote.",
    "Moralim bozuldu",
    "Merhaba, klima bozuk mu?",
    "Klima bozuk olursa ne yapalım?",
    "The AC isn't really broken, just noisy",
    "In case the boiler is broken, who do we call?",
  ])("🚨 soru / varsayım / olumsuzlama → bakım görevi YOK: %j", (m) => {
    expect(detect(m)).toBeNull();
  });

  it.each([
    "Salon ışığı yanmıyor mu, karanlıkta oturuyoruz.",
    "Banyo lavabosu tıkandı mı acaba, su gitmiyor.",
    "Oda peteği ısınmıyor mu sizce, buz gibi.",
    "Kapının kilidi bozuk mu, anahtar dönmüyor",
    "Su gelmiyor eğer akşama kadar düzelmezse otele geçeceğiz",
    "Su gelmiyorsa ne yapalım? Bu arada su gelmiyor.",
    "Klima bozuk, değil mi?",
    "Merhaba, duştan sıcak su gelmiyor.",
    // İngilizce cümle yardımcı fiille başlasa da "?" yoksa soru değildir; "mi" cümlecik başında soru eki değildir (İspanyolca "mi").
    "Have been trying all morning but the heater is broken",
    "Mi calentador is broken.",
    // Haiku 10-15: çıplak "gelmeden" soru niyeti değil; cümlecik ortasındaki "even if" varsayım değil.
    "Musluktan su gelmiyor sabah gelmeden kalktık",
    "Heating doesn't work even if I set it to max",
    // Soru sözcüklü ama arızayı kendisi anlatan cümlecik bildirimdir.
    "Who do I call about the broken dishwasher?",
  ])("aşırı uygulama yok: soru ekiyle TEREDDÜTLÜ bildirim / koşulla biten gerçek bildirim → görev AÇILIR: %j", (m) => {
    expect(detect(m)?.type).toBe("maintenance");
  });

  it.each([
    "Merdivenlerde yoğun sigara kokusu var, komşulardan geliyor galiba.",
    "Dairede ağır bir rutubet kokusu var, pencereleri açtık ama geçmedi.",
    "Teknisyenimiz geldi, sıcak su sorunu giderildi. Anlayışınız için teşekkürler.",
    "Getirdiğimiz kahve makinesi bozuldu.",
    "Kendi blenderımız bozuldu, mutfakta var mı?",
    // Açık arıza sözcüğü kuralında da (bozulmuş) misafirin kendi eşyası bakım değil (Haiku 10-15).
    "Kendi blenderımız bozulmuş, mutfakta var mı?",
    "Getirdiğimiz kahve makinesi bozulmuş",
  ])("genel şikâyet + mesajda geçen cihaz adı / misafirin kendi eşyası → bakım görevi YOK: %j", (m) => {
    expect(detect(m)).toBeNull();
  });

  it("🚨 konu ARIZANIN cümleciğindeki cihaz (mesajın ilk cihazı değil) — tekilleştirme anahtarı da o cihaz (Haiku 10-15)", () => {
    expect(detect("Klima bozuk değil, musluk akmıyor")?.topic).toBe("musluk");
    expect(detect("Merdivenlerde sigara kokusu var, su akmıyor")?.topic).toBe("su");
    expect(detect("Klima güzel çalışıyor ama kombi bozuk")?.topic).toBe("kombi");
    const key = (m: string) => buildOperationalTaskData(detect(m)!, { propertyId: "p", message: m, now }).dedupeKey;
    expect(key("Klima bozuk değil, musluk akmıyor")).toBe(key("Musluk akmıyor"));
    // Misafir eşyası işareti başka cümlecikteyse dairenin arızası yine görev açar.
    expect(detect("Valizleri getirdik, mutfak musluğu bozuldu")?.topic).toBe("musluk");
    // Cihaz ile fiil ayrı cümleciklerde: bütün mesaja düşülür.
    expect(detect("Klimayı açtık, bozuldu.")?.topic).toBe("klima");
  });

  it("eşya kuralı: olumsuzlanmış arıza sözcüğü artık eşya görevini bastırmaz", () => {
    expect(detect("Kahve bitti, klima bozuk değil")).toEqual({ type: "restock", priority: "standard", topic: "kahve", slaHours: 24 });
  });

  it("acil güvenlik DEĞİŞMEDİ: soru gibi yazılsa da acil (şüphede acil)", () => {
    expect(detect("Kapının kilidi bozuldu, içeri giremiyoruz")?.priority).toBe("urgent");
    expect(detectOperationalTask("Gaz kokusu mu bu acaba?", { riskType: "safety_emergency" })?.priority).toBe("urgent");
  });

  it("eşya / temizlik başlığı değişmedi (misafir bildirimi eki yalnız bakımda)", () => {
    expect(title("Havlu eksik")).toBe("Eksik Eşya: havlu");
  });

  it("aynı cihazın kaynaştırmalı yazımı aynı konu ve anahtar ('suyu' → su)", () => {
    expect(detect("Banyonun suyu akmıyor")?.topic).toBe("su");
    const key = (m: string) => buildOperationalTaskData(detect(m)!, { propertyId: "p", message: m, now }).dedupeKey;
    expect(key("Banyonun suyu akmıyor")).toBe(key("Su akmıyor"));
  });

  it("uzun girdide doğrusal (karesel iş yok — misafir metni)", () => {
    const t0 = performance.now();
    detect(`${"Su akmıyor mu, ".repeat(2_000)}x`);
    detect("a".repeat(50_000));
    detect(`${"bozuk ".repeat(8_000)}değil`);
    detect(`${" ".repeat(50_000)}bozuk`);
    detect(`${",".repeat(50_000)}klima bozuk`);
    detect("klima bozuk değil ".repeat(3_000));
    detect("Klima bozuk mu? ".repeat(3_000));
    expect(performance.now() - t0).toBeLessThan(4_000);
  });
});
