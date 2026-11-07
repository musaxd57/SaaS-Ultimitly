import { describe, it, expect } from "vitest";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";

// ---------------------------------------------------------------------------
// MECAZ / ŞAKA (kurucu 10-22: "model espri anlayışı olarak iyi mi test edebilirsin … mübalağayı falan anlayabilsin"; "kelime kelime bakmasın").
// Benzetme ("sanki", "gibi", "as if", "like a", "o kadar") + gülme / şaka işareti ("😂", "haha", "lol", "şaka") birlikteyse kod AÇIK tehlike
// hükmü vermez: en fazla `possible` → kararı bağlamı okuyan anlama modeli verir (model yoksa güvenli taraf: devir). Gerçek tehlike bildirimi,
// tek başına benzetme, tek başına gülme, gaz ve nefes darlığı değişmez.
// ---------------------------------------------------------------------------

const level = (m: string) => hazardEvidenceOf(m).level;

describe("mecaz + şaka → karar modelde (açık değil)", () => {
  it.each([
    "Mutfak yanıyor sanki, o kadar sıcak 😅 klima nasıl açılır?",
    "Ev yanıyor gibi haha, kombiyi kısabilir miyiz?",
    "It's like a fire in here lol, how do we turn on the AC?",
    "Elektrik çarptı sanki o kadar güzel ki 😍 çıkış kaçta?",
  ])("%s → olası (açık değil)", (m) => {
    expect(level(m)).toBe("possible");
  });
});

describe("değişmeyenler (güvenlik)", () => {
  it.each([
    ["Mutfak yanıyor!", "clear"],
    ["Mutfak yanıyor 😂", "clear"], // gülme var ama benzetme yok → açık
    ["Prizden duman çıkıyor", "clear"],
    ["There is a fire in the kitchen!", "clear"],
    ["Smoke everywhere, alarm is beeping", "clear"],
  ])("%s → %s", (m, expected) => {
    expect(level(m)).toBe(expected);
  });

  it("gaz HER ZAMAN açık (benzetme + gülme olsa da)", () => {
    expect(level("Gaz kokusu var sanki haha, normal mi?")).toBe("clear");
  });

  it("nefes darlığı varsa açık kalır", () => {
    expect(level("Duman var sanki, nefes alamıyoruz haha")).toBe("clear");
  });

  it("benzetme tek başına (gülme yok) bugünkü hükmü değiştirmez", () => {
    const m = "Mutfak yanıyor sanki, her yer duman";
    // Bugünkü kural ne diyorsa o (gülme işareti yokken mecaz yorumu YAPILMAZ).
    expect(level(m)).toBe("clear");
  });
});

describe("'şaka değil / not joking' VURGUDUR, olumsuzlama değil (mizah ölçümü 10-22)", () => {
  it("'Not joking: water is pouring … onto the lamp' → açık su + elektrik tehlikesi (eskiden olumsuzlanmış sayılıp 'anılış'a iniyordu)", () => {
    expect(hazardEvidenceOf("Not joking: water is pouring from the ceiling onto the lamp")).toEqual({ level: "clear", kinds: ["water"] });
  });
  it("yardımcı fiilli su bildirimi ('water is pouring', 'keeps dripping') artık tanınır", () => {
    expect(level("water is pouring from the ceiling")).toBe("possible");
    expect(level("Water keeps dripping in the bathroom")).toBe("possible");
  });
  it("geçmiş / düzelmiş su anılışı yine anılış", () => {
    expect(level("water was leaking yesterday, fixed now")).toBe("mentioned");
  });
  it("'Şaka değil, gerçekten gaz kokusu var' → açık gaz", () => {
    expect(level("Şaka değil, gerçekten gaz kokusu var, ne yapalım?")).toBe("clear");
  });
});

