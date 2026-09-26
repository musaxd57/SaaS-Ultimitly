import { SignJWT, jwtVerify, decodeJwt } from "jose";
import type { UserRole } from "@/lib/constants";

// Edge-safe session helpers (jose only). Used by both middleware and server.

export const SESSION_COOKIE = "guestops_session";

// ---------------------------------------------------------------------------
// ① `__Host-` ÖNEKİ (kurucu onayı 09-23). Tarayıcı `__Host-` adlı çerezi yalnız Secure +
// Path=/ + Domain'siz kabul eder → bir alt alan adı (ya da http üzerinden araya giren biri)
// bu adla çerez YAZAMAZ. Öneksiz ad buna açıktı: ele geçirilmiş/sarkan bir alt alan adı
// kurbanın tarayıcısına SALDIRGANIN oturumunu "fırlatıp" onu saldırganın hesabında
// çalıştırabilirdi (giriş-CSRF sınıfı).
// GEÇİŞ KİMSEYİ ÇIKIŞA ZORLAMAZ: okuma önce yeni adı, yoksa eski adı dener; middleware her
// sayfa görüntülemesinde yeni adla yazar ve eski çerezi siler. Eski ad yalnız aşağıdaki tarihe
// kadar okunur (aktif oturumlar zaten ≤14 günde yenilenir); sonra koruma TAMDIR — fırlatılan
// eski-adlı çerez işe yaramaz. Geliştirmede (http://localhost, Secure yok) `__Host-` hiç yazılmaz
// → orada eski ad CANLI addır, tarihten bağımsız ve YALNIZ o okunur.
//
// 🚨 GEÇİŞTE DE FIRLATMA KAPALI (09-23 inceleme turu): bu sürümden itibaren imzalanan her oturum
// `hv` iddiası taşır ve eski ad YALNIZ işaretsiz — yani yayından ÖNCE eski kodun imzaladığı —
// oturumu taşıyabilir. Yeni kod eski adla hiç yazmaz; `hv`li eski-adlı çerez, kendi oturumunu
// yeniden adlandırıp kurbanın tarayıcısına fırlatan birinin işidir ve middleware onu `__Host-`
// adıyla yeniden imzalayıp KALICILAŞTIRIRDI. Eski kodun imzaladıkları en geç 14 gün içinde
// kendiliğinden ölür → fırlatma penceresi yayından en geç 14 gün sonra tamamen kapanır.
// ---------------------------------------------------------------------------
export const SESSION_COOKIE_HOST = `__Host-${SESSION_COOKIE}`;
/** Bu andan sonra üretimde eski (öneksiz) ad OKUNMAZ. */
export const LEGACY_SESSION_COOKIE_READ_UNTIL = Date.UTC(2026, 9, 15); // 2026-10-15

const isProduction = () => process.env.NODE_ENV === "production";

/** Oturum çerezinin YAZILDIĞI ad. */
export function sessionCookieName(): string {
  return isProduction() ? SESSION_COOKIE_HOST : SESSION_COOKIE;
}

/** Bu sürümden itibaren imzalanan her oturumun taşıdığı iddia (↑ fırlatma kapısı). */
const HOST_ERA_CLAIM = "hv";

/** Token'ı bu sürümün kodu mu imzaladı? İmza burada DOĞRULANMAZ (çağıran doğrular): yalnız
 *  eski-ad süzgecidir ve iddiayı eklemek saldırgana hiçbir şey kazandırmaz. */
function signedByHostEraCode(token: string): boolean {
  try {
    return decodeJwt(token)[HOST_ERA_CLAIM] !== undefined;
  } catch {
    return true; // çözülemeyen token zaten doğrulanamaz — eski ad için kabul EDİLMEZ
  }
}

/** Oturum çerezini oku: yeni ad önce; geçişte yalnız eski kodun imzaladığı eski-adlı oturum. */
export function readSessionCookie(
  get: (name: string) => string | undefined,
  now: number = Date.now(),
): string | undefined {
  // Geliştirmede `__Host-` hiç YAZILMAZ; okunsaydı yerel bir `next start` denemesinden kalan
  // çerez geliştirme girişini ezerdi (giriş döngüsü ya da yanlış kullanıcı — inceleme turu).
  if (!isProduction()) return get(SESSION_COOKIE);
  const fresh = get(SESSION_COOKIE_HOST);
  if (fresh) return fresh;
  if (now >= LEGACY_SESSION_COOKIE_READ_UNTIL) return undefined;
  const legacy = get(SESSION_COOKIE);
  if (!legacy || signedByHostEraCode(legacy)) return undefined;
  return legacy;
}
// 14 days (seconds), sliding. Re-issued on every active request, so daily users
// never get logged out; only 14-day-idle sessions expire. Shorter than 30d to
// bound a stolen token's blast radius (a forgot-password reset rotates the
// password but does not yet invalidate live sessions — sessionEpoch is deferred).
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

