import { describe, it, expect } from "vitest";
import { heldPetLeak } from "@/lib/conversation-items/pet-policy";

// ---------------------------------------------------------------------------
// S3 — `heldPetLeak` uzun girdide sınırlı süre. Girdi cevap modelinin metnidir (birkaç bin karakter), ama kural aynı: kalıpta karesel iş yok
// (çapalı almaşıklar, sınırlı ek; yan cümle temizliği tek geçiş). Kötü biçimli / çok uzun bir model çıktısı kapıyı kilitlemesin.
// ---------------------------------------------------------------------------

describe("heldPetLeak — uzun girdide sınırlı süre", () => {
  const cases: [string, string][] = [
    ["tek uzun sözcük × 40.000", "a".repeat(40_000)],
    ["boşluk dizisi × 40.000", `Wi-Fi${" ".repeat(40_000)}şifresi Lale2024.`],
    ["virgüllü yan cümle × 8.000", "bilgi, ".repeat(8_000)],
    ["noktalı kısa cümle × 8.000", "Bilgi. ".repeat(8_000)],
    ["ünlem dizisi × 20.000 + harf", `${"!".repeat(20_000)}a`],
    ["'kabul ' kökü × 6.000 (ek gelmiyor)", "kabul ".repeat(6_000)],
    ["'no ' × 10.000 (rakam gelmiyor)", "no ".repeat(10_000)],
    ["'minik ' × 8.000 (dost gelmiyor)", "minik ".repeat(8_000)],
    ["'is very ' × 6.000 (welcome gelmiyor)", "is very ".repeat(6_000)],
  ];
  for (const [name, input] of cases) {
    it(`${name} → 1,5 sn altında`, () => {
      const t0 = performance.now();
      heldPetLeak(input);
      expect(performance.now() - t0).toBeLessThan(1_500);
    });
  }
});
