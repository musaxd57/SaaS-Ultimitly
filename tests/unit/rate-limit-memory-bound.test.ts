import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Codex 11-05 (43fb93e incelemesi, P2): veritabanı arızasında hız sınırının bellek yedeği SINIRSIZ büyüyordu — 5.000 kayıttan sonra her
// yeni anahtar bütün haritayı tarıyor, süresi dolmamış kayıt için üst sınır yoktu. İstenen: sert bellek sınırı, sınırlı maliyetli temizlik
// ve etkin kayıtları SİLMEYEN arıza politikası (silmek saldırgana yeni hak verirdi). Veritabanı burada kasıtlı olarak "kapalı": testler
// gerçek genel yolu (`rateLimit` → bellek yedeği) koşar.
// ---------------------------------------------------------------------------

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

import {
  rateLimit,
  rateLimitPeek,
  rateLimitRelease,
  rateLimitMemoryStats,
  __resetRateLimit,
  __setOverflowSeedForTest,
  __overflowSlotOfForTest,
  MEMORY_MAX_KEYS,
} from "@/lib/rate-limit";

const HOUR = 60 * 60_000;

async function flood(prefix: string, n: number, windowMs = HOUR) {
  for (let i = 0; i < n; i++) await rateLimit(`${prefix}:${i}`, 5, windowMs);
}

