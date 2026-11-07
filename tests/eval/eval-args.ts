// ---------------------------------------------------------------------------
// ÖLÇÜM ARGÜMANLARI — sayı listesi ortamdan KATI okunur (U18, Codex 10-07).
//
// Eskiden bilinmeyen değer sessizce süzülüyordu: `EVAL_RERANK_SIZES=999` → boş liste → sıfır çağrı, sıfır satır, `0 === 0` → test
// YEŞİL ve rapor yok (ölçüm yapılmamışken "geçti" okunabilirdi). Kural: boş belirteç (sondaki virgül) yok sayılır; sayı olmayan, izin
// verilen kümede olmayan ya da alt sınırın altındaki HER belirteç koşuyu başlamadan düşürür; sonuç boşsa da düşürür.
// ---------------------------------------------------------------------------

export function parseSizeList(
  raw: string | undefined,
  opts: { name: string; fallback: readonly number[]; allowed?: readonly number[]; min?: number },
): number[] {
  const text = raw?.trim();
  if (!text) return [...opts.fallback];
  const out: number[] = [];
  for (const token of text.split(",").map((t) => t.trim())) {
    if (token === "") continue;
    const n = Number(token);
    const tooSmall = opts.min !== undefined && n < opts.min;
    if (!Number.isInteger(n) || tooSmall || (opts.allowed && !opts.allowed.includes(n))) {
      const allowed = opts.allowed ? ` (izinli: ${opts.allowed.join(", ")})` : opts.min !== undefined ? ` (en az ${opts.min})` : "";
      throw new Error(`${opts.name}: geçersiz değer "${token}"${allowed} — koşu başlamadı`);
    }
    out.push(n);
  }
  if (out.length === 0) throw new Error(`${opts.name}: boş liste — koşu başlamadı`);
  return out;
}

/** RAG ölçek setinde en az bu kadar kalem (üretici hedefi ~300). */
export const RAG_SET_MIN_ITEMS = 251;

/**
 * U19 (Codex 10-07): üretilen / var olan setin YALNIZ SAYI denetimi (holdout içeriği okunmaz, yazdırılmaz). `null` = geçerli.
 * Eskiden üretici yetersiz seti ÖNCE yazıp sonra doğruluyordu; sonraki koşu "dosya var" diye doğrulamayı atlıyordu.
 */
export function ragSetCountProblem(set: unknown): string | null {
  const s = (set ?? {}) as { items?: unknown; facts?: unknown };
  const items = Array.isArray(s.items) ? s.items.length : 0;
  const facts = Array.isArray(s.facts) ? s.facts.length : 0;
  if (items < RAG_SET_MIN_ITEMS) return `items=${items} (en az ${RAG_SET_MIN_ITEMS})`;
  if (facts === 0) return "facts=0";
  return null;
}
