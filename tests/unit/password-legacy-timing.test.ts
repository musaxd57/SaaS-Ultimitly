import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPasswordForLogin, dummyVerifyPassword, __loginFailureFloorMs } from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// ESKİ HASH ZAMANLAMA KÂHİNİ (09-23 saldırgan turu, istemci ajanı ölçtü).
//
// Bilinmeyen e-posta maliyet-12 SAHTE hash'e karşı doğrulanır (~315 ms); gerçek hesap
// KENDİ hash'ine karşı. 05-31 → 06-09 arasında belirlenen parolalar maliyet-10 (~80 ms)
// → yanlış parolayla TEK istek "bu e-posta kayıtlı ve erken dönem hesabı" diye okunuyordu
// (4 kat fark; kurucu dahil ilk hesaplar). Girişte yükseltme (④) yalnız GİRİŞ YAPAN hesabı
// kapatır, uyuyan hesap açık kalırdı. Düzeltme: maliyeti düşük hash'te BAŞARISIZ doğrulama,
// gözlenen maliyet-12 karşılaştırma süresine kadar BEKLETİLİR (işlemci harcamadan). Başarılı
// giriş bekletilmez (sahibin girişi yavaşlamaz; başarı zaten yanıttan belli).
// ---------------------------------------------------------------------------

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

describe("maliyeti düşük hash'te başarısız giriş süresi", () => {
  it("yanlış parola, maliyet-10 hash: süre sahte (bilinmeyen hesap) yolunun altına DÜŞMEZ", async () => {
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    await dummyVerifyPassword("isinma"); // kalibrasyon (sunucuda ilk bilinmeyen-hesap denemesi bunu yapar)
    const dummy = await timed(() => dummyVerifyPassword("yanlis-parola"));
    const legacyFail = await timed(() => verifyPasswordForLogin("yanlis-parola", h10));
    // Eski kod: ~0.25 oran (80 ms / 315 ms). Bekletme ile ~1.
    expect(legacyFail / dummy).toBeGreaterThan(0.7);
    // Bekletme gözlenen maliyet-12 süresine kadar: taban ölçülen sahte süreyle uyumlu.
    expect(legacyFail).toBeGreaterThanOrEqual(__loginFailureFloorMs("yanlis-parola") * 0.95);
  });

  it("KONTROL: DOĞRU parola bekletilmez (sahibin girişi yavaşlamaz)", async () => {
    const h10 = await bcrypt.hash("dogru-parola-1", 10);
    await dummyVerifyPassword("isinma");
    const dummy = await timed(() => dummyVerifyPassword("yanlis-parola"));
    const legacyOk = await timed(() => verifyPasswordForLogin("dogru-parola-1", h10));
    expect(legacyOk / dummy).toBeLessThan(0.7);
  });

  it("KONTROL: güncel (maliyet-12) hash'te başarısız doğrulamaya EK bekleme eklenmez", async () => {
    const h12 = await bcrypt.hash("dogru-parola-1", 12);
    await dummyVerifyPassword("isinma");
    const dummy = await timed(() => dummyVerifyPassword("yanlis-parola"));
    const fail12 = await timed(() => verifyPasswordForLogin("yanlis-parola", h12));
    // Aynı maliyet: fazladan bekleme olsaydı ~2 kat olurdu.
    expect(fail12 / dummy).toBeLessThan(1.6);
  });
});
