import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyPassword, hashPassword, dummyVerifyPassword, PasswordHashBusyError, __passwordHashSlots } from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// PAROLA İŞLEMİ EŞZAMANLILIK KAPISI (09-23, login ajanı F4 — ÖLÇÜLDÜ)
//
// bcryptjs saf JS: 8 eşzamanlı karşılaştırma olay döngüsünü ~800 ms'lik aralıklarla
// donduruyordu (panel, cron, QR sohbeti dahil). Kapı: aynı anda en fazla N iş, fazlası
// sınırlı kuyrukta sınırlı süre bekler, taşarsa `PasswordHashBusyError` (→ 503).
// Gerçek bcrypt ile (maliyet 12, ~300 ms) — sahte gecikme değil.
// ---------------------------------------------------------------------------

const H12 = "$2a$12$pW7aCpH9gDjLDJgWwMZS9e4XetljqUVeM6688s259LuXEGh42XYii";

afterEach(() => vi.unstubAllEnvs());

describe("parola işlemi kapısı", () => {
  it("🚨 tavan dolunca iş KUYRUKTA bekler; kuyruk da doluysa ANINDA 'yoğun' hatası", async () => {
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    vi.stubEnv("PASSWORD_HASH_MAX_QUEUE", "1");
    vi.stubEnv("PASSWORD_HASH_MAX_WAIT_MS", "20000");
    const a = verifyPassword("x", H12);
    const b = verifyPassword("x", H12);
    const c = verifyPassword("x", H12);
    await expect(c).rejects.toBeInstanceOf(PasswordHashBusyError);
    expect(__passwordHashSlots()).toEqual({ inFlight: 1, queued: 1 });
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false); // kuyruktaki iş yuvayı DEVRALIP tamamlandı
    expect(__passwordHashSlots()).toEqual({ inFlight: 0, queued: 0 });
  }, 30_000);

  it("kuyrukta bekleme süresi dolarsa 'yoğun' hatası; yuva SIZMAZ", async () => {
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    vi.stubEnv("PASSWORD_HASH_MAX_QUEUE", "5");
    vi.stubEnv("PASSWORD_HASH_MAX_WAIT_MS", "30");
    const a = verifyPassword("x", H12);
    const b = verifyPassword("x", H12);
    await expect(b).rejects.toBeInstanceOf(PasswordHashBusyError);
    await expect(a).resolves.toBe(false);
    expect(__passwordHashSlots()).toEqual({ inFlight: 0, queued: 0 });
  }, 30_000);

  it("fırlatan iş de yuvayı BIRAKIR (kapı kilitlenmez)", async () => {
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    // bcryptjs geçersiz tipte REDDEDER ("Illegal arguments") — gerçek bir fırlatma yolu.
    await expect(verifyPassword("x", undefined as unknown as string)).rejects.toThrow(/Illegal arguments/);
    expect(__passwordHashSlots()).toEqual({ inFlight: 0, queued: 0 });
    await expect(verifyPassword("x", H12)).resolves.toBe(false);
  }, 30_000);

  it("🚨 ÜÇ işlem de AYNI kapıdan geçer: hash ve SAHTE doğrulama da (bilinmeyen hesap yolu = bilinen hesap yolu → zamanlama kâhini yok)", async () => {
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    vi.stubEnv("PASSWORD_HASH_MAX_QUEUE", "0");
    const holder = verifyPassword("x", H12);
    await expect(dummyVerifyPassword("x")).rejects.toBeInstanceOf(PasswordHashBusyError);
    await expect(hashPassword("yeni-parola-1")).rejects.toBeInstanceOf(PasswordHashBusyError);
    await holder;
    expect(__passwordHashSlots()).toEqual({ inFlight: 0, queued: 0 });
  }, 30_000);

  it("varsayılan (env yok) meşru küçük yoğunluğu REDDETMEZ: 6 eşzamanlı istek sırayla tamamlanır", async () => {
    const all = await Promise.all(Array.from({ length: 6 }, () => verifyPassword("x", H12)));
    expect(all).toEqual([false, false, false, false, false, false]);
    expect(__passwordHashSlots()).toEqual({ inFlight: 0, queued: 0 });
  }, 60_000);
});
