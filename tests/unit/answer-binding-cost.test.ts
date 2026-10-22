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
