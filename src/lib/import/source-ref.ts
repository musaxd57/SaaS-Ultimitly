// ---------------------------------------------------------------------------
// İÇE AKTARILAN KAYIT KİMLİĞİ — TEK BİÇİM (Tur 7 CAL-3, kurucu önceliği 11-05). Yaprak modül.
//
// Kimlik (iCal UID / CSV referansı) yazılırken 200 karaktere kesiliyor, ama senkron / dosya yolu, silme (KVKK) kapısı, "beslemede
// görüldü" kümesi ve bağlı satır araması TAM kimlikle arıyordu → 200'den uzun kimlikte (bazı Exchange / Outlook beslemeleri) tarih
// değişikliği ve STATUS:CANCELLED sessizce yok sayılıyor, silinmiş konaklama yeniden içe alınabiliyordu. Kimlik DOĞDUĞU yerde
// (ayrıştırıcılar) bir kez bu biçime getirilir; sonraki her kullanım saklanan değerle aynıdır. Vekil çift ortadan bölünmez.
// ---------------------------------------------------------------------------

export const SOURCE_REFERENCE_MAX = 200;

/** Boş / yalnız boşluk → null. Uzun kimlik 200 UTF-16 birimine kesilir; kesim bir vekil çifti bölüyorsa yarım kalan yarı atılır, sonda kalan boşluk kırpılır. Eşgüçlü. */
export function normalizeSourceReference(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= SOURCE_REFERENCE_MAX) return trimmed;
  let cut = trimmed.slice(0, SOURCE_REFERENCE_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  // Kesimden SONRA da kırpılır (Haiku 11-05): "195 harf + boşluklar + XYZ" kesilince sonda boşluk kalıyor, ikinci geçiş onu kırpıp
  // FARKLI değer üretiyordu → yazılan ile aranan ayrışırdı. Kırpılmış değer ≤ 200 olduğundan ikinci geçiş aynen döner (eşgüçlü).
  return cut.trimEnd() || null;
}
