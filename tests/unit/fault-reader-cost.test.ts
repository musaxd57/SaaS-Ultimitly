import { describe, it, expect } from "vitest";
import { faultDevicesOf, unsupportedFixStep } from "@/lib/conversation-items/relation";

// ARIZA OKUYUCU + KANITSIZ ADIM KEMERİ — süre pini (Codex 10-16: cümlecik tavanı kaldırıldı, misafir metni BÜTÜNÜYLE okunur). Misafir
// metni yapay zekâya en çok 8.000 karakter gider (`ai/message-length.ts`; üstü ev sahibine kalır) → saldırgan en kötü durum burada ölçülür.
// Ayrı dosya: paralel kapıda süre ölçen kol en sonda tek başına koşar.

describe("arıza okuyucu — süre", () => {
  it("8.000 karakterlik saldırgan misafir metni (binlerce cümlecik) doğrusal ve küçük", () => {
    const none = { recipeTopics: new Set<string>(), subjectTopics: new Set<string>() };
    const t0 = performance.now();
    faultDevicesOf("a, ".repeat(2_700));
    faultDevicesOf("klima, ".repeat(1_150));
    faultDevicesOf("televizyon çalışmıyor mu, ".repeat(300));
    unsupportedFixStep("Klimayı kapatıp açın. ".repeat(199), none, `Klima çalışmıyor ${"a, ".repeat(2_600)}`);
    expect(performance.now() - t0).toBeLessThan(3_000);
  });
});
