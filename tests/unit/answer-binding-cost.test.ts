import { describe, it, expect, vi } from "vitest";

// Cevap parçası doğrulayıcısı (`ai/answer-binding.ts`) misafir / KB metni üzerinde çalışır → uzun girdide doğrusal olmalı (ReDoS dersi 09-28).
vi.mock("server-only", () => ({}));

import { checkAnswerBinding } from "@/lib/ai/answer-binding";
import { needTerms } from "@/lib/conversation-items/topic-absence";

const POOL = { needTerms: needTerms(["havuz kaçta kapanıyor"]), needTopics: ["pool"] };

describe("answer-binding maliyet", () => {
  it("çok değerli uzun alıntı", () => {
    const long = "Havuz 20:00'de kapanır, hafta sonu 23:00'te, ".repeat(1_500);
    const t0 = performance.now();
    checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor. ".repeat(200), evidence: long, sourceText: long, ...POOL });
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it("🚨 konusuz değer dizisi (devralma geri yürüyüşü) karesel değil — eski sürüm 27.000 karakterde 2 dakikayı aştı (ölçüldü)", () => {
    for (const ev of ["x 20:00, ".repeat(3_000), "20:00. ".repeat(4_000), "20:00, ve ".repeat(3_000)]) {
      const t0 = performance.now();
      checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor. ".repeat(50), evidence: ev, sourceText: ev, ...POOL });
      expect(performance.now() - t0).toBeLessThan(4000);
    }
  });

  it("koşullu değişke taraması (kalemin tamamı) uzun kalemde doğrusal", () => {
    const src = "Havuz 20:00'de kapanır, hafta sonu 23:00'te. ".repeat(1_500) + "Havuz 21:00'de kapanır.";
    const t0 = performance.now();
    checkAnswerBinding({ part: "Havuz 21:00'de kapanıyor. ".repeat(50), evidence: "Havuz 21:00'de kapanır.", sourceText: src, ...POOL });
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  // 🚨 Kırmızı-önce (10-23): Opus sertleştirmesinin önbelleksiz ilk hâlinde yukarıdaki "çok değerli uzun alıntı" girdisinin 1/10'u 1,3 sn,
  // 1/5'i 9,2 sn sürdü (kübik; tam boyut dakikalarca, koşu durduruldu). Önbellekle tam boyut ~0,8 sn.
  it("her parça değeri × kalemdeki her yer: konu / istisna / ücret tabanı okumaları yer başına bir kez", () => {
    // Tek uzun cümle (virgüllerle), çok konulu ihtiyaç (havuz + sauna), istisna sözcüğü ve tutar: konu kimliği, istisna ve ücret tabanı
    // okumaları her (değer, yer) çiftinde yeniden yapılıyordu.
    const multi = { needTerms: needTerms(["havuz ve sauna kaçta kapanıyor"]), needTopics: ["pool", "sauna"] };
    const long = "Havuz 20:00'de kapanır, sauna 22:00'de, pazar hariç, giriş 200 TL günlük, ".repeat(1_000);
    const t0 = performance.now();
    checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor, giriş 200 TL. ".repeat(200), evidence: long, sourceText: long, ...multi });
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it("uzun tek sözcük / boşluk dizisi / bağlaç dizisi", () => {
    for (const ev of ["a".repeat(50_000), " ".repeat(50_000) + "20:00", "ve ".repeat(15_000) + "20:00", "20:00 - ".repeat(5_000)]) {
      const t0 = performance.now();
      checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor.", evidence: ev, sourceText: ev, ...POOL });
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
});

// 🚨 Opus güvenlik 10-23 F4 (ölçüldü, düzeltme öncesi): virgülsüz tek yan cümlede her değer için yan cümle başından yürünüyordu —
// "Havuz x 21:00 x 21:00 …" 24.000 karakterde 3,7 sn; 8 kalem × 3.000 karakterde 10 ihtiyaç 5 sn (her ihtiyaç bütün kalemleri yeniden
// ayrıştırıyordu). Düzeltme: önek sayımı + tur içi belge önbelleği + değer başına incelenen yer tavanı.
describe("answer-binding maliyet — Opus güvenlik 10-23 F4", () => {
  it("virgülsüz yan cümlede yüzlerce değer: doğrusal", () => {
    const src = "Havuz " + "x 21:00 ".repeat(3_000);
    const t0 = performance.now();
    checkAnswerBinding({ part: "Havuz 21:00'de kapanır, hafta sonu 22:00.", evidence: src.slice(0, 40), sourceText: src, ...POOL, otherSources: [src, `${src} `] });
    expect(performance.now() - t0).toBeLessThan(2500);
  });

  it("aynı istemde çok ihtiyaç: kalemler ihtiyaç başına yeniden ayrıştırılmaz", async () => {
    const { composeVerifiedReply } = await import("@/lib/ai/answer-parts");
    const { kbLine } = await import("@/lib/ai/retrieval/kb-line");
    const sources = Array.from({ length: 8 }, (_, i) => ({
      id: `kb:${i + 1}`,
      text: kbLine({ category: "rules", title: `Kural ${i}`, content: ("Havuz " + "x 21:00 ".repeat(400)).slice(0, 3_000) }),
    }));
    const needs = Array.from({ length: 10 }, (_, i) => ({ ref: `R${i + 1}`, terms: ["havuz", "pool"], topics: ["pool"] }));
    const parts = needs.map((n) => ({ ref: n.ref, status: "answered" as const, text: "Havuz 21:00'de kapanır.", evidence: "Havuz x 21:00" }));
    const t0 = performance.now();
    composeVerifiedReply({ parts, needs, sources });
    expect(performance.now() - t0).toBeLessThan(2500);
  });
});

describe("answer-binding maliyet — Opus dilim sonu 10-23 R8", () => {
  it("🚨 çok konulu ihtiyaç + virgülle dizilmiş yüzlerce değer: değer yerinin konu kimlikleri parça başına bir kez (eski: ihtiyaç başına 2,4 sn)", () => {
    const hh = (i: number) => `${String(Math.floor(i / 60) % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;
    let src = "Havuz ve sauna saatleri: ";
    let n = 0;
    for (; n < 380; n++) {
      const add = `saat ${hh(n)}, `;
      if (src.length + add.length > 4950) break;
      src += add;
    }
    src += "kapanır.";
    const vals: string[] = [];
    for (let j = n - 1; j >= 0 && ("Havuz ve sauna " + vals.join(", ")).length < 585; j--) vals.unshift(hh(j));
    const part = `Havuz ve sauna ${vals.join(", ")}.`;
    const q = ["havuz ve sauna kaçta kapanıyor", "when do the pool and sauna close"];
    const t0 = performance.now();
    checkAnswerBinding({ part, evidence: src, sourceText: src, needTerms: needTerms(q), needTopics: ["pool"] });
    expect(performance.now() - t0).toBeLessThan(1200);
  });
});

describe("answer-binding maliyet — Opus e2e 10-23 sorulan yön / tesis", () => {
  it("yön ve tesis okumaları uzun girdide doğrusal (tek sözcük / boşluk dizisi / tekrarlanan kalıp başı)", async () => {
    const { askedAspects, missingAspects, missesAskedFacility } = await import("@/lib/ai/answer-binding");
    for (const s of ["a".repeat(50_000), " ".repeat(50_000), "kac ".repeat(12_000), "how much ".repeat(6_000), "smoke-".repeat(8_000) + "free", "havuz sauna ".repeat(4_000)]) {
      const t0 = performance.now();
      askedAspects([s]);
      missingAspects(s, ["time", "price"]);
      missesAskedFacility(s, [s]);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });
});
