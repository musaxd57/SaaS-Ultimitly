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

  it("uzun tek sözcük / boşluk dizisi / bağlaç dizisi", () => {
    for (const ev of ["a".repeat(50_000), " ".repeat(50_000) + "20:00", "ve ".repeat(15_000) + "20:00", "20:00 - ".repeat(5_000)]) {
      const t0 = performance.now();
      checkAnswerBinding({ part: "Havuz 20:00'de kapanıyor.", evidence: ev, sourceText: ev, ...POOL });
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
});
