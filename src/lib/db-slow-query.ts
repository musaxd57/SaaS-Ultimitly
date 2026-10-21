// Yavaş sorgu satırı (altyapı envanteri 10-21, madde 26): üretimde Prisma'nın sorgu olayından YALNIZ eşiği aşanlar tek satır yazılır.
// Sorgu metni Prisma'nın ürettiği parametreli SQL'dir (değerler `$1`… yer tutucusu, `params` ALANI YAZILMAZ) → misafir metni / kişisel
// veri satıra girmez. Uzun metin kırpılır. Eşik `DB_SLOW_QUERY_MS` (varsayılan 1000; "0" kapatır).

export const DEFAULT_SLOW_QUERY_MS = 1_000;
const MAX_SQL_CHARS = 200;

export function slowQueryThresholdMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DB_SLOW_QUERY_MS?.trim();
  if (!raw) return DEFAULT_SLOW_QUERY_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_SLOW_QUERY_MS;
}

/** Eşiği aşan sorgu için günlük satırı; aşmıyorsa (ya da eşik 0 = kapalı) null. `params` bilerek okunmaz. */
export function slowQueryLine(e: { query?: unknown; duration?: unknown }, thresholdMs: number): string | null {
  if (thresholdMs <= 0) return null;
  const duration = typeof e.duration === "number" ? e.duration : Number(e.duration);
  if (!Number.isFinite(duration) || duration < thresholdMs) return null;
  const sql = typeof e.query === "string" ? e.query.replace(/\s+/g, " ").trim() : "";
  const short = sql.length > MAX_SQL_CHARS ? `${sql.slice(0, MAX_SQL_CHARS)}…` : sql;
  return `[db] yavaş sorgu ${Math.round(duration)} ms: ${short}`;
}
