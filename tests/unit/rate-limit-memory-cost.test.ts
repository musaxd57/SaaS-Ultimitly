import { describe, it, expect, vi } from "vitest";

// Codex 11-05 (P2) — süre pini: veritabanı kapalıyken 30.000 farklı anahtar. Eski bellek yedeğinde 5.000'in üstündeki her yeni anahtar
// bütün haritayı tarıyordu (karesel: ~4×10⁸ kayıt ziyareti); sınırlı temizlikle iş doğrusal. Yalnız genel API (`rateLimit`) kullanılır.

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => {
      throw new Error("db down (test)");
    }),
    $executeRaw: vi.fn(async () => {
      throw new Error("db down (test)");
    }),
  },
}));

import { rateLimit, __resetRateLimit } from "@/lib/rate-limit";

describe("hız sınırı bellek yedeği — maliyet", () => {
  it("🚨 veritabanı yokken 30.000 farklı anahtar 3 saniyenin altında işlenir (eskiden karesel tarama)", async () => {
    __resetRateLimit();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t0 = performance.now();
    for (let i = 0; i < 30_000; i++) await rateLimit(`ip:${i}`, 5, 60 * 60_000);
    expect(performance.now() - t0).toBeLessThan(3_000);
  }, 120_000);
});
