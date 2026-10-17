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

  it("🚨 gpt-6 ailesi (Luna/Sol/Astra, 09-25) ve sonrası da reasoning — API ölçüldü: temperature 0.4 ve max_tokens REDDEDİLİR", () => {
    // Canlı sonda (09-25, gpt-6-luna): "Unsupported parameter: 'max_tokens'" + "temperature does not support 0.4".
    // Eski kural yalnız gpt-5'i tanıyordu → OPENAI_MODEL=gpt-6-luna her misafir cevabını 400 ile düşürürdü.
    for (const m of ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "GPT-6", "gpt-7", "gpt-10-mini"]) {
      expect(isReasoningModel(m), m).toBe(true);
    }
  });

  it("klasik sohbet modelleri reasoning DEĞİL", () => {
    for (const m of ["gpt-4.1", "gpt-4o", "gpt-4.5-preview", "gpt-3.5-turbo", "zai-org/GLM-5.2", "llama-3"]) {
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
