// ---------------------------------------------------------------------------
// KİMLİKSİZ SEL FRENİ — Paddle webhook'unun imza alarm dalı (gece-4 S2-06).
//
// Şekli doğru (`ts=…;h1=<64 hex>`) ama imzası tutmayan her istek `alertOnTransition` çağırıyordu: alarm zaten geçiş tabanlı (bir kez + 24
// saatte bir) olduğundan e-posta sınırlıydı, ama BASTIRILAN her çağrı yine iki veritabanı yazımı + bir günlük satırı demekti — kimliksiz bir
// saldırgan bunu dakikada binlerce kez yaptırabiliyordu. Fren: bir anahtarın alarmı BASTIRILDIYSA (durum zaten var) aynı süreçte 60 sn
// içinde yeniden yazılmaz. İlk bozulma hemen bildirilir; doğrulanmış bir olay freni sıfırlar (sonraki bozulma yine HEMEN bildirilir).
// Süreç belleği: her kopya kendi frenini tutar; başka kopyada temizlenen durum burada en çok 60 sn geç yeniden alarm olur.
// Rota dosyası yalnız bilinen rota alanlarını dışa aktarabildiği için ayrı (yaprak) modülde.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const suppressedAt = new Map<string, number>();

/** Bu anahtarın alarmı son 60 sn içinde bastırıldıysa yeniden yazma. */
export function skipBadSignatureAlert(key: string, now: number = Date.now()): boolean {
  const at = suppressedAt.get(key);
  return at !== undefined && now - at < WINDOW_MS;
}

/** `alertOnTransition` "suppressed" döndü: durum zaten var. */
export function noteBadSignatureSuppressed(key: string, now: number = Date.now()): void {
  suppressedAt.set(key, now);
}

/** Doğrulanmış olay (yapılandırma sağlam) ya da test: fren sıfırlanır. */
export function clearBadSignatureThrottle(): void {
  suppressedAt.clear();
}
