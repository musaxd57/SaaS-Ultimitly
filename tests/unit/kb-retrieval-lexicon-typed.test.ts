import { describe, it, expect } from "vitest";
import { matchConcepts } from "@/lib/ai/retrieval/lexicon";
import * as lexicon from "@/lib/ai/retrieval/lexicon";
import * as text from "@/lib/ai/retrieval/text";
import { contentStems, isStopword, stem, tokenize } from "@/lib/ai/retrieval/text";
import { fieldTimeHits } from "@/lib/ai/retrieval/time-fields";
import { timeConflictHolds } from "@/lib/ai/time-conflict-gate";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// SÖZLÜK TİPLİ KALIP EŞLEŞTİRİCİSİ (kurucu onayı 09-26; dış inceleme "B + C + tipli eşleştirici").
//
// Çok kelimeli `detectOnly` kalıpları durak sözcükleri düşürünce TEK kelimeye iniyordu (ölçüldü): "çok sıcak" → sıcak
// (klima), "çok soğuk" → soğuk (ısıtma), "no water" → water (su kesintisi), "how to get there" → get (adres). Ayrıca
// kök sökücü "checkin"i "check"e indiriyordu → çıplak "check" girişi tetikliyordu. Artık:
//  · her kaydın TÜRÜ belli (terim / yalnız tespit / yalnız genişletme / birebir kalıp); tek kelimeye inen kayıt
//    `lexiconProblems` ile reddedilir (B);
//  · birebir kalıp durak sözcükleri KORUR, içerik sözcüklerini kök alır (`phraseUnits`) — çekim tutar (C);
//  · "checkin" kökü korunur.
// Saat alanı kuralı: gevşek eşleşme kalıp içerik sözcüklerini "başka konu" sayar (davranış aynı); "Check the heating
// before 22:00" artık GİRİŞ saati sayılmaz (sahte saat çelişkisi = gereksiz devir).
// ---------------------------------------------------------------------------

/** Kalıp birimleri — üretim `phraseUnits` ile AYNI tanım, eski kodda da koşsun diye mevcut dışa aktarımlardan. */
const units = (q: string) => tokenize(q).map((t) => (isStopword(t) ? t : stem(t)));
const ids = (q: string) => matchConcepts(contentStems(q), { units: units(q) } as never).map((m) => m.concept.id);

describe("belirsiz tek kelime, çöken kalıp üzerinden kavramı TETİKLEMEZ", () => {
  const cases: [string, string][] = [
    ["Sıcak su gelmiyor", "ac"],
    ["Duşun suyu sıcak değil", "ac"],
    ["Dairede sıcak su yok", "ac"],
    ["Su soğuk akıyor", "heating"],
    ["Is there hot water?", "water_cut"],
    ["Is the tap water drinkable?", "water_cut"],
    ["Where can I get groceries?", "address"],
    ["Can you check the AC?", "checkin"],
  ];
  for (const [q, not] of cases) {
    it(`"${q}" → ${not} DEĞİL`, () => {
      expect(ids(q)).not.toContain(not);
    });
  }
});

describe("GERİ ÇAĞIRMA — anlamı taşıyan kalıp yine tespit edilir (çekim dahil)", () => {
  const cases: [string, string][] = [
    ["Daire çok sıcak", "ac"],
    ["Oda çok sıcaktı", "ac"],
    ["Oda çok soğuk", "heating"],
    ["Çok soğuktu gece", "heating"],
    ["There is no water", "water_cut"],
    ["No water in the apartment", "water_cut"],
    ["How do I get there?", "address"],
    ["When can I check in?", "checkin"],
    ["What time is check in?", "checkin"],
    ["check-in time?", "checkin"],
    ["What time are we checking in?", "checkin"],
    // Tek kelimeye inen kayıtların eşdeğer yazımı — davranış AYNI kalmalı:
    ["Kurallar neler?", "rules"],
    ["How to cook pasta?", "stove"],
    ["Buraya nasıl gelinir?", "address"],
    ["Nerede yiyebiliriz?", "restaurant"],
    ["Havalimanına nasıl giderim?", "airport"],
    ["Plaja nasıl gideriz?", "beach"],
    ["Arabayı nereye park edebilirim?", "parking"],
    ["Kaçta girebilirim?", "checkin"],
  ];
  for (const [q, concept] of cases) {
    it(`"${q}" → ${concept}`, () => {
      expect(ids(q)).toContain(concept);
    });
  }
});

