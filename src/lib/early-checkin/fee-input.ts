// ---------------------------------------------------------------------------
// ERKEN GİRİŞ ÜCRETİ — HOST'UN YAZDIĞI TUTARI OKUMA (saf; form bileşeni kullanır). İnceleme 09-24: sayı alanı "1.500"ü
// 1,5 sayıyordu (Türkçede nokta binlik ayırıcıdır) → misafire "₺1,50" gidebilirdi; tarayıcının okuyamadığı giriş ise
// sessizce boş kalıp ücret düşüyordu. Kural: ondalık en fazla 2 hane; NOKTA ardından TAM 3 hane = binlik ayırıcı
// ("1.500", "12.500,50"); virgül ondalıktır ("12,50"); nokta ardından 1-2 hane de ondalık kabul edilir ("12.5").
// Belirsiz ya da bozuk yazım → "invalid" (form hata gösterir, sessizce düşürmez). Boş → null (ücret yok).
// ---------------------------------------------------------------------------

export function parseFeeInput(raw: string): number | null | "invalid" {
  const t = raw.replace(/\s+/g, "").replace(/[₺€$£]/g, "");
  if (t === "") return null;
  let normalized: string | null = null;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(t)) normalized = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(?:,\d{1,2})?$/.test(t)) normalized = t.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(t)) normalized = t;
  if (normalized === null) return "invalid";
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : "invalid";
}