describe("hız sınırı bellek yedeği — veritabanı yokken sınırlı", () => {
  beforeEach(() => {
    __resetRateLimit();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("🚨 30.000 farklı (süresi dolmamış) anahtar: bellekte en çok sert sınır kadar anahtar; temizlik ekleme başına sınırlı maliyet", async () => {
    await flood("ip", 30_000);
    const s = rateLimitMemoryStats();
    expect(s.keys).toBeLessThanOrEqual(MEMORY_MAX_KEYS);
    expect(s.overflowActive).toBeGreaterThan(0);
    // Eski kod: tavanın üstünde her yeni anahtar bütün haritayı tarıyordu (~yüz milyonlarca ziyaret). Şimdi ekleme başına sabit tavan.
    expect(s.sweepVisits).toBeLessThanOrEqual(30_000 * 64); // ekleme başına en çok 64 ziyaret (Opus F11: eskiden 3× gevşek sınır)
  });

  it("🚨 sınırı aşan anahtar, araya giren sel sonrasında da SINIRLI kalır (etkin kayıt silinmez → hak sıfırlanmaz)", async () => {
    for (let i = 0; i < 5; i++) expect((await rateLimit("login-acct:a@x.com", 5, HOUR)).ok).toBe(true);
    expect((await rateLimit("login-acct:a@x.com", 5, HOUR)).ok).toBe(false);
    await flood("ip", 20_000);
    expect((await rateLimit("login-acct:a@x.com", 5, HOUR)).ok).toBe(false);
    expect((await rateLimitPeek("login-acct:a@x.com", 5)).ok).toBe(false);
  });

  it("🚨 tavan doluyken YENİ anahtar da sınırlanır (taşma yuvası; çakışma yalnız sıkılaştırır)", async () => {
    await flood("ip", MEMORY_MAX_KEYS);
    expect(rateLimitMemoryStats().keys).toBe(MEMORY_MAX_KEYS);
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) results.push((await rateLimit("new-key", 5, HOUR)).ok);
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(5);
    expect(results.at(-1)).toBe(false);
    expect(rateLimitMemoryStats().keys).toBe(MEMORY_MAX_KEYS);
  });

  it("süresi dolan kayıtlar adım adım temizlenir; yer açılınca yeni anahtar yine haritaya girer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    await flood("short", 5_000, 1_000);
    expect(rateLimitMemoryStats().keys).toBe(5_000);
    vi.setSystemTime(new Date("2026-11-05T12:00:05Z"));
    await flood("fresh", 200);
    // 200 ekleme × adım 64 = 12.800 ziyaret ≥ 5.000 süresi dolmuş kayıt → hepsi gitti, yalnız yeniler kaldı.
    expect(rateLimitMemoryStats().keys).toBe(200);
  });

  it("🚨 taşmada sayılan anahtar haritaya dönerken sayacını YANINDA götürür (geri dönüşte de sıfırlanma yok)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    await flood("short", MEMORY_MAX_KEYS, 1_000);
    for (let i = 0; i < 4; i++) expect((await rateLimit("carry", 5, HOUR)).ok).toBe(true);
    vi.setSystemTime(new Date("2026-11-05T12:00:05Z"));
    // Yer aç: süresi dolan kayıtlar adım adım gider.
    await flood("fresh", 400);
    expect(rateLimitMemoryStats().keys).toBeLessThan(MEMORY_MAX_KEYS);
    // 5. isabet hâlâ hak içinde (4 + 1), 6. reddedilir — sayaç taşmadan taşındı, sıfırdan başlamadı.
    expect((await rateLimit("carry", 5, HOUR)).ok).toBe(true);
    expect((await rateLimit("carry", 5, HOUR)).ok).toBe(false);
  });

  it("🚨 F4: taşma yuvası tohumlu — aynı anahtar farklı tohumda farklı yuvaya düşebilir (önceden hesaplanamaz)", () => {
    const keys = Array.from({ length: 64 }, (_, i) => `login-acct:k${i}@example.test`);
    __setOverflowSeedForTest(1);
    const a = keys.map((k) => __overflowSlotOfForTest(k));
    __setOverflowSeedForTest(2);
    const b = keys.map((k) => __overflowSlotOfForTest(k));
    expect(a).not.toEqual(b);
  });

  it("🚨 N4: tohumun YÜKSEK bitleri de yuvayı değiştirir (eskiden 32 bitlik tohumun yalnız düşük 10 biti işe yarıyordu)", () => {
    const keys = Array.from({ length: 64 }, (_, i) => `login-acct:k${i}@example.test`);
    __setOverflowSeedForTest(0x00000001);
    const a = keys.map((k) => __overflowSlotOfForTest(k));
    __setOverflowSeedForTest(0x80000001); // düşük 10 bit AYNI
    const b = keys.map((k) => __overflowSlotOfForTest(k));
    expect(a).not.toEqual(b);
  });

  it("🚨 N4: başka pencere sınıfının (1 sa) dolu yuvası kısa pencereli (60 sn) anahtarı HİÇ kilitlemez; aynı sınıfta çakışma yine yalnız sıkılaştırır (kendi penceresiyle)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    __setOverflowSeedForTest(7);
    const victim = "reply:org:conv";
    const slot = __overflowSlotOfForTest(victim);
    const collide = (prefix: string, skip = "") => {
      for (let i = 0; i < 400_000; i++) if (`${prefix}${i}` !== skip && __overflowSlotOfForTest(`${prefix}${i}`) === slot) return `${prefix}${i}`;
      return "";
    };
    const hourKey = collide("login-acct:x");
    const minuteKey = collide("reply:o:c");
    expect(hourKey).not.toBe("");
    expect(minuteKey).not.toBe("");
    await flood("short", MEMORY_MAX_KEYS, 2_000); // tavan dolu (2 sn'lik kayıtlar)
    for (let i = 0; i < 3; i++) await rateLimit(hourKey, 3, HOUR); // 1 saatlik sınıfın yuvası doldu
    expect((await rateLimit(victim, 2, 60_000)).ok).toBe(true); // eskiden: 1 SAAT boyunca 429
    // Aynı (dakikalık) sınıfta çakışan anahtar yuvayı paylaşır → sıkılaştırır, ama en çok kendi penceresi kadar.
    expect((await rateLimit(minuteKey, 2, 60_000)).ok).toBe(true);
    const r = await rateLimit(victim, 2, 60_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });

  it("🚨 N4: taşmadan haritaya DÖNEN anahtar yalnız KENDİ pencere sınıfının sayacını taşır (başka sınıfın dolu yuvası taşınmaz)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    __setOverflowSeedForTest(11);
    const victim = "reply:org:conv2";
    const slot = __overflowSlotOfForTest(victim);
    let hourKey = "";
    for (let i = 0; i < 400_000 && !hourKey; i++) if (__overflowSlotOfForTest(`login-acct:y${i}`) === slot) hourKey = `login-acct:y${i}`;
    expect(hourKey).not.toBe("");
    await flood("short", MEMORY_MAX_KEYS, 2_000); // tavan dolu
    expect((await rateLimit(victim, 2, 60_000)).ok).toBe(true); // dakikalık sınıfın yuvası: 1
    for (let i = 0; i < 3; i++) await rateLimit(hourKey, 3, HOUR); // saatlik sınıfın AYNI numaralı yuvası: 3
    vi.setSystemTime(new Date("2026-11-05T12:00:05Z")); // haritadakiler doldu → yer açılır
    await flood("fresh", 400);
    // Haritaya dönüş: taşınan = KENDİ sınıfı (1) + 1 = 2 ≤ 2 → izin. (Saatlik yuvanın 3'ü taşınsaydı 4 > 2 → ret.)
    expect((await rateLimit(victim, 2, 60_000)).ok).toBe(true);
    expect((await rateLimit(victim, 2, 60_000)).ok).toBe(false);
  });

  it("iade (release) KENDİ pencere sınıfının taşma yuvasındaki ayrılmış hakkı geri verir; sıfırın altına inmez", async () => {
    await flood("ip", MEMORY_MAX_KEYS);
    for (let i = 0; i < 5; i++) await rateLimit("refund", 5, HOUR);
    expect((await rateLimitPeek("refund", 5, HOUR)).ok).toBe(false);
    await rateLimitRelease("refund", HOUR);
    expect((await rateLimitPeek("refund", 5, HOUR)).ok).toBe(true);
  });

  it("🚨 N4: pencere söylemeyen iade PAYLAŞILAN taşma yuvasını gevşetmez (başka anahtarın sayacı); bakış pencere söylemezse yine sıkı", async () => {
    await flood("ip", MEMORY_MAX_KEYS);
    for (let i = 0; i < 5; i++) await rateLimit("refund", 5, HOUR);
    await rateLimitRelease("refund");
    expect((await rateLimitPeek("refund", 5, HOUR)).ok).toBe(false);
    expect((await rateLimitPeek("refund", 5)).ok).toBe(false);
  });

  it("taşma yuvasının penceresi dolunca yuva sıfırlanır (taşmada kalıcı kilit yok)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    await flood("ip", MEMORY_MAX_KEYS); // tavan uzun pencereli (1 sa) etkin kayıtlarla dolu
    for (let i = 0; i < 5; i++) expect((await rateLimit("short", 5, 1_000)).ok).toBe(true);
    expect((await rateLimit("short", 5, 1_000)).ok).toBe(false);
    vi.setSystemTime(new Date("2026-11-05T12:00:02Z"));
    expect(rateLimitMemoryStats().keys).toBe(MEMORY_MAX_KEYS); // hâlâ dolu → yine taşma yuvası
    expect((await rateLimit("short", 5, 1_000)).ok).toBe(true);
  });

  it("KONTROL — tavan altında davranış eskisiyle aynı: sınıra kadar izin, sonra ret", async () => {
    // Sıfırlama bellek yedeğini (taşma yuvaları dahil) tamamen boşaltır — önceki testlerin taşma sayaçları buraya sızmaz.
    expect(rateLimitMemoryStats()).toEqual({ keys: 0, overflowActive: 0, sweepVisits: 0 });
    for (let i = 0; i < 3; i++) expect((await rateLimit("k", 3, HOUR)).ok).toBe(true);
    const r = await rateLimit("k", 3, HOUR);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
});
