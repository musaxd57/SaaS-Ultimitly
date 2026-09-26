// ---------------------------------------------------------------------------
// PARA SÖZLÜĞÜ — TEK KAYNAK (09-24, dilim 8). İki tüketici aynı para birimi kelime dağarcığını ve tutar
// çözümlemesini kullanır; ikinci bir para ayrıştırıcısı yazılmaz:
//  · `ai/claim-support.ts` — iddia desteği GÖLGE ölçümü (karar değil; kapılar onu içe aktarmaz, mekanik pin).
//  · `ai/stay-money.ts` — hassas konaklama isteğinde erteleyen cevabın para kapısı (host'un tutarıyla parite).
// Kalıplar katlanmış (küçük harf, Türkçe harfler ASCII) metin içindir. Saf; bağımlılık yok.
// ---------------------------------------------------------------------------

/** Tutardan SONRA gelen para birimi (kod, sembol, ad): "500 tl", "30 euros", "40 $". */
export const CURRENCY_AFTER = "(?:tl|try|₺|lira|eur|euros?|avro|€|\\$|usd|dolar|dollars?|£|gbp|sterlin|pounds?)";
/** Tutardan ÖNCE gelen para birimi: "₺500", "€30", "eur 30". */
export const CURRENCY_BEFORE = "(?:₺|\\$|€|£|tl|eur|usd|try)";
/** Tutar: binlik ayraçlı ("1.500", "1,250.00") ya da düz ("30", "29,90"). */
export const NUM = "(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";

/** "1.500" → 1500 · "29,90" → 29.9 · "1,250.50" → 1250.5. */
export function parseAmount(raw: string): number {
  const r = raw.replace(/\s/g, "");
  const grouped = /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(r);
  if (grouped) return Number(grouped[1].replace(/[.,]/g, "")) + (grouped[2] ? Number(`0.${grouped[2]}`) : 0);
  return Number(r.replace(",", "."));
}

/** Para birimi belirteci → ISO kodu (tanınmayan "X": hiçbir tutarla eşleşmez). */
export function currencyCode(c: string): string {
  if (/^(tl|try|₺|lira)/.test(c)) return "TRY";
  if (/^(eur|euro|avro|€)/.test(c)) return "EUR";
  if (/^(\$|usd|dolar|dollar)/.test(c)) return "USD";
  if (/^(£|gbp|sterlin|pound)/.test(c)) return "GBP";
  return "X";
}

/** Bir tutar: değer + ISO para birimi kodu. Kod bilinmiyorsa `null` — hiçbir tutarla EŞLEŞMEZ (temkinli yön). */
export interface MoneyAmount {
  amount: number;
  currency: string | null;
}

/** Aynı tutar mı: para birimi bilinmeli ve eşit olmalı; kuruş yuvarlaması tolere edilir. */
export function sameMoney(a: MoneyAmount, b: MoneyAmount): boolean {
  return a.currency !== null && a.currency === b.currency && Math.abs(a.amount - b.amount) < 0.005;
}

/** Model çıktısındaki para birimi → ISO kodu: üç harfli kod aynen, bilinen ad çevrilir, başka her şey `null`. */
export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  const code = currencyCode(t.toLowerCase());
  return code === "X" ? null : code;
}
