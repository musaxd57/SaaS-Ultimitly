import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyProdModelProfile, PROD_MODEL_PROFILE } from "./prod-profile";

// Ücretsiz (model çağrısı yok) — eval yapılandırmasında her koşuda.
describe("ölçüm = ürün ayarı profili (kurucu 10-15)", () => {
  it("yalnız BOŞ değişkeni doldurur; açık değer kazanır; EVAL_PROD_PROFILE=0 kapatır", () => {
    const env = { OPENAI_MODEL: "gpt-5.1", OPENAI_STYLE_MODEL: "" } as unknown as NodeJS.ProcessEnv;
    const filled = applyProdModelProfile(env);
    expect(env.OPENAI_MODEL).toBe("gpt-5.1");
    expect(env.OPENAI_STYLE_MODEL).toBe("gpt-6-luna");
    expect(filled).not.toContain("OPENAI_MODEL");
    expect(filled).toContain("OPENAI_STYLE_MODEL");
    const off = { EVAL_PROD_PROFILE: "0" } as unknown as NodeJS.ProcessEnv;
    expect(applyProdModelProfile(off)).toEqual([]);
    expect(off.OPENAI_MODEL).toBeUndefined();
  });

  it("kurulum dosyası bu koşuda uygulandı (kabukta verilmeyen cevap modeli Luna)", () => {
    if (process.env.EVAL_PROD_PROFILE === "0") return;
    expect(process.env.OPENAI_MODEL?.length).toBeGreaterThan(0);
    expect(process.env.AI_SEMANTIC_MODEL?.length).toBeGreaterThan(0);
  });

  it("🚨 profil Railway açılış listesiyle AYNI (tek yerde değişip öbürü unutulmasın)", () => {
    const doc = readFileSync(path.resolve(__dirname, "../../docs/RAILWAY-ACILIS-2026-10-15.md"), "utf8");
    for (const [k, v] of Object.entries(PROD_MODEL_PROFILE)) {
      const line = doc.split("\n").find((l) => l.includes(`\`${k}\``) || l.includes(`/ \`${k.replace(/^.*?_(REASONING_EFFORT)$/u, "$1")}`));
      expect(line, k).toBeDefined();
      expect(line, `${k}=${v}`).toContain(`\`${v}\``);
    }
  });
});
