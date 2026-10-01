import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { bumpAlertEmailGeneration, consumeAlertEmailGeneration } from "@/lib/alert-email-generation";

// ---------------------------------------------------------------------------
// Uyarı adresi KUŞAĞI sözleşmesi (15 ajan A13 F2, 10-01): artırma atomik ve 1'den başlar; tüketme yalnız GÜNCEL kuşakta olur
// ve kuşağı İLERLETİR (aynı bağlantı ikinci kez tüketilemez — rota dışında bir yazma yolu kuşak artırmasa da). İşletmeler ayrı.
// ---------------------------------------------------------------------------

describe("uyarı adresi kuşağı", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("artırma 1'den başlar ve her çağrıda bir artar; işletmeler birbirini etkilemez", async () => {
    expect(await bumpAlertEmailGeneration("org_a")).toBe(1);
    expect(await bumpAlertEmailGeneration("org_a")).toBe(2);
    expect(await bumpAlertEmailGeneration("org_b")).toBe(1);
  });

  it("🚨 tüketme TEK kullanımlık: güncel kuşak bir kez tüketilir, ikinci kez tüketilemez; eski / ileri kuşak tüketilemez", async () => {
    const g = await bumpAlertEmailGeneration("org_a");
    expect(await consumeAlertEmailGeneration("org_a", g + 1)).toBe(false);
    expect(await consumeAlertEmailGeneration("org_a", g)).toBe(true);
    expect(await consumeAlertEmailGeneration("org_a", g)).toBe(false);
    // Tüketme kuşağı ilerletti: sonraki artırma onun ÜSTÜNDEN devam eder.
    expect(await bumpAlertEmailGeneration("org_a")).toBe(g + 2);
    expect(await consumeAlertEmailGeneration("org_b", g)).toBe(false); // başka işletmenin satırı yok
  });

  it("eşzamanlı artırmalar aynı kuşağı iki kez vermez", async () => {
    const values = await Promise.all(Array.from({ length: 10 }, () => bumpAlertEmailGeneration("org_c")));
    expect(new Set(values).size).toBe(10);
    expect(Math.max(...values)).toBe(10);
  });
});
