import { describe, it, expect } from "vitest";
import { accessFacts, faultTopics, physicalAccessWords, requestDependency, requestTopics } from "@/lib/conversation-items/relation";
import { stripNoInstructionFillerGrounded } from "@/lib/ai/no-instruction-filler";

// ---------------------------------------------------------------------------
// KURUCU T1 ÖLÇÜMÜ (10-21: "hem yanlış gönderimler hem de gereksiz tutulan doğru cevaplar ölçülmeli"). Kodun iki kararı etiketli setle:
//  1. Ayrım: arıza + aynı turdaki soru → soru bağımsız mı (cevaplanabilir) yoksa bağlı mı (ev sahibinde)?  Modelin işareti "kendi konusu"
//     varsayılır (en gevşek durum — model her şeye "bağımsız" dese de kod ne yapar).
//  2. Dayanak: "talimat yok" silinince kalan yönerge gönderilir mi (bilgi tabanında dayanak) yoksa cevap tutulur mu?
// YANLIŞ GÖNDERİM = etiketi "tut" iken kodun "gönder" demesi (sıfır olmalı — pinli). GEREKSİZ TUTMA = etiketi "gönder" iken "tut" (sayılır,
// raporlanır; bilinçli tutucu yön, üst sınır pinli — artarsa ölçüm yeniden yapılır).
// ---------------------------------------------------------------------------

type Pair = [fault: string, question: string, kind: string, expected: "independent" | "dependent"];
const SEPARATION: Pair[] = [
  // Bağlı olmalı (yanlış gönderim riski).
  ["Otopark kapısı açılmıyor", "Nasıl çıkacağız?", "directions_transport", "dependent"],
  ["Kapı açılmıyor", "Nasıl gireceğiz?", "directions_transport", "dependent"],
  ["Kapı açılmıyor", "Kapı kodu ne?", "access_keys", "dependent"],
  ["Bina kapısı açılmıyor", "Anahtarı nereden alacağız?", "access_keys", "dependent"],
  ["Asansör çalışmıyor", "Bavulları nasıl çıkaracağız?", "luggage", "dependent"],
  ["Kilit bozuk", "Çıkarken kapıyı nasıl kilitleyeceğiz?", "access_keys", "dependent"],
  ["Garaj kapısı açılmıyor", "Arabayı nereye park edelim?", "parking", "dependent"],
  ["The parking gate won't open", "How do we get out?", "directions_transport", "dependent"],
  ["The front door is stuck", "How do we get in?", "access_keys", "dependent"],
  ["Klima çalışmıyor", "Klimayı nasıl çalıştırırız?", "appliance_help", "dependent"],
  ["Televizyonda görüntü yok", "Kumanda nerede?", "appliance_help", "dependent"],
  ["Sıcak su yok", "Kombi nasıl açılıyor?", "appliance_help", "dependent"],
  // Haiku T1 #4: saat türü etiketli ama fiziksel erişim nesnesi taşıyan soru.
  ["Garaj kapısı açılmıyor", "Çıkış saatinde anahtarı nereye bırakacağız?", "checkout_time", "dependent"],
  // Bağımsız olmalı (gereksiz tutma).
  ["Televizyonda görüntü yok", "Çöpleri nereye atıyoruz?", "trash", "independent"],
  ["Televizyonda görüntü yok", "Wi-Fi şifresi ne?", "wifi", "independent"],
  ["Klima çalışmıyor", "Taksi çağırabilir misiniz?", "directions_transport", "independent"],
  ["Klima çalışmıyor", "Yakında market var mı?", "local_recommendations", "independent"],
  ["Duşta sıcak su yok", "Wi-Fi şifresi ne?", "wifi", "independent"],
  ["Televizyonda görüntü yok", "Otopark ücretsiz mi?", "parking", "independent"],
  ["Bulaşık makinesi çalışmıyor", "Çöpleri nereye atıyoruz?", "trash", "independent"],
  ["Kapı kilitlenmiyor", "Çıkış saati kaçta?", "checkout_time", "independent"],
  // Haiku T1 #7: "kapıcı" görevlidir, kapı değil.
  ["Kapı kodu çalışmıyor", "Resepsiyonda kapıcı var mı?", "other", "independent"],
];

