/**
 * Sayfa numarası kelepçesi — `?sayfa=` çöp/negatif/taşkın gelirse güvenli aralığa
 * çeker. Tavan ŞART: aksi hâlde uydurma bir `?sayfa=99999999` devasa bir SQL
 * OFFSET'ine dönüşürdü.
 *
 * (Önce sent-history.ts içindeydi; İptaller ve Misafir Sohbetleri de aynı desene
 * geçince ortak yere alındı — tek tanım, tek davranış.)
 */
export function clampPage(raw: string | undefined, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, max));
}

/** Liste ekranlarının ortak sayfa derinliği tavanı (500 sayfa × 25 = 12.500 kayıt). */
export const MAX_LIST_PAGE = 500;
