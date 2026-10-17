import { describe, it, expect } from "vitest";
import { commitmentTopicOf, detectHostPromise } from "@/lib/ai-suggestions/core";
import { commitmentLabel, commitmentSlotMatches, commitmentTopicsCompatible } from "@/lib/guest-commitments-core";
import { foldTurkishAscii } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// I1 (kurucu 10-17 "A", migration 73): sözün KONUSU — aynı tür + aynı saatte iki farklı konu iki söz + iki görev ("klima 18:00" + "musluk 18:00").
// Konu yalnız ev sahibinin mesajından, kodla (model yok).
// ---------------------------------------------------------------------------

const topic = (kind: Parameters<typeof commitmentTopicOf>[0], text: string) =>
  commitmentTopicOf(kind, text, foldTurkishAscii(text).toLowerCase());

describe("commitmentTopicOf", () => {
  it.each([
    ["maintenance", "Klimayı yarın 10'da teknisyen tamir edecek", "ac"],
    ["maintenance", "Musluğu yarın usta değiştirecek", "faucet"],
    ["maintenance", "Kombi için servis bugün gelecek", "heating"],
    ["maintenance", "Buzdolabına yarın bakacağız", "fridge"],
    ["maintenance", "The plumber will fix the tap tomorrow", "faucet"],
    ["maintenance", "The technician will fix the AC tomorrow", "ac"],
    ["supplies", "Yarın şampuan getireceğim", "shampoo"],
    ["supplies", "I'll bring toilet paper tonight", "toilet_paper"],
    // Haiku 10-17: yan öğe ("suyu", "kumandası") ana cihazı bölmez; tek başına su konudur.
    ["maintenance", "Musluk suyu için usta yarın 10:00'da gelecek", "faucet"],
    ["maintenance", "Klimanın kumandası için teknisyen yarın gelecek", "ac"],
    ["maintenance", "Su için tesisatçı yarın gelecek", "water"],
    // Belirsiz kök yalnız "için" / onarım fiiliyle.
    ["maintenance", "Kapıyı yarın usta tamir edecek", "door"],
    ["maintenance", "Ocak için servis yarın gelecek", "stove"],
    ["maintenance", "Klima için usta yarın 10:00'da kapıya gelecek", "ac"],
    // İngilizce eşdeğer kapsam.
    ["maintenance", "The technician will fix the light tomorrow", "light"],
    ["maintenance", "The technician will fix the heating tomorrow", "heating"],
    ["maintenance", "The plumber will fix the water leak tomorrow", "water"],
    ["maintenance", "The plumber will fix the shower water tomorrow", "shower"],
  ] as const)("%s · %s → %s", (kind, text, expected) => {
    expect(topic(kind, text)).toBe(expected);
  });

  it.each([
    ["maintenance", "Teknisyen yarın gelecek"], // konu yok
    ["maintenance", "Klima ve musluk için usta 18:00'de gelecek"], // iki konu → tek ziyaret olabilir
    ["towels", "Havlu getireceğim"], // havlu / temizlik konusuz
    ["cleaning", "Klimanın filtresini temizlikçi yarın temizleyecek"],
    ["supplies", "Şampuan ve sabun getireceğim"],
    // Haiku 10-17: yer / ay / talimat / teslim anlamındaki sözcük konu değil.
    ["maintenance", "Usta yarın 10:00'da kapıya gelecek"],
    ["maintenance", "Ocak ayında teknisyen yarın 10:00'da gelecek"],
    ["maintenance", "Işıkları açık bırakmayın ve teknisyen yarın 10:00'da gelecek"],
    ["maintenance", "Anahtarlarınızı yarın usta getirecek"],
  ] as const)("konu YOK: %s · %s", (kind, text) => {
    expect(topic(kind, text)).toBeNull();
  });

  it("Haiku 10-17: sözcük tavanını AŞAN parça konusuz (sessiz kesme sondaki ikinci cihazı görmeyip yanlış tek konu üretiyordu)", () => {
    const filler = Array.from({ length: 62 }, (_, i) => `kelime${i}`).join(" ");
    expect(topic("maintenance", `Musluk için usta yarın gelecek ${filler} ve klimayı da tamir edecek`)).toBeNull();
  });

  it("söz okuyucusu konuyu YALNIZ sözün parçasından taşır (ilk parçadaki başka cihaz karışmaz)", () => {
    expect(detectHostPromise("Klimanız için teşekkürler, musluğu yarın usta değiştirecek")).toMatchObject({ kind: "maintenance", topic: "faucet" });
    expect(detectHostPromise("Klima için teknisyen bugün 18:00'de gelecek")).toMatchObject({ kind: "maintenance", topic: "ac" });
    expect(detectHostPromise("Teknisyen bugün 18:00'de gelecek")).toMatchObject({ kind: "maintenance", topic: null });
  });
});

describe("commitmentSlotMatches — öneri listesi ile onay AYNI yüklem", () => {
  const at = new Date("2026-10-17T15:00:00Z");
  const slot = (topic: string | null, kind = "maintenance", dueAt = at) => ({ kind, dueAt, topic });
  it.each([
    ["ac", "ac", true], // aynı söz iki mesajda
    ["ac", "faucet", false], // I1'in kendisi
    [null, "ac", true], // konusuz elle söz + konulu öneri: bugünkü gibi birleşir (sahiplenme Q1)
    ["ac", null, true], // konusuz öneri ("teknisyen 18:00'de gelecek") büyük olasılıkla aynı ziyaret
    [null, null, true], // bugünkü davranış
  ] as const)("mevcut %s + gelen %s → %s", (a, b, expected) => {
    expect(commitmentSlotMatches(slot(a), slot(b))).toBe(expected);
    expect(commitmentTopicsCompatible(a, b)).toBe(expected);
  });
  it("tür ya da an farklıysa konu ne olursa olsun ayrı", () => {
    expect(commitmentSlotMatches(slot("ac"), slot("ac", "supplies"))).toBe(false);
    expect(commitmentSlotMatches(slot("ac"), slot("ac", "maintenance", new Date(at.getTime() + 60_000)))).toBe(false);
  });
  it("etiket: konu varsa 'Arıza / bakım · klima'; tanınmayan / boş konu yalnız tür", () => {
    expect(commitmentLabel("maintenance", "ac")).toBe("Arıza / bakım · klima");
    expect(commitmentLabel("maintenance", null)).toBe("Arıza / bakım");
    expect(commitmentLabel("maintenance", "bilinmeyen")).toBe("Arıza / bakım");
  });
});
