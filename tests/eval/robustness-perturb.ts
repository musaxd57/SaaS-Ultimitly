/**
 * Sağlamlık bozulmaları — KODLA, tekrarlanabilir (kurucu 10-29 gece, K-1029-F). Aynı temel mesajın bozuk eşleri: noktalama yok (P1),
 * BÜYÜK / küçük harf (P3), aksan / Türkçe karakter yok (P4), yazım hatası (P5: içerik sözcüklerinin ~%15'inde tek düzenleme — komşu iki
 * harf yer değiştirir ya da bir harf düşer; ilk harf ve sayılar korunur), hepsi birden (P11). Anlamı DEĞİŞTİRMEZ; anlamı değiştiren
 * kontrol (P10) ve dil / argo / sesle yazdırma bozulmaları (P2, P6–P9) insan / model yazımı ister — bu dosyada yok.
 */

export type Perturbation = "P1" | "P3u" | "P3l" | "P4" | "P5" | "P11";
export const PERTURBATIONS: readonly Perturbation[] = ["P1", "P3u", "P3l", "P4", "P5", "P11"];

/** P1 — cümle noktalaması yok (kesme işareti sözcük içinde kalır: "J'ai", "What's"). */
export function stripPunctuation(s: string): string {
  return s
    .replace(/[.,!?;:¿¡…،؟"«»()]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TR_UPPER: Record<string, string> = { i: "İ", ı: "I" };
const TR_LOWER: Record<string, string> = { İ: "i", I: "ı" };
/** P3 — BÜYÜK harf (Türkçede i → İ, ı → I). */
export function upper(s: string, lang: string): string {
  return lang === "tr" ? [...s].map((c) => TR_UPPER[c] ?? c.toUpperCase()).join("") : s.toUpperCase();
}
/** P3 — küçük harf (Türkçede I → ı, İ → i). */
export function lower(s: string, lang: string): string {
  return lang === "tr" ? [...s].map((c) => TR_LOWER[c] ?? c.toLowerCase()).join("") : s.toLowerCase();
}

const ASCII_MAP: Record<string, string> = { ı: "i", İ: "I", ş: "s", Ş: "S", ğ: "g", Ğ: "G", ç: "c", Ç: "C", ö: "o", Ö: "O", ü: "u", Ü: "U", ß: "ss" };
/** P4 — aksan / Türkçe karakter yok (Arapça hemze sadeleşir: أ إ آ → ا). Kiril dokunulmaz (ё → е). */
export function stripDiacritics(s: string): string {
  return [...s]
    .map((c) => ASCII_MAP[c] ?? c)
    .join("")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ё/gu, "е")
    .normalize("NFC");
}

/** Tohumlu sözde rastgele (mulberry32) — her koşu aynı bozulmayı üretir. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

/** P5 — yazım hatası: 4+ harfli sözcüklerin ~%15'inde (en az bir) tek düzenleme. İlk harf ve rakamlar korunur. */
export function typos(s: string): string {
  const r = rng(seedOf(s));
  const parts = s.split(/(\s+)/);
  const candidates = parts.map((w, i) => ({ w, i })).filter(({ w }) => /^\p{L}{4,}/u.test(w) && !/\d/.test(w));
  if (candidates.length === 0) return s;
  const n = Math.max(1, Math.round(candidates.length * 0.15));
  const picked = new Set<number>();
  while (picked.size < Math.min(n, candidates.length)) picked.add(candidates[Math.floor(r() * candidates.length)].i);
  for (const i of picked) {
    const chars = [...parts[i]];
    const letters = chars.findIndex((c, k) => k > 0 && !/\p{L}/u.test(c));
    const end = letters === -1 ? chars.length : letters;
    if (end < 4) continue;
    const pos = 1 + Math.floor(r() * (end - 2));
    if (r() < 0.5) [chars[pos], chars[pos + 1]] = [chars[pos + 1], chars[pos]];
    else chars.splice(pos, 1);
    parts[i] = chars.join("");
  }
  return parts.join("");
}

/** Bir temel mesajın bozulmuş eşi. */
export function perturb(message: string, lang: string, p: Perturbation): string {
  switch (p) {
    case "P1":
      return stripPunctuation(message);
    case "P3u":
      return upper(message, lang);
    case "P3l":
      return lower(message, lang);
    case "P4":
      return stripDiacritics(message);
    case "P5":
      return typos(message);
    case "P11":
      return lower(typos(stripDiacritics(stripPunctuation(message))), lang);
  }
}
