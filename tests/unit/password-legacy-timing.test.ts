import { describe, it, expect, vi, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPasswordForLogin, dummyVerifyPassword } from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// ESKİ HASH ZAMANLAMA KÂHİNİ (09-23 saldırgan turu, istemci ajanı ölçtü).
//
// Bilinmeyen e-posta maliyet-12 SAHTE hash'e karşı doğrulanır (~315 ms); gerçek hesap
// KENDİ hash'ine karşı. 05-31 → 06-09 arasında belirlenen parolalar maliyet-10 (~80 ms)
// → yanlış parolayla TEK istek "bu e-posta kayıtlı ve erken dönem hesabı" diye okunuyordu
// (4 kat fark; kurucu dahil ilk hesaplar). Girişte yükseltme (④) yalnız GİRİŞ YAPAN hesabı
// kapatır, uyuyan hesap açık kalırdı.
//
// Düzeltme İŞ EŞİTLİĞİ: başarısız doğrulama, AYNI YUVANIN içinde, sahte yolun bcrypt işine
// (2^12 tur) tamamlanır. İlk sürüm yuvayı bırakıp gözlenen ortalamaya kadar UYUYORDU; inceleme
// ajanı iki sızıntı buldu (eşzamanlı isteklerde bitiş sırası farkı + saldırganın yükle
// kaydırabildiği ortalama). Bu dosya artık süreye değil İŞE ve SIRAYA bakar (kesin, titremesiz);
// süre testi yalnız gerçek dünya teyidi olarak kalır.
// ---------------------------------------------------------------------------

/** Bir çağrı boyunca yapılan bcrypt karşılaştırmalarının hash'leri. */
async function comparesDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const spy = vi.spyOn(bcrypt, "compare");
  try {
    await fn();
    return spy.mock.calls.map((c) => String(c[1]));
  } finally {
    spy.mockRestore();
  }
}

/** Toplam bcrypt işi, maliyet-12 karşılaştırma birimiyle (2^r / 2^12). */
const work = (hashes: string[]) => hashes.reduce((sum, h) => sum + 2 ** bcrypt.getRounds(h), 0) / 2 ** 12;

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("maliyeti düşük hash'te başarısız giriş — iş eşitliği", () => {
  it("maliyet-10 hash, yanlış parola: toplam iş sahte yolla BİREBİR aynı (1 maliyet-12 birimi)", async () => {
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    const legacy = await comparesDuring(() => verifyPasswordForLogin("yanlis-parola", h10));
    const dummy = await comparesDuring(() => dummyVerifyPassword("yanlis-parola"));
    expect(work(dummy)).toBe(1);
    expect(work(legacy)).toBe(1);
  });

  it("NFC olmayan girdide (iki karşılaştırma) iş yine eşit: 2 birim ↔ 2 birim", async () => {
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    const nfd = "şifre-yanlis"; // "ş" ayrık yazım → NFC'den farklı
    const legacy = await comparesDuring(() => verifyPasswordForLogin(nfd, h10));
    const dummy = await comparesDuring(() => dummyVerifyPassword(nfd));
    expect(work(dummy)).toBe(2);
    expect(work(legacy)).toBe(2);
  });

  it("maliyet-11 hash de tamamlanır (yalnız eksik iş eklenir)", async () => {
    const h11 = await bcrypt.hash("dogru-parola-1", 11);
    const legacy = await comparesDuring(() => verifyPasswordForLogin("yanlis-parola", h11));
    expect(work(legacy)).toBe(1);
  });

  it("🚨 dolgu AYNI YUVADA ve kesintisiz: tek yuvalı kapıda sıradaki istek araya GİREMEZ", async () => {
    // Eski sürüm yuvayı gerçek karşılaştırmadan sonra bırakıp dışarıda uyuyordu → sıradaki
    // istek hemen başlıyor, eşzamanlı isteklerin bitiş sırası hesabı ele veriyordu.
    vi.stubEnv("PASSWORD_HASH_MAX_IN_FLIGHT", "1");
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    const order = await comparesDuring(() =>
      Promise.all([verifyPasswordForLogin("yanlis-parola", h10), dummyVerifyPassword("yanlis-parola")]),
    );
    const rounds = order.map((h) => bcrypt.getRounds(h));
    // Önce giriş isteğinin TÜM işi (gerçek 10 + dolgu 10 + 11), SONRA sahte yolun 12'si.
    expect(rounds).toEqual([10, 10, 11, 12]);
  });

  it("KONTROL: DOĞRU parola dolgulanmaz (sahibin girişi yavaşlamaz)", async () => {
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    const ok = await comparesDuring(() => verifyPasswordForLogin("dogru-parola-1", h10));
    expect(ok.map((h) => bcrypt.getRounds(h))).toEqual([10]);
  });

  it("KONTROL: güncel (maliyet-12) hash'te başarısız doğrulamaya EK iş eklenmez", async () => {
    const h12 = await bcrypt.hash("dogru-parola-1", 12);
    const fail12 = await comparesDuring(() => verifyPasswordForLogin("yanlis-parola", h12));
    expect(work(fail12)).toBe(1);
  });

  it("gerçek dünya teyidi (süre): maliyet-10 başarısız giriş sahte yol kadar sürer", async () => {
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    await dummyVerifyPassword("isinma");
    const dummy = await timed(() => dummyVerifyPassword("yanlis-parola"));
    const legacyFail = await timed(() => verifyPasswordForLogin("yanlis-parola", h10));
    // Eski kod ~0.25 (80 ms / 315 ms). Geniş bant: süre testi titrer, kesin iddia yukarıda.
    expect(legacyFail / dummy).toBeGreaterThan(0.7);
    expect(legacyFail / dummy).toBeLessThan(1.5);
  });
});
