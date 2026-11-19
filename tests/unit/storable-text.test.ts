import { describe, it, expect } from "vitest";
import { hasUnstorableChars, toStorableText } from "@/lib/storable-text";

// Saklanamayan karakter: NUL ve EŞSİZ vekil sessizce silinir, geçerli vekil çifti (emoji) korunur (G2 11-19). Metinler kaçışsız kurulur.
const NUL = String.fromCharCode(0);
const HIGH = String.fromCharCode(0xd800);
const LOW = String.fromCharCode(0xdc00);
const EMOJI = String.fromCodePoint(0x1f600);

describe("saklanabilir metin", () => {
  it("NUL ve eşsiz vekil (baş / son / ortada; yüksek ya da düşük) silinir", () => {
    expect(toStorableText(`a${NUL}b`)).toBe("ab");
    expect(toStorableText(`${HIGH}a`)).toBe("a");
    expect(toStorableText(`a${HIGH}`)).toBe("a");
    expect(toStorableText(`a${LOW}b`)).toBe("ab");
    expect(toStorableText(`${LOW}${HIGH}`)).toBe(""); // ters sıra çift DEĞİL
    expect(toStorableText(`${HIGH}${HIGH}${LOW}`)).toBe(`${HIGH}${LOW}`); // ilk yüksek eşsiz, ikincisi çiftin parçası
  });

  it("geçerli vekil çifti (emoji) ve Türkçe metin aynen kalır; temiz metinde aynı dize döner", () => {
    const clean = `Çay ${EMOJI} ışık`;
    expect(toStorableText(clean)).toBe(clean);
    expect(hasUnstorableChars(clean)).toBe(false);
    expect(toStorableText(`${EMOJI}${NUL}${EMOJI}`)).toBe(`${EMOJI}${EMOJI}`);
  });

  it("hasUnstorableChars kararı toStorableText ile tutarlı (değişiklik ⟺ saklanamayan karakter)", () => {
    for (const s of ["", "a", NUL, HIGH, LOW, `${HIGH}${LOW}`, `x${LOW}${HIGH}y`, EMOJI, `${EMOJI}${HIGH}`]) {
      expect(hasUnstorableChars(s), JSON.stringify(s)).toBe(toStorableText(s) !== s);
    }
  });
});