describe("sözlük tür sözleşmesi (B) ve kalıp birimleri (C)", () => {
  it("hiçbir kayıt yazıldığından farklı bir şeye inmez (tek kelimeye inen kalıp yok)", () => {
    const problems = (lexicon as { lexiconProblems?: () => string[] }).lexiconProblems;
    expect(problems).toBeTypeOf("function");
    expect(problems!()).toEqual([]);
  });

  it("denetim vakumlu değil: tek kelimeye inen kalıp RAPORLANIR", () => {
    const problems = (lexicon as { lexiconProblems?: (c: unknown) => string[] }).lexiconProblems!;
    expect(problems([{ id: "x", terms: [], detectOnly: ["cok sicak"] }])).toHaveLength(1);
    expect(problems([{ id: "x", terms: [], phrases: ["sicak"] }])).toHaveLength(1);
    expect(problems([{ id: "x", terms: ["sicak su"] }])).toHaveLength(1);
    expect(problems([{ id: "x", terms: [], expandOnly: ["sicak su"] }])).toHaveLength(1);
    expect(problems([{ id: "x", terms: ["sicak"], expandOnly: ["su"], detectOnly: ["sicak su"], phrases: ["cok sicak"] }])).toEqual([]);
  });

  it("kalıp birimleri durak sözcüğü korur, içerik sözcüğünü kök alır", () => {
    const phraseUnits = (text as { phraseUnits?: (s: string) => string[] }).phraseUnits;
    expect(phraseUnits).toBeTypeOf("function");
    expect(phraseUnits!("Oda çok sıcaktı")).toEqual(["od", "cok", "sicak"]);
    expect(phraseUnits!("There is no water")).toEqual(["there", "is", "no", "water"]);
  });

  it('"checkin" kökü sökülmez; "checking" yine "check"', () => {
    expect(stem("checkin")).toBe("checkin");
    expect(stem("checkinler")).toBe("checkin");
    expect(stem("checking")).toBe("check");
  });
});

describe("saat alanı kuralı: başka konu yine başka konu; 'check' giriş saati DEĞİL", () => {
  it("'Check the heating before 22:00.' giriş saati sayılmaz (sahte çelişki = gereksiz devir)", () => {
    expect(fieldTimeHits("Info", "Check the heating before 22:00.")).toEqual([]);
  });

  it("gerçek giriş saati yine atfedilir (bileşik ve -ing biçimi)", () => {
    expect(fieldTimeHits("Arrival", "Check in from 15:00.")).toEqual([expect.objectContaining({ field: "checkin", time: "15:00" })]);
    expect(fieldTimeHits("Info", "Checking in after 15:00 is possible.")).toEqual([
      expect.objectContaining({ field: "checkin", time: "15:00" }),
    ]);
  });

  it("çöken kalıbın içerik sözcüğü 'başka konu' sayılmaya devam eder (başlık ödünç verilmez)", () => {
    expect(fieldTimeHits("Giriş", "Get the keys at 15:00.")).toEqual([]);
    expect(fieldTimeHits("Giriş", "Su soğuk olabilir 06:00'ya kadar.")).toEqual([]);
  });
});

describe("saat çelişkisi kapısı kalıp birimlerini görür", () => {
  const conflict = [{ field: "checkInTime" as const, propertyValue: "15:00", kbValues: ["14:00"] }];
  it("'checking in' giriş konusudur → çelişkide cevap tutulur", () => {
    expect(timeConflictHolds(conflict, { intent: "general", reply: "The Wi-Fi is Lale-5G.", guestTexts: ["What time are we checking in?"] })).toBe(true);
  });
  it("'Can you check the AC?' giriş konusu DEĞİL → çelişki bu cevabı tutmaz", () => {
    expect(timeConflictHolds(conflict, { intent: "general", reply: "Klima kumandası çekmecede.", guestTexts: ["Can you check the AC?"] })).toBe(false);
  });
});

describe("arama tarafı kalıp birimlerini geçirir (40 kalemlik bilgi tabanı, üretim seçicisi)", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const real = [
    { id: "watercut", category: "general", title: "Su kesintisi", content: "Mahallede su kesintisi olursa binanın deposu birkaç saat yeter." },
    { id: "hotwater", category: "general", title: "Sıcak su", content: "Sıcak su için kombi mutfak dolabının içinde." },
    { id: "ac", category: "general", title: "Klima", content: "Klima kumandası salondaki çekmecede; soğutma için kar tanesi modu." },
    { id: "wifi", category: "wifi", title: "Wi-Fi", content: "Ağ adı Lale-5G, şifre modemin altında." },
  ];
  const items = [...real.map((r, i) => ({ ...r, updatedAt: new Date(t0 + i * 60_000) })), ...neutralPadding(36, t0)];
  const picked = (q: string) =>
    selectKbForPrompt({ items, guestMessage: q, mode: "hybrid" }).items.map((x) => x.id).filter((id) => !id.startsWith("pad_"));

  it("'Daire çok sıcak' → klima kalemi isteme GİRER (kalıp 'çok sıcak' arama tarafında da eşleşir)", () => {
    expect(picked("Daire çok sıcak")).toContain("ac");
  });

  it("'Sıcak su gelmiyor' → klima kalemi isteme GİRMEZ (tek 'sıcak' artık klimayı çekmez)", () => {
    const p = picked("Sıcak su gelmiyor");
    expect(p).toContain("hotwater");
    expect(p).not.toContain("ac");
  });
});
