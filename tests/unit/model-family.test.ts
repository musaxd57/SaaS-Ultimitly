import { describe, it, expect } from "vitest";
import { DEFAULT_OPENAI_MODEL, isReasoningModel } from "@/lib/ai/model-family";

// İstek gövdesinin şeklini BU predicate belirliyor (temperature var mı, tavan
// max_tokens mı max_completion_tokens mı). Yanlış cevap = 400 ya da sessizce
// farklı örnekleme → kapı yeniden kalibrasyon ister. O yüzden sabitlenmiş.

describe("isReasoningModel", () => {
  it("gpt-5 ailesi ve o-serisi reasoning sayılır", () => {
    for (const m of ["gpt-5.1", "gpt-5.6-luna", "gpt-5.6-terra", "GPT-5", "o1", "o3-mini", " o4 "]) {
      expect(isReasoningModel(m), m).toBe(true);
    }
  });

  it("klasik sohbet modelleri reasoning DEĞİL", () => {
    for (const m of ["gpt-4.1", "gpt-4o", "zai-org/GLM-5.2", "llama-3"]) {
      expect(isReasoningModel(m), m).toBe(false);
    }
  });
});

describe("DEFAULT_OPENAI_MODEL", () => {
  it("canlıdaki OPENAI_MODEL ile aynı ailede (gpt-5.1)", () => {
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.1");
  });

  it("varsayılan reasoning ailesinde — env kaybolursa istek şekli SESSİZCE değişmez", () => {
    // Eski varsayılan gpt-4.1 idi: OPENAI_MODEL Railway'den düşseydi temperature
    // geri gelir, tavan max_tokens'a dönerdi ve bunu kimse fark etmezdi.
    expect(isReasoningModel(DEFAULT_OPENAI_MODEL)).toBe(true);
  });
});
