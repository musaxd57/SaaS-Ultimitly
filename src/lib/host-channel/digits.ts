// ---------------------------------------------------------------------------
// Her yazıdaki ondalık rakam → ASCII (inceleme 10-30 gece D + Haiku P2-2). SAF, yaprak modül (hiçbir şey import etmez): hem cevap kurucu denetimi
// (`compose-check.ts`, uydurulmuş sayı / telefon) hem misafir alıntısı maskesi (`question-text.ts`, Arapça / Farsça rakamlı telefon) aynı kuralı
// kullanır. Tam genişlik / matematik rakamlar NFKC ile; ötekiler Unicode kuralıyla (her yazının 0–9'u ardışık on kod noktası): rakamın değeri,
// bitişik rakam dizisinin başından uzaklığının onluk kalanı.
// ---------------------------------------------------------------------------

const ND = /\p{Nd}/u;

export function asciiDigits(text: string): string {
  return text.normalize("NFKC").replace(/\p{Nd}/gu, (ch) => {
    const c = ch.codePointAt(0)!;
    if (c <= 0x39) return ch;
    let base = c;
    for (let i = 0; i < 60 && ND.test(String.fromCodePoint(base - 1)); i++) base--;
    return String((c - base) % 10);
  });
}