type Strip = [reply: string, kb: string[], expected: "send" | "hold"];
const KB = ["Çıkış\nAnahtarı masaya bırakmanız yeterli. Çıkış saati 11:00.", "Çöp\nÇöpleri binanın arkasındaki konteynere atabilirsiniz."];
const GROUNDING: Strip[] = [
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli.", KB, "send"],
  ["Çöp için özel bir talimat yok, konteynere atabilirsiniz.", KB, "send"],
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. İyi yolculuklar!", KB, "send"],
  ["Çıkış için özel talimatımız yok. Anahtarı masaya bırakmanız yeterli.", KB, "send"],
  ["Evcil hayvan için özel talimatımız yok, evcil hayvanlar kabul edilir.", KB, "hold"],
  ["Çıkış için özel talimatımız yok, saat 14:00'e kadar kalabilirsiniz.", KB, "hold"],
  ["Çıkış için özel talimatımız yok, kapıyı çekip çıkmanız yeterli.", KB, "hold"],
  ["Çıkış için özel talimatımız yok. Depozito iadesi 3 gün içinde yapılır.", KB, "hold"],
  ["Kahvaltı için özel talimatımız yok, kahvaltı 09:00-11:00 arasında servis edilir.", KB, "hold"],
  ["No special instructions for checkout, you can stay until 2 pm.", KB, "hold"],
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli.", [], "hold"],
  // Haiku T1 #1 — kutup: bilgi tabanı olumsuz, cevap olumlu (ve tersi).
  ["Özel bir talimatımız yok. Evcil hayvanlar kabul edilir.", ["Evcil hayvan\nEvcil hayvan kabul edilmez."], "hold"],
  ["Özel bir talimatımız yok. Evcil hayvanlar kabul edilmez.", ["Evcil hayvan\nEvcil hayvan kabul edilir."], "hold"],
  ["No special instructions. Pets are allowed.", ["Pets\nPets are not allowed."], "hold"],
  ["Özel bir talimatımız yok. Evcil hayvanlar kabul edilmez.", ["Evcil hayvan\nEvcil hayvan kabul edilmez."], "send"],
  ["No special instructions. Pets are not allowed.", ["Pets\nPets are not allowed in the apartment."], "send"],
  // Eşik: kalemle kısmen örtüşen (3/5) uydurma ek yönerge gitmez.
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakıp kapıyı kilitleyin.", KB, "hold"],
  // #2 — nezaket kalıbı içerik cümlesini muaf yapmaz.
  ["Çıkış için özel talimatımız yok. Anahtarı masaya bırakın ve keyifli bir gün dileriz.", ["Çıkış\nÇıkış saati 11:00'dir."], "hold"],
  ["Özel talimatımız yok. Merhaba, kapıyı çekip kilitleyin.", ["Çıkış\nÇıkış saati 11:00'dir."], "hold"],
  // #3 — sayı tam belirteç.
  ["Özel talimatımız yok. Çıkış saat 2'ye kadar kalabilirsiniz.", ["Çıkış\nÇıkış saat 12:00'ye kadar kalabilirsiniz."], "hold"],
  // #6 — yaygın kapanış cümlesi bütün cevabı tutmaz.
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. Başka bir sorunuz olursa çekinmeden yazabilirsiniz.", KB, "send"],
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. Size yardımcı olmaktan memnuniyet duyarız.", KB, "send"],
  ["Merhaba Ayşe Hanım, çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. İyi yolculuklar dileriz!", KB, "send"],
];

function separationDecision([fault, question, kind]: Pair): "independent" | "dependent" {
  const aTopics = faultTopics(fault, fault, "complaint_issue");
  const rTopics = requestTopics(question, question, kind as never);
  const timeKind = ["checkin_time", "checkout_time", "early_checkin", "late_checkout"].includes(kind);
  const access = timeKind ? physicalAccessWords(question) : accessFacts(question)(rTopics);
  const d = requestDependency(
    { kind: kind as never, relation: "own_topic", topics: rTopics, generic: false, hazard: false, money: false, access },
    [{ kind: "complaint_issue", topics: aTopics, hazard: false, access: accessFacts(fault)(aTopics) }],
  );
  return d === "independent" ? "independent" : "dependent";
}

describe("kurucu T1 ölçümü — yanlış gönderim SIFIR, gereksiz tutma sayılır", () => {
  it("ayrım: yanlış gönderim 0; gereksiz tutma en çok 0 (bu set)", () => {
    const falseSend = SEPARATION.filter((p) => p[3] === "dependent" && separationDecision(p) === "independent").map((p) => `${p[0]} | ${p[1]}`);
    const needlessHold = SEPARATION.filter((p) => p[3] === "independent" && separationDecision(p) === "dependent").map((p) => `${p[0]} | ${p[1]}`);
    expect(falseSend).toEqual([]);
    expect(needlessHold).toEqual([]);
  });

  it("dayanak: yanlış gönderim 0; gereksiz tutma en çok 0 (bu set)", () => {
    const decide = ([reply, kb]: Strip) => (stripNoInstructionFillerGrounded(reply, "tr", kb) === reply ? "hold" : "send");
    const falseSend = GROUNDING.filter((g) => g[2] === "hold" && decide(g) === "send").map((g) => g[0]);
    const needlessHold = GROUNDING.filter((g) => g[2] === "send" && decide(g) === "hold").map((g) => g[0]);
    expect(falseSend).toEqual([]);
    expect(needlessHold).toEqual([]);
  });
});

describe("Codex 10-21 (T1 'uygulanmamış' iddiası): üretim cevap yolu yalnız DAYANAKLI siliciyi çağırır", () => {
  it("ai/index.ts ham siliciyi doğrudan çağırmaz; Codex'in cümlesi bilgi tabanı yokken AYNEN kalır (bilgim-yok kapısı tutar)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/ai/index.ts", "utf8");
    expect(src).toMatch(/stripNoInstructionFillerGrounded\(/);
    expect(src).not.toMatch(/stripNoInstructionFiller\(/);
    const codex = "Evcil hayvan için özel talimatımız yok, evcil hayvanlar kabul edilir.";
    expect(stripNoInstructionFillerGrounded(codex, "tr", [])).toBe(codex);
    expect(stripNoInstructionFillerGrounded(codex, "tr", ["Evcil hayvan\nEvcil hayvan kabul edilmez."])).toBe(codex);
  });
});
