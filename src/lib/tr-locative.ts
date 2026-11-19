// ---------------------------------------------------------------------------
// TÜRKÇE BULUNMA EKİ (-de / -da / -te / -ta) — özel ada kesmeyle eklenir: "Lale 3'te", "Deniz'de", "Ada'da" (UA-1, kurucu 11-19).
//
// Ek, adın OKUNUŞUNUN son hecesine uyar: son ünlü kalın (a ı o u) → "a", ince (e i ö ü) → "e"; son ses sert ünsüzse (f s t k ç ş h p —
// "FıSTıKÇı ŞaHaP") → "t", değilse "d". Ad rakamla bitiyorsa sayının okunuşu esas alınır: 3 "üç" → 'te, 10 "on" → 'da, 100 "yüz" → 'de.
// Ünlüsü olmayan kısaltma ("B", "TRT") harf harf okunur; harf adları ince ünlüyle biter ("be", "te") → 'de.
// Ev sahibinin yazdığı ada uygulanır: tarama SONDAN doğrusal (düzenli ifade yok — CLAUDE.md "karesel iş yok").
// YAPRAK modül: hiçbir şey içe aktarmaz.
// ---------------------------------------------------------------------------

const BACK_VOWELS = "aıouâû";
const FRONT_VOWELS = "eiöüî";
const HARD_CONSONANTS = "fstkçşhp";

/** Rakamın okunuşu (birler basamağı). */
const DIGIT_WORDS = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"] as const;
/** Onlar basamağının okunuşu (birler sıfırken son sözcük). */
const TEN_WORDS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"] as const;

const isDigit = (ch: string) => ch >= "0" && ch <= "9";
/** Harf mi (yalnız büyük-küçük biçimi olan yazı karakterleri: Latin, Türkçe, aksanlı). */
const isLetter = (ch: string) => ch.toLocaleLowerCase("tr") !== ch.toLocaleUpperCase("tr");

/** Rakam dizisinin (baştaki sıfırlar atılmış) okunuşundaki SON sözcük. */
function lastSpokenWordOfNumber(digits: string): string {
  let start = 0;
  while (start < digits.length - 1 && digits[start] === "0") start++;
  const n = digits.slice(start);
  if (n === "0") return DIGIT_WORDS[0];
  let zeros = 0;
  while (n[n.length - 1 - zeros] === "0") zeros++;
  const last = Number(n[n.length - 1 - zeros]);
  if (zeros === 0) return DIGIT_WORDS[last];
  if (zeros === 1) return TEN_WORDS[last];
  // Sonda iki ve daha çok sıfır: son sözcük basamak adı — yüz, bin (3–5 sıfır), milyon (6–8), milyar (9 ve üstü).
  if (zeros === 2) return "yüz";
  if (zeros <= 5) return "bin";
  if (zeros <= 8) return "milyon";
  return "milyar";
}

function suffixForWord(word: string): string | null {
  const w = word.toLocaleLowerCase("tr");
  let vowel = "";
  for (let i = w.length - 1; i >= 0; i--) {
    if (BACK_VOWELS.includes(w[i]) || FRONT_VOWELS.includes(w[i])) {
      vowel = w[i];
      break;
    }
  }
  if (!vowel) return null;
  const hard = HARD_CONSONANTS.includes(w[w.length - 1]);
  return `'${hard ? "t" : "d"}${BACK_VOWELS.includes(vowel) ? "a" : "e"}`;
}

/**
 * Bulunma eki, kesmesiyle: `Lale 3` → `'te`, `Deniz` → `'de`. Adın sonundaki noktalama / boşluk atlanır; okunacak hece yoksa (boş ad,
 * yalnız simge) ince-yumuşak biçim `'de` döner (harf adlarıyla aynı — en yaygın okunuş).
 */
export function locativeSuffixTr(name: string): string {
  let end = name.length;
  while (end > 0 && !isDigit(name[end - 1]) && !isLetter(name[end - 1])) end--;
  if (end === 0) return "'de";
  let start = end;
  if (isDigit(name[end - 1])) {
    while (start > 0 && isDigit(name[start - 1])) start--;
    return suffixForWord(lastSpokenWordOfNumber(name.slice(start, end))) ?? "'de";
  }
  while (start > 0 && isLetter(name[start - 1])) start--;
  return suffixForWord(name.slice(start, end)) ?? "'de";
}
