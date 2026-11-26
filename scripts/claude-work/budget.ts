// ---------------------------------------------------------------------------
// CLAUDE ÇALIŞMA PAKETİ — BÜTÇE KARARI (11-13, İE-12). YAPRAK modül: dosya / ağ okumaz, hiçbir şey içe aktarmaz (pin
// `tests/unit/claude-work-budget.test.ts`).
//
// İstek 4'te istem denetimi görev tavanını mercekler ve çürütme turunda tüketti; sondaki iki zorunlu adım (yeniden tasarım, kurucu raporu)
// için para kalmadı, rapor hiç üretilmedi. Kural: bir adım, kalan bütçe — hem görevde hem pakette — kendisinden SONRA gelecek zorunlu
// adımlar için ayrılan payı aşmıyorsa BAŞLAMAZ. Zorunlu adım payı 0 ile sorulur ve eski kuralla (`harcanan >= tavan` → dur) çalışır.
//
// Sınır: karar adım BAŞLAMADAN verilir; aynı anda koşan isteğe bağlı çağrılar (havuz) payı birlikte aşındırabilir. Pay bu taşmayı da
// karşılayacak büyüklükte seçilir (bkz. `run.ts` PROMPT_AUDIT_REPORT_RESERVE_DEFAULT_USD).
// ---------------------------------------------------------------------------

export interface BudgetCheck {
  /** Paketin şimdiye kadarki toplam harcaması ($). */
  spentTotal: number;
  /** Paket tavanı ($). */
  totalCap: number;
  /** Bu görevin şimdiye kadarki harcaması ($). */
  spentTask: number;
  /** Bu görevin tavanı ($). */
  taskCap: number;
  /** Bu adımdan SONRA gelecek zorunlu adımlar için ayrılan pay ($). Yoksa 0 (zorunlu adım). */
  reserveUsd?: number;
}

const isAmount = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/**
 * Adım bütçe yüzünden BAŞLAMAMALI mı? Kalan (tavan − harcanan) payı aşmıyorsa evet — görevde ya da pakette.
 * Bozuk girdi (NaN, sonsuz, negatif, sayı olmayan) → `true`: harcamayı bilemiyorsak yeni çağrı başlatmayız.
 */
export function stepBlockedByBudget(c: BudgetCheck): boolean {
  const reserve = c.reserveUsd === undefined ? 0 : c.reserveUsd;
  if (![c.spentTotal, c.totalCap, c.spentTask, c.taskCap, reserve].every(isAmount)) return true;
  return c.totalCap - c.spentTotal <= reserve || c.taskCap - c.spentTask <= reserve;
}

/** İstekteki pay değerini okur: yoksa varsayılan; bozuksa varsayılan + `invalid` (çağıran günlüğe yazar, sessiz değil). */
export function resolveReserveUsd(raw: unknown, fallback: number): { usd: number; invalid: boolean } {
  if (raw === undefined) return { usd: fallback, invalid: false };
  return isAmount(raw) ? { usd: raw, invalid: false } : { usd: fallback, invalid: true };
}
