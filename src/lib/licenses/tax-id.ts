// ---------------------------------------------------------------------------
// VERGİ NUMARASI (Faz 1a). SAF. Şirket: 10 haneli VKN (yalnız biçim — sağlama algoritması burada uygulanmaz; yanlış bir sağlama gerçek
// başvuruyu reddederdi, kesin denetim operatörün vergi levhası kontrolündedir). Şahıs işletmesi: gerçek kişinin vergi kimlik numarası
// TC kimlik numarasıdır (11 hane, resmî sağlama kuralı) — YALNIZ o kabul edilir (Opus 11-06 P1-2): eski 10 haneli VKN de kabul edilseydi
// aynı kişi iki farklı kimlikle iki hesapta doğrulanabilirdi (hak sahibi bekçisi tek kimliğe dayanır).
// 🚨 TCKN hiçbir biçimde geri okunabilir saklanmaz (yalnız anahtarlı özet + son iki hane) — tasarım §3.3.
// ---------------------------------------------------------------------------

import type { HolderKind } from "./catalog";

/** 11 haneli TC kimlik numarası resmî sağlama kuralı. */
export function isValidTckn(d: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(d)) return false;
  const n = Array.from(d, (c) => c.charCodeAt(0) - 48);
  const odd = n[0] + n[2] + n[4] + n[6] + n[8];
  const even = n[1] + n[3] + n[5] + n[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== n[9]) return false;
  const d11 = n.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d11 === n[10];
}

export type ParsedTaxId = { digits: string; form: "vkn" | "tckn" };

/** Yalnız rakam + (boşluk / tire / nokta) ayracı kabul edilir; harf ya da başka karakter → geçersiz. */
export function parseTaxId(kind: HolderKind, raw: unknown): ParsedTaxId | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 40 || !/^[0-9 .-]+$/.test(s)) return null;
  const digits = s.replace(/[ .-]/g, "");
  if (kind === "company") return /^[0-9]{10}$/.test(digits) ? { digits, form: "vkn" } : null;
  return isValidTckn(digits) ? { digits, form: "tckn" } : null;
}

export const taxIdLast2 = (digits: string) => digits.slice(-2);

/** Ekranda maskeli gösterim: "••••••••12". */
export function maskTaxId(last2: string): string {
  return `••••••••${last2}`;
}
