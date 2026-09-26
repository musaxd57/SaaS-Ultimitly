import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import { signTrustedDeviceToken, verifyTrustedDeviceToken } from "@/lib/auth/trusted-device";

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-please-32-bytes-minimum"));
afterEach(() => vi.unstubAllEnvs());

const EPOCH = 1_700_000_000_000; // a fixed 2FA-enabled timestamp
/** Oturum epoch'u — şifre değişikliği/sıfırlaması bunu ARTIRIR. */
const SEPOCH = 3;

describe("trusted device token (fail-closed)", () => {
  it("verifies a token for the SAME user and SAME 2FA epoch", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH, SEPOCH)).toBe(true);
  });

  it("rejects a token issued for a DIFFERENT user", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-2", EPOCH, SEPOCH)).toBe(false);
  });

  it("rejects a token after the 2FA epoch changes (disable → re-enable)", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH + 1, SEPOCH)).toBe(false);
  });

  it("rejects a missing or garbage token (never skips 2FA on error)", async () => {
    expect(await verifyTrustedDeviceToken(undefined, "user-1", EPOCH, SEPOCH)).toBe(false);
    expect(await verifyTrustedDeviceToken("not-a-jwt", "user-1", EPOCH, SEPOCH)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-key-32b");
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH, SEPOCH)).toBe(false);
  });

  it("rejects a token signed with a NON-HS256 algorithm (alg pin — algorithm-confusion defense)", async () => {
    // Forge a token valid in EVERY way except the algorithm: same secret, same
    // claims (user + purpose + epoch), but HS512. Without algorithms:["HS256"]
    // in verify, jose would honour the header's alg and accept it.
    const secret = new TextEncoder().encode("test-secret-please-32-bytes-minimum");
    const forged = await new SignJWT({ userId: "user-1", purpose: "trusted_device", epoch: EPOCH, sEpoch: SEPOCH })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret);
    expect(await verifyTrustedDeviceToken(forged, "user-1", EPOCH, SEPOCH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 🚨 ŞİFRE SIFIRLAMA/DEĞİŞTİRME "BENİ HATIRLA"YI DA İPTAL EDER (S2, 08-09).
//
// Token yalnız `(userId, purpose, 2FA-epoch)` üçlüsüne bağlıydı; `sessionEpoch`
// GİRDİ DEĞİLDİ. Sonuç ölçülmüştü: kurban şüphelenip ürünün söylediği tek şeyi
// yapıyor (şifre sıfırlama), TÜM oturumlar ölüyor ama 2FA-ATLAMA kimlik bilgisi
// ÖLMÜYOR. Saldırgan sonra yeni şifreyi ele geçirirse 2FA normalde durdururdu;
// çerez onu atlatıyor VE `login` o girişe `mfa: true` damgalıyor.
//
// ⚠️ MIGRATION YOK: `User.sessionEpoch` kolonu zaten var, `login` satırı zaten
// `select`siz çekiyor (yani değer bellekte) ve sıfırlama epoch'u ZATEN artırıyor.
// Token bir JWT — payload'ına alan eklemek şema değişikliği değildir.
// ⚠️ 2FA-epoch bağlaması KALDIRILMADI; ikisi BİRDEN tutuluyor (yalnız sıkılaştırır).
// ---------------------------------------------------------------------------
describe("trusted device — oturum epoch'una da bağlı", () => {
  it("İKİ epoch da AYNIYKEN kabul edilir", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH, SEPOCH)).toBe(true);
  });

  it("şifre sıfırlama/değiştirme sonrası (sessionEpoch ARTTI) REDDEDİLİR", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH, SEPOCH + 1)).toBe(false);
  });

  it("2FA epoch'u değişince de REDDEDİLİR (eski bağ korunuyor)", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH + 1, SEPOCH)).toBe(false);
  });

  it("İKİSİ BİRDEN değişince REDDEDİLİR", async () => {
    const token = await signTrustedDeviceToken("user-1", EPOCH, SEPOCH);
    expect(await verifyTrustedDeviceToken(token, "user-1", EPOCH + 1, SEPOCH + 1)).toBe(false);
  });

  it("LEGACY token (sEpoch alanı YOK) fail-closed REDDEDİLİR", async () => {
    // Deploy anında uçuşta olan çerezler bu şekildedir. Kabul etmek, korumayı
    // 30 gün boyunca fiilen kapatırdı → bilinçli olarak reddediliyor; bedeli
    // kullanıcının BİR KEZ 6 hane girmesi.
    const secret = new TextEncoder().encode("test-secret-please-32-bytes-minimum");
    const legacy = await new SignJWT({ userId: "user-1", purpose: "trusted_device", epoch: EPOCH })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret);
    expect(await verifyTrustedDeviceToken(legacy, "user-1", EPOCH, SEPOCH)).toBe(false);
  });

  it("sEpoch STRING olarak gelirse de REDDEDİLİR (tip karışıklığı)", async () => {
    const secret = new TextEncoder().encode("test-secret-please-32-bytes-minimum");
    const forged = await new SignJWT({
      userId: "user-1",
      purpose: "trusted_device",
      epoch: EPOCH,
      sEpoch: String(SEPOCH),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret);
    expect(await verifyTrustedDeviceToken(forged, "user-1", EPOCH, SEPOCH)).toBe(false);
  });
});
