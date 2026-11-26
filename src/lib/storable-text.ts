// ---------------------------------------------------------------------------
// SAKLANABİLİR METİN (sızma testi 11-14 A-1 sınıfı + G2 11-19). PostgreSQL `text` NUL saklayamaz; Prisma sorgu motoru EŞSİZ (tek başına
// duran) UTF-16 vekil birimini okumada da yazmada da reddeder. Kullanıcının bilerek gönderdiği böyle bir karakter her yazmada sorgu hatası
// (500 + ortak uyarı e-postası) doğuruyordu → sahte 500'lerle gerçek alarmlar bastırılabiliyordu. JSON'da ikisi de yalnız kaçışla gelir
// (NUL için ters bölü u, sıfırlar; eşsiz vekil için D800–DFFF aralığında tek kaçış).
//
// Kural (A-1 ile AYNI): metin DEĞERİNDEN bu karakterler SESSİZCE silinir — sağlayıcı dizesi kuralı (`canonicalStr`) ve QR mesajının pinli
// sözleşmesi ("denetim karakteri sessizce silinir, mesaj 500 de 400 de vermez"). Geçerli vekil ÇİFTİ (emoji vb.) korunur.
// Doğrusal tek geçiş; temiz metinde yeni dize kurulmaz. YAPRAK modül: hiçbir şey içe aktarmaz.
// ---------------------------------------------------------------------------

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Metinde saklanamayan karakter (NUL ya da eşsiz vekil) var mı. */
export function hasUnstorableChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return true;
    if (isHigh(c)) {
      if (i + 1 < s.length && isLow(s.charCodeAt(i + 1))) {
        i++;
        continue;
      }
      return true;
    }
    if (isLow(c)) return true;
  }
  return false;
}

/** NUL ve eşsiz vekil birimleri silinmiş metin (temizse aynı dize döner). */
export function toStorableText(s: string): string {
  if (!hasUnstorableChars(s)) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) continue;
    if (isHigh(c)) {
      if (i + 1 < s.length && isLow(s.charCodeAt(i + 1))) {
        out += s[i] + s[i + 1];
        i++;
      }
      continue;
    }
    if (isLow(c)) continue;
    out += s[i];
  }
  return out;
}
