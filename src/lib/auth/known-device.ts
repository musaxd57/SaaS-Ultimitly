import { SignJWT, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// TANINAN CİHAZ — kaba kuvvet ile hesap kilitleme arasındaki çelişkinin çözümü
// (09-23 güvenlik denetimi, login ajanı F1; OWASP "device cookies" deseni).
//
// 🚨 ÖLÇÜLEN AÇIK: hesap kovası (`login-acct:{email}`, 20/15 dk) yalnız BAŞARISIZ
// denemeleri sayıyor ve dolunca yalnız YANLIŞ parolaya 429 veriyordu; DOĞRU parola
// her IP'den her zaman giriyordu (08-01 kararı: "kova kilit silahı olmasın"). Sonuç:
// IP döndüren saldırgan için tek fren sunucunun bcrypt hızıydı (~3/sn ≈ günde
// ~270 bin tahmin, TEK hesaba) — 2FA'sız hesap doğrudan ele geçer, 2FA'lı hesabın
// parolası sızar. Ajanın modeli: doğru parola 4.322. denemede KABUL edildi.
//
// ÇÖZÜM: kova doluyken parola denemesine yalnız o hesaba daha önce BAŞARIYLA
// girmiş TARAYICI devam edebilir. Hesap sahibi kendi cihazında KİLİTLENMEZ (08-01
// kararının özü korunur); yeni IP'den gelen saldırgan bcrypt'e bile ulaşamaz (CPU
// DoS'u da hafifler). Bedeli: saldırı sürerken sahibin YENİ bir cihazdan girişi
// pencere (≤15 dk) dolana kadar bekler.
//
// Token: `sessionEpoch`e bağlı — şifre değişimi/sıfırlama tüm tanınan cihazları
// düşürür (trusted-device S2 emsali). FAIL-CLOSED: bozuk/eksik/başka kullanıcının
// token'ı "tanınmıyor" demektir; bu yalnız kova DOLUYKEN önem taşır.
// Edge-safe (yalnız jose); çerez OKUMA login rotasında istekten yapılır.
// ---------------------------------------------------------------------------

export const KNOWN_DEVICE_COOKIE = "guestops_known_device";
export const KNOWN_DEVICE_MAX_AGE = 60 * 60 * 24 * 180; // 180 gün (saniye)
/** Çerez yalnız kimlik rotalarına gider — uygulamanın geri kalanına taşınmaz. */
export const KNOWN_DEVICE_PATH = "/api/auth";
const PURPOSE = "known_device";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in .env (min 16 chars).");
  }
  return new TextEncoder().encode(secret);
}

export async function signKnownDeviceToken(userId: string, sEpoch: number): Promise<string> {
  return new SignJWT({ userId, purpose: PURPOSE, sEpoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${KNOWN_DEVICE_MAX_AGE}s`)
    .sign(getSecretKey());
}

/** Yalnız geçerli, süresi dolmamış, BU amaç + BU kullanıcı + BU oturum epoch'u için true. */
export async function verifyKnownDeviceToken(
  token: string | undefined,
  userId: string,
  sEpoch: number,
): Promise<boolean> {
  if (!token) return false;
  try {
    // Algoritma sabitlenir (session.ts/trusted-device.ts ile aynı): başlıktaki alg'a güvenilmez.
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    return (
      payload.purpose === PURPOSE &&
      payload.userId === userId &&
      typeof payload.sEpoch === "number" &&
      payload.sEpoch === sEpoch
    );
  } catch {
    return false; // fail-closed
  }
}