export interface SessionPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
  name: string;
  // Session invalidation counter (see User.sessionEpoch). Signed into the JWT;
  // server-side auth compares it to the user's current DB value so a password
  // change/reset kills stolen tokens. Legacy tokens (no claim) verify as 0, which
  // matches the DB default 0 → nobody is logged out on the deploy that adds this.
  sessionEpoch: number;
  // Impersonation (operator panel): when a super-admin "enters" a customer org,
  // the session carries the customer's context above AND these actor fields —
  // the REAL operator behind it — so we can show a banner, keep super-admin
  // powers, and switch back. Signed into the JWT, so they cannot be forged.
  actorUserId?: string;
  actorEmail?: string;
  actorName?: string;
  // The real operator's OWN sessionEpoch, signed in while impersonating, so a
  // stolen impersonation token dies when the operator resets their password
  // (which bumps their epoch). Absent on legacy tokens → the actor-epoch check
  // is skipped for them (backward compatible; nobody is logged out on rollout).
  actorSessionEpoch?: number;
  /**
   * BU OTURUM İKİNCİ FAKTÖRDEN GEÇTİ Mİ (08-05).
   *
   * ⚠️ "Hesapta 2FA yapılandırılmış" ile AYNI ŞEY DEĞİL — kasten. Airbnb'nin
   * partner şartı personelin API'ye MFA ile ERİŞMESİNİ istiyor, hesabın MFA
   * yapılandırmış olmasını değil. Aradaki fark iki gerçek yolda ortaya çıkıyor:
   *   · kayıttan ÖNCE açılmış oturumlar — `middleware.ts` çerezi her istekte
   *     14 gün uzattığı için bunlar hiç yeniden doğrulanmıyor, yani DB'ye
   *     bakmak onları yakalayamaz;
   *   · `verify-email` GET'inin şifresiz bastığı oturum.
   * İkisi de "hesapta 2FA var" testinden geçer, bu iddiadan geçmez.
   *
   * Eski token'larda ALAN YOK → `undefined` → yetki düşer, yeniden giriş
   * gerekir. Bu bilinçli: bir kez yeniden giriş, sessizce muaf kalan oturumdan
   * iyidir. (`actorSessionEpoch` ile aynı additive desen.)
   */
  mfa?: boolean;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set it in .env (min 16 chars).",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload, [HOST_ERA_CLAIM]: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());
}

/**
 * 🚨 BURASI BİR BEYAZ LİSTE — `SessionPayload`'a alan eklemek YETMEZ.
 *
 * Doğrulama, JWT'yi alan alan YENİDEN KURUYOR. Listeye eklenmeyen bir claim
 * token'da yazılı olsa bile okunurken SESSİZCE DÜŞER, ve `middleware.ts` bu
 * çıktıyı yeniden imzaladığı için bir sonraki istekte çerezden de silinir.
 *
 * Bu tam olarak 08-05'te `mfa` ile yaşandı: `signSession` claim'i yazıyordu,
 * burası düşürüyordu → `isSuperAdmin` HERKESTE false döndü ve Operatör Paneli
 * canlıda kayboldu. Kapı testliydi ama TAŞIMA testli değildi.
 *
 * Artık `session-payload-roundtrip.test.ts` her alanın imzala→doğrula turundan
 * sağ çıktığını asserte ediyor; yeni bir alan buraya eklenmezse test kırmızı.
 */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    if (
      typeof payload.userId === "string" &&
      typeof payload.organizationId === "string" &&
      typeof payload.email === "string"
    ) {
      return {
        userId: payload.userId,
        organizationId: payload.organizationId,
        role: (payload.role as UserRole) ?? "staff",
        email: payload.email,
        name: (payload.name as string) ?? "",
        sessionEpoch: typeof payload.sessionEpoch === "number" ? payload.sessionEpoch : 0,
        ...(typeof payload.actorUserId === "string" ? { actorUserId: payload.actorUserId } : {}),
        ...(typeof payload.actorEmail === "string" ? { actorEmail: payload.actorEmail } : {}),
        ...(typeof payload.actorName === "string" ? { actorName: payload.actorName } : {}),
        ...(typeof payload.actorSessionEpoch === "number" ? { actorSessionEpoch: payload.actorSessionEpoch } : {}),
        ...(typeof payload.mfa === "boolean" ? { mfa: payload.mfa } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
