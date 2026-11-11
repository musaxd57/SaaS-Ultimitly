import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// İÇE AKTARILAN KAYIT KİMLİĞİ — TEK BİÇİM (Tur 7 CAL-3, kurucu önceliği 11-05). Yaprak modül.
//
// Kimlik (iCal UID / CSV referansı) DOĞDUĞU yerde (ayrıştırıcılar) bir kez bu biçime getirilir; sonraki her kullanım (senkron / dosya
// yolu, silme (KVKK) kapısı, "beslemede görüldü" kümesi, bağlı satır araması) saklanan değerle aynıdır.
//
// 🚨 UZUN KİMLİK KESİLMEZ, ÖZETLENİR (takvim C1, Codex 11-10). Eskiden 200 karakterden uzun kimlik 200'e KESİLİYORDU: ilk 200 karakteri
// aynı olan iki FARKLI kimlik (bazı Exchange / Outlook beslemeleri: ortak uzun önek + sonda ayırt edici kısım) tek kimliğe düşüyor, iki
// ayrı rezervasyon tek satırda birleşiyordu (biri kayboluyor, tarihler birbirini eziyordu). Artık uzun kimlik "baş + ~ + tamamının
// özeti" olur: en çok 200 karakter, farklı kimlik → farklı değer, aynı kimlik → hep aynı değer. Kısa kimlik (neredeyse hepsi) AYNEN kalır.
// Eski (kesilmiş) biçimle saklanmış satırlar / silme kayıtları `legacy-source-ref.ts` ile yeni biçime bağlanır.
// ---------------------------------------------------------------------------

export const SOURCE_REFERENCE_MAX = 200;
/** SHA-256'nın base64url uzunluğu. */
const DIGEST_LENGTH = 43;
/** Uzun kimlikte okunur kalan baş kısım (baş + "~" + özet = 200). */
const LONG_HEAD_LENGTH = SOURCE_REFERENCE_MAX - 1 - DIGEST_LENGTH;

/** `max` UTF-16 birimine keser; kesim bir vekil çifti bölüyorsa yarım kalan yarı atılır, sonda kalan boşluk kırpılır. */
function cutSafe(value: string, max: number): string {
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/**
 * Boş / yalnız boşluk → null. 200 karaktere kadar kimlik aynen (kırpılmış). Daha uzunu: baş (≤ 156) + "~" + tam kimliğin SHA-256 özeti —
 * en çok 200 karakter. Eşgüçlü (sonuç ≤ 200 olduğundan ikinci geçiş aynen döner).
 */
export function normalizeSourceReference(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= SOURCE_REFERENCE_MAX) return trimmed;
  return `${cutSafe(trimmed, LONG_HEAD_LENGTH)}~${createHash("sha256").update(trimmed, "utf8").digest("base64url")}`;
}

/**
 * ESKİ biçim (11-11 öncesi): 200 karakterden uzun kimliğin 200'e KESİLMİŞ hâli. Yalnız eski satırları / silme kayıtlarını bulmak içindir —
 * yeni satır HİÇBİR ZAMAN bu biçimle yazılmaz. Kimlik uzun değilse (eski ve yeni biçim aynı) null.
 */
export function legacyTruncatedSourceReference(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length <= SOURCE_REFERENCE_MAX) return null;
  // Kesimden SONRA da kırpılırdı (Haiku 11-05): eski yazım birebir yeniden üretilir.
  return cutSafe(trimmed, SOURCE_REFERENCE_MAX) || null;
}
