import { SignJWT, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// "Bu cihazı 30 gün hatırla" — after a successful 2FA login, an opt-in trusted-
// device cookie lets THIS browser skip the 6-digit code on future fresh logins.
// The password is ALWAYS still required. FAIL-CLOSED by design: a missing /
// invalid / tampered / wrong-user token verifies as false, so a bug can only
// ever ASK for 2FA again — it can never wrongly skip it or lock anyone out.
//
// Edge-safe (jose only); the cookie read/write helpers live in @/lib/auth.
// ---------------------------------------------------------------------------

export const TRUSTED_DEVICE_COOKIE = "guestops_trusted_device";
export const TRUSTED_DEVICE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (seconds)
const PURPOSE = "trusted_device";

// The token is bound to a 2FA "epoch" (the user's twoFactorEnabledAt time). When
// 2FA is disabled and re-enabled — e.g. after a suspected compromise — the epoch
// changes and every previously-issued trusted cookie stops matching, forcing the
// new 2FA. So "remember 30 days" never outlives a deliberate 2FA reset.

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in .env (min 16 chars).");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Sign a trusted-device token bound to a user + their 2FA epoch + their SESSION epoch.
 *
 * 🚨 `sEpoch` NEDEN VAR (S2, 08-09): token yalnız `(userId, purpose, 2FA-epoch)`
 * üçlüsüne bağlıydı ve `sessionEpoch` GİRDİ DEĞİLDİ. Ölçüldü: kurban şüphelenip
 * ürünün söylediği tek şeyi yapıyor — şifre sıfırlama — TÜM oturumlar ölüyor ama
 * 2FA-ATLAMA kimlik bilgisi 30 gün daha YAŞIYOR. Saldırgan sonradan yeni şifreyi
 * ele geçirirse 2FA normalde durdururdu; bu çerez onu atlatıyor ve üstüne
 * `login` o girişe `mfa: true` damgalıyor (operatör yetkisinin TEK kapısı).
 *
 * ⚠️ MIGRATION GEREKMEZ: `User.sessionEpoch` kolonu ZATEN var, `login/route.ts`
 * kullanıcı satırını `select`SİZ çekiyor (değer zaten bellekte, ek sorgu YOK) ve
 * şifre sıfırlama/değiştirme epoch'u ZATEN artırıyor. Token bir JWT'dir —
 * payload'ına alan eklemek şema değişikliği değildir.
 * ⚠️ 2FA-epoch bağlaması KALDIRILMADI: ikisi BİRDEN tutuluyor, yalnız sıkılaştırır.
 */
export async function signTrustedDeviceToken(
  userId: string,
  epoch: number,
  sEpoch: number,
): Promise<string> {
  return new SignJWT({ userId, purpose: PURPOSE, epoch, sEpoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TRUSTED_DEVICE_MAX_AGE}s`)
    .sign(getSecretKey());
}

/**
 * True only if valid, unexpired, our purpose, for THIS user AND this 2FA epoch
 * AND this session epoch.
 */
export async function verifyTrustedDeviceToken(
  token: string | undefined,
  userId: string,
  epoch: number,
  sEpoch: number,
): Promise<boolean> {
  if (!token) return false;
  try {
    // Pin the algorithm (matches session.ts): without an allowlist, jose would
    // accept ANY alg the token header declares. Our tokens are always HS256, so
    // reject anything else — defense-in-depth against algorithm-confusion. (Even
    // if bypassed this only skips the 2FA prompt; the password is still required.)
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    return (
      payload.purpose === PURPOSE &&
      payload.userId === userId &&
      payload.epoch === epoch &&
      // 🚨 TİP KONTROLÜ ŞART, `=== sEpoch` TEK BAŞINA YETMEZ. Deploy anında
      // uçuşta olan LEGACY çerezlerde bu alan YOK (`undefined`) ve `"3" === 3`
      // de false'tur — ama niyeti açıkça yazmak, birinin ileride `==`e ya da
      // gevşek bir karşılaştırmaya çevirmesini engelliyor.
      // ⚠️ Legacy token'ı KABUL ETMEK, korumayı 30 gün boyunca fiilen kapatırdı.
      // Fail-closed seçildi; bedeli kullanıcının BİR KEZ 6 hane girmesi.
      typeof payload.sEpoch === "number" &&
      payload.sEpoch === sEpoch
    );
  } catch {
    return false; // fail-closed
  }
}
