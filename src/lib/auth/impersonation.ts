// ---------------------------------------------------------------------------
// OPERATÖR BÜRÜNMESİ = SALT-OKUNUR DESTEK GÖRÜNÜMÜ (kurucu kararı K8, 09-28).
//
// Lixus destek operatörü bir müşterinin hesabına girdiğinde (impersonation) YALNIZ GÖRÜR: müşteri hesabında hiçbir yazma
// yapılamaz — misafire mesaj, bilgi tabanı, ayarlar, ödeme / abonelik dahil (Mesafeli Satış onayı müşterinin adına yazılıyordu).
// Tüm misafir verisini dışa aktarma ve kanal bağlama da kapalı (GET olsalar da). Bürünme EN ÇOK 2 SAAT sürer; başlangıç
// damgası (`impersonatedAt`) olmayan eski bürünme belirteci süresi dolmuş sayılır (fail-closed). Airbnb güvenlik incelemesinin
// "en az yetki" şartı. YAPRAK modül (middleware Edge'de çalışır, veritabanı istemcisini içe aktaramaz).
// ---------------------------------------------------------------------------

/** Bürünmenin en uzun süresi. */
export const IMPERSONATION_MAX_MS = 2 * 60 * 60 * 1000;

/** Bürünmüşken yazma denendiğinde dönen sade ileti. */
export const IMPERSONATION_READ_ONLY_MESSAGE =
  "Destek görünümü salt okunur — müşteri hesabında değişiklik yapılamaz.";

/** Oturum bir bürünme mi (gerçek operatör imzalı `actorUserId` alanında). */
export function isImpersonating(session: { actorUserId?: string } | null | undefined): boolean {
  return Boolean(session?.actorUserId);
}

/**
 * Bürünmenin süresi doldu mu. Bürünme değilse `false`. Başlangıç damgası (saniye) yoksa DOLMUŞ sayılır: bu sürümden önce
 * basılmış bürünme belirteci yeniden giriş ister.
 */
export function impersonationExpired(
  session: { actorUserId?: string; impersonatedAt?: number } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!session?.actorUserId) return false;
  if (typeof session.impersonatedAt !== "number" || !Number.isFinite(session.impersonatedAt)) return true;
  return now - session.impersonatedAt * 1000 > IMPERSONATION_MAX_MS;
}

/** Salt okuma yöntemi mi (GET / HEAD / OPTIONS). */
export function isReadOnlyMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}
