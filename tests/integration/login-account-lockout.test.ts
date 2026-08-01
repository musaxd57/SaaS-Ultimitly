import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { peekRateLimit, rateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// HESAP KOVASI ÜÇÜNCÜ BİR TARAFA KİLİTLEME SİLAHI OLMAMALI.
// (Siber güvenlik denetimi, 2026-08-01 — beşinci tur, ajan bulgusu.)
//
// `login-acct:{email}` kovası kimlik kontrolünden ÖNCE ve KOŞULSUZ tüketiliyordu,
// yani BAŞARILI girişler de sayılıyordu. Sonuç: kurbanın e-postasını bilen biri
// 15 dakikada 21 istekle (~1,4 istek/dk, kimlik doğrulaması GEREKMEZ) hedefi
// KALICI olarak giriş dışı bırakabiliyordu — kurban DOĞRU şifresiyle bile 429.
//
// Doğru desen: kapıda OKU (`peekRateLimit`), yalnız doğrulama BAŞARISIZ olunca
// TÜKET. IP kovası zaten önde durduğu için kaba kuvvet koruması aynen kalır.
// ---------------------------------------------------------------------------
describe("peekRateLimit — okuma sayacı TÜKETMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("hiç kayıt yokken temiz döner ve SATIR YARATMAZ", async () => {
    const v = await peekRateLimit("peek-test:a", 3);
    expect(v.ok).toBe(true);
    expect(await prisma.rateLimitCounter.count({ where: { key: "peek-test:a" } })).toBe(0);
  });

  it("okuma TEKRARI sayacı büyütmez (⬅️ arızada her okuma bir hak yakıyordu)", async () => {
    await rateLimit("peek-test:b", 3, 60_000); // 1 gerçek tüketim
    for (let i = 0; i < 50; i++) expect((await peekRateLimit("peek-test:b", 3)).ok).toBe(true);
    const row = await prisma.rateLimitCounter.findFirstOrThrow({ where: { key: "peek-test:b" } });
    expect(row.count).toBe(1); // 50 okumadan sonra HÂLÂ 1
  });

  it("sınır GERÇEKTEN aşıldığında okuma da kapatır (koruma kaybolmadı)", async () => {
    for (let i = 0; i < 4; i++) await rateLimit("peek-test:c", 3, 60_000);
    const v = await peekRateLimit("peek-test:c", 3);
    expect(v.ok).toBe(false);
    expect(v.retryAfter).toBeGreaterThan(0);
  });

  it("penceresi dolmuş kayıt temiz sayılır", async () => {
    await rateLimit("peek-test:d", 1, 60_000);
    await rateLimit("peek-test:d", 1, 60_000); // aşıldı
    expect((await peekRateLimit("peek-test:d", 1)).ok).toBe(false);
    await prisma.rateLimitCounter.updateMany({
      where: { key: "peek-test:d" },
      data: { resetAt: new Date(Date.now() - 1000) },
    });
    expect((await peekRateLimit("peek-test:d", 1)).ok).toBe(true);
  });

  it("KAYNAK PİNİ: giriş rotası kapıda PEEK, hata dalında TÜKETİM kullanır", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/app/api/auth/login/route.ts", "utf8");
    // Kapı okuma olmalı…
    expect(src).toMatch(/const acct = await peekRateLimit\(`login-acct:/);
    // …ve tüketim YALNIZ başarısız doğrulama dalında (401 dönüşünden önce).
    const failBranch = src.slice(src.indexOf("if (!user || !ok) {"), src.indexOf("E-posta veya şifre hatalı"));
    expect(failBranch).toMatch(/await rateLimit\(`login-acct:/);
    // Kapı dalında tüketen çağrı KALMAMALI.
    const gate = src.slice(0, src.indexOf("const user = await prisma.user.findUnique"));
    expect(gate).not.toMatch(/await rateLimit\(`login-acct:/);
  });
});
