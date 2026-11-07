import { describe, it, expect } from "vitest";
import { hazardDecisionFor, hazardEvidenceOf, kbSupportsReassurance } from "@/lib/ai/hazard-evidence";
import { isSafetyEmergencyText } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// Codex incelemesi 10-31 (`hazard-evidence.ts`, kurucu: "mantıklı mı dedikleri"). Her iddia kodda yeniden üretildi; bu dosya doğrulanan
// KOD hatalarını pinler. Yön hep güvenli taraf: gerçek tehlike bildirimi bağlam sözcüğü yüzünden "anılış"a / "yok"a inmez. Tasarım kararı
// olan madde (soru biçimi → olası, Codex #5) burada DEĞİŞMEDİ.
// ---------------------------------------------------------------------------

const level = (m: string) => hazardEvidenceOf(m).level;
const cleared = (m: string, understandingRan = false) =>
  hazardDecisionFor({ texts: [m], understandingRan, understandingEmergency: false }, isSafetyEmergencyText).lexicalCleared;

describe("#2 geçmiş işareti başka dilde / başka cümleciğe taşmaz", () => {
  it.each([
    ["Hier riecht es nach Gas", "clear"],
    ["Hier brennt es!", "possible"],
    ["Es brennt hier in der Küche!", "possible"],
    ["We arrived yesterday and now the kitchen is on fire", "clear"],
    ["Dün geldik ve şimdi mutfakta yangın var", "clear"],
    ["Wir sind gestern angekommen und jetzt brennt die Küche", "possible"],
  ])("%s → en az %s (eskiden 'anılış', acil etiketi model sorulmadan kalkıyordu)", (m, want) => {
    expect(want === "clear" ? ["clear"] : ["possible", "clear"]).toContain(level(m));
    expect(cleared(m)).toBe(false);
  });

  it.each([
    "Il y avait de la fumée hier soir, tout va bien maintenant",
    "Hier il y a eu un petit feu dans la cuisine",
    "Dün mutfakta yangın çıkmıştı, söndürdük",
    "Yesterday there was smoke from the oven",
    "The fire was put out yesterday and now everything is fine",
  ])("gerçek geçmiş anlatım yine anılış: %s", (m) => {
    expect(level(m)).toBe("mentioned");
  });
});

describe("#3 ışık / ekran sözcüğü YALNIZ kendi fiilini nötrler", () => {
  it.each([
    "Die Lampe ist aus und der Vorhang brennt",
    "TV ekranı açık ve koridorda alevler var",
    "The screen is on and there are flames in the hallway",
    // Bağlaç sınırı: ışık / ekran sözcüğü 3 sözcük içinde ama bağlacın ÖTEKİ yanında.
    "Ekran açık ve alevler var!",
    "Screen on and flames everywhere!",
  ])("%s → en az olası (eskiden 'yok')", (m) => {
    expect(["possible", "clear"]).toContain(level(m));
  });

  it.each([
    "Die Lampe brennt die ganze Nacht",
    "Kombi ekranında alev simgesi yanıp sönüyor",
    "The boiler display shows a flame icon",
  ])("ışık / gösterge yine tehlike değil: %s", (m) => {
    expect(["none", "mentioned"]).toContain(level(m));
  });
});

describe("#4 alıntıyla aktarılan GÜNCEL bildirim kaybolmaz (karar modelde)", () => {
  it.each([
    'Çocuğum "mutfakta yangın var" diyor!',
    'Komşu "yangın var" diye bağırıyor!',
    'My son is shouting "there is a fire in the kitchen"',
  ])("%s → olası (eskiden 'yok')", (m) => {
    expect(level(m)).toBe("possible");
  });

  it.each(['Filmde biri "yangın var" dedi', 'The sign says "In case of fire use stairs"', 'Kapıda "Yangın çıkışı" yazıyor'])(
    "medya / tabela alıntısı yine tehlike değil: %s",
    (m) => {
      expect(["none", "mentioned"]).toContain(level(m));
    },
  );
});

describe("#6 mecaz kalıbındaki kaçış hatası (as if / like a / comme si / o kadar)", () => {
  it.each(["The kitchen is on fire as if 😂", "Ce n'est pas un vrai feu, comme si la cuisine brûlait haha", "Mutfak o kadar sıcak ki yanıyor 😂"])(
    "%s → açık değil (şaka + benzetme → karar modelde)",
    (m) => {
      expect(level(m)).not.toBe("clear");
    },
  );
  it("benzetme olmadan şaka işareti açık hükmü düşürmez", () => {
    expect(level("The kitchen is on fire 😂")).toBe("clear");
  });
});

describe("#1 olumsuzlanmış güvence bilgi tabanı dayanağı değildir", () => {
  it.each([
    "Gaz kokusu normal değildir.",
    "Bu duman güvenli değildir.",
    "Smoke from the socket is not normal.",
    "Gas smell is never safe.",
    "Rauch ist nicht normal.",
    "La fumée n'est pas normale.",
  ])("%s → dayanak değil", (f) => {
    expect(kbSupportsReassurance([f])).toBe(false);
  });
  it.each(["Kombi çalışırken buhar çıkması normaldir.", "Steam from the boiler is normal.", "Dampf aus dem Boiler ist normal."])(
    "olumlu güvence yine dayanak: %s",
    (f) => {
      expect(kbSupportsReassurance([f])).toBe(true);
    },
  );
});
