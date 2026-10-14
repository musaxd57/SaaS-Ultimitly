/**
 * Her Unicode ONDALIK rakamını (`\p{Nd}`: Arap-Hint ٠-٩, Farsça ۰-۹, tam genişlik ０-９, Devanagari …) ASCII karşılığına indirir
 * (Y2, 10-14 dış inceleme: "Kapı kodu: ٦١٤٢" sır taramasının `\d` / `[0-9]` kalıplarından kaçıyordu; NFKC bu rakamları ÇEVİRMEZ).
 * Unicode kararlılık kuralı: Nd karakterleri her zaman 0..9 sırasıyla ARDIŞIK bloklarda kodlanır (bitişik bloklar — matematiksel
 * rakamlar — da 10'un katı) → değer = (kod noktası − ardışık Nd dizisinin başı) mod 10. ASCII metin aynen döner. Yaprak modül.
 */
export function foldUnicodeDigits(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\u0000-\u007f]/.test(s)) return s;
  return s.replace(/(?![0-9])\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) as number;
    let start = cp;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  });
}
