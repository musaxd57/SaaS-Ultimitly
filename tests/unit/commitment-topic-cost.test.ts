import { describe, it, expect } from "vitest";
import { commitmentTopicOf, detectHostPromise } from "@/lib/ai-suggestions/core";
import { foldTurkishAscii } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// I1 süre pini (CLAUDE.md "yeni kalıp → süre pini"; Haiku 10-17): söz okuyucusu en uzun mesajda (4.000 karakter) ve uzun tek sözcük / boşluk
// dizisinde doğrusal kalır; konu okuyucusu sözcük ve karakter tavanıyla sınırlı.
// ---------------------------------------------------------------------------

describe("söz konusu — maliyet", () => {
  it("4.000 karakterlik mesaj, uzun tek sözcük ve boşluk dizisi: söz okuyucusu (konu dahil) hızlı", () => {
    const inputs = [
      `Klima için teknisyen yarın 10:00'da gelecek ${"ve musluk ".repeat(390)}`.slice(0, 4_000),
      `Teknisyen yarın gelecek ${"a".repeat(3_970)}`,
      `Klima için teknisyen yarın ${" ".repeat(3_960)} gelecek`,
      `The technician will fix the ${"light ".repeat(640)}`.slice(0, 4_000),
    ];
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) for (const text of inputs) detectHostPromise(text);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });

  it("konu okuyucusu: tavanı aşan uzun parça erken döner", () => {
    const long = `Klima için teknisyen ${"kelime ".repeat(5_000)}`;
    const t0 = performance.now();
    expect(commitmentTopicOf("maintenance", long, foldTurkishAscii(long).toLowerCase())).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
