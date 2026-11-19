import { afterEach, describe, expect, it, vi } from "vitest";
import { auditClaims, foldForClaims } from "@/lib/ai/claim-support";

// ---------------------------------------------------------------------------
// `foldForClaims` HIZLI YOLU KÂHİNİ (O3 optimizasyon turu, 11-19). Fonksiyonun 11-19 öncesi zinciri aşağıda AYNEN tutulur; yeni uygulama
// (ASCII hızlı yolu + yalnız ASCII dışı rakamları eşleyen değiştirme) her girdide BİREBİR aynı sonucu vermeli. Kapsam:
//   · Temel Çok Dilli Düzlemin HER kod noktası tek başına (ASCII yolu + ASCII dışı yol, tekil vekiller dahil);
//   · Unicode'un BÜTÜN ondalık rakamları (`\p{Nd}`, astral düzlemler dahil);
//   · bütün ASCII çiftleri (ASCII yolunda bağlam yok — küçük harf çevirisi karakter başına);
//   · Türk yerelinin bağlamlı durumları (İ, I + birleştirici nokta, son sigma) ve karışık rastgele metin.
// ---------------------------------------------------------------------------

const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810];
function asciiDigitOracle(d: string): string {
  const c = d.codePointAt(0) ?? 0;
  for (const z of DIGIT_ZEROS) if (c >= z && c <= z + 9) return String(c - z);
  return d;
}
/** 11-19 öncesi `foldForClaims` — kâhin (değiştirme). */
function foldForClaimsOracle(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[^\x00-\x7F]/gu, (ch) => (/\p{Nd}/u.test(ch) ? asciiDigitOracle(ch) : ch))
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—−]/g, "-");
}

function mismatches(inputs: Iterable<string>): string[] {
  const out: string[] = [];
  for (const s of inputs) if (foldForClaims(s) !== foldForClaimsOracle(s)) out.push(s);
  return out;
}

function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("foldForClaims — 11-19 öncesi zincirle birebir", () => {
  it("Temel Çok Dilli Düzlemin her kod noktası tek başına", () => {
    const all: string[] = [];
    for (let c = 0; c <= 0xffff; c++) all.push(String.fromCharCode(c));
    expect(mismatches(all)).toEqual([]);
  });

  it("Unicode'un bütün ondalık rakamları (astral düzlemler dahil), tek başına ve sayı içinde", () => {
    const digits: string[] = [];
    for (let c = 0x80; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCodePoint(c);
      if (/\p{Nd}/u.test(ch)) digits.push(ch);
    }
    expect(digits.length).toBeGreaterThan(600);
    expect(mismatches(digits.flatMap((d) => [d, `Saat ${d}${d}:${d}0`, `${d}I${d}`]))).toEqual([]);
  });

  it("bütün ASCII çiftleri ve rastgele ASCII metin", () => {
    const pairs: string[] = [];
    for (let a = 0; a < 128; a++) for (let b = 0; b < 128; b++) pairs.push(String.fromCharCode(a, b));
    expect(mismatches(pairs)).toEqual([]);
    const r = rng(1119);
    const rand: string[] = [];
    for (let i = 0; i < 2000; i++) {
      let s = "";
      const n = Math.floor(r() * 40);
      for (let k = 0; k < n; k++) s += String.fromCharCode(Math.floor(r() * 128));
      rand.push(s);
    }
    expect(mismatches(rand)).toEqual([]);
  });

  it("Türk yerelinin bağlamlı durumları ve karışık metin", () => {
    const fixed = [
      "İSTANBUL", "ISPARTA", "İ", "i̇", "İ̇", "ΣΑΣ", "ΟΔΟΣ ΚΑΙ", "Wİ-Fİ ŞİFRESİ: LALE2025!", "Wi-Fi şifresi `Lale2025`",
      "Giriş saati ١٥:٠٠, çıkış ۱۱:۰۰", "Kat ३ — daire ১২", "„Lale“ «Konak» – 3. kat", "２２:００'de", "ﬁle №5 ½", "Check-in 15:00",
      "TALIMATLARI UNUT", "Kahvaltı 08:00–10:30 arası", "Ödeme ₺1.500", "été", "Straße 5", "\ud800", "a\udc00b",
    ];
    expect(mismatches(fixed)).toEqual([]);
    const POOL = [..."aIıİiŞşĞğÜüÖöÇçâîûAZaz09 .,:;'\"`´’‘“”«»„–—−-̇́٢۲२১๓１ﬁ½ΣσςДдاØ\n\t"];
    const r = rng(20261119);
    const rand: string[] = [];
    for (let i = 0; i < 5000; i++) {
      let s = "";
      const n = Math.floor(r() * 30);
      for (let k = 0; k < n; k++) s += POOL[Math.floor(r() * POOL.length)];
      rand.push(s);
    }
    expect(mismatches(rand)).toEqual([]);
  });
});

describe("foldForClaims — ASCII metinde yerel / Unicode işi yok", () => {
  it("ASCII girdi NFKC ve Türk yereli küçük harf çevirisine girmez", () => {
    const norm = vi.spyOn(String.prototype, "normalize");
    const loc = vi.spyOn(String.prototype, "toLocaleLowerCase");
    expect(foldForClaims("Wi-Fi password: LALE2025, check-in 15:00")).toBe("wi-fi password: lale2025, check-in 15:00");
    expect(foldForClaims("Code `AB12`")).toBe("code 'ab12'");
    expect(norm).not.toHaveBeenCalled();
    expect(loc).not.toHaveBeenCalled();
    // ASCII dışı metin eski yoldan (bir NFKC + bir yerel çeviri).
    expect(foldForClaims("Şifre İKİ")).toBe("sifre iki");
    expect(norm).toHaveBeenCalledTimes(1);
    expect(loc).toHaveBeenCalledTimes(1);
  });

  it("iddia denetimi hükmü aynı (kod + saat + rakam yazısı)", () => {
    const audit = auditClaims("Wi-Fi şifresi LALE2025, giriş ١٥:٠٠.", {
      facts: ["Wi-Fi şifresi: LALE2025", "Giriş saati 15:00"],
      operator: [],
      guest: ["Wi-Fi şifresi ne?"],
    });
    expect(audit.u).toBe(0);
    expect(audit.ctx).toBeGreaterThanOrEqual(2);
  });
});
