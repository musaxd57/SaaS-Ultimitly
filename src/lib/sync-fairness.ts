// ---------------------------------------------------------------------------
// ZAMANLANMIŞ SENKRON ADALETİ — saf yardımcı (F17, Codex 09-05).
//
// Geçiş seri ve 12 dakikalık bütçelidir; bütçe bitince sıradaki org'lar ATLANIR. Org listesi sırasız çekiliyordu
// (pratikte veritabanının sabit fiziksel sırası) → her geçişte AYNI son org'lar atlanıyor, kalıcı olarak aç kalıyordu.
// Kural: taban sıra kimliğe göre SABİT; bir geçiş bütçe yüzünden org atlarsa İLK atlananın kimliği imleç olarak
// saklanır ve sonraki geçiş ORADAN başlar (listenin başına döner). Böylece hiçbir org iki geçişten fazla üst üste
// atlanmaz, en kötü bekleme ≈ (org sayısı / geçiş başına işlenebilen) geçiştir. İmleç yoksa baştan başlanır.
// ---------------------------------------------------------------------------

/**
 * `items` kimliğe göre ARTAN sırada gelir. `startId`e eşit ya da ondan büyük ilk kimlikten başlayarak döndürür
 * (imleçteki org silinmiş / boşta kalmış olabilir → bir sonrakinden başlanır); hepsi küçükse ya da imleç yoksa
 * sıra aynen döner. Girdiyi değiştirmez.
 */
export function rotateFrom<T extends { id: string }>(items: readonly T[], startId: string | null): T[] {
  if (!startId || items.length === 0) return [...items];
  const i = items.findIndex((x) => x.id >= startId);
  if (i <= 0) return [...items];
  return [...items.slice(i), ...items.slice(0, i)];
}
