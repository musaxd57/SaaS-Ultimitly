import { describe, it, expect } from "vitest";
import { kbPlaceholderTokens } from "@/lib/kb-placeholders";

// ---------------------------------------------------------------------------
// 🚨 ReDoS — `kbPlaceholderTokens` KÜBİKTİ (09-23 denetimi, ölçüldü)
//
// Eski gerçekleme tek bir regex'ti:
//     /\[[^\]\n]*\p{L}[^\]\n]*\]|<[^>\n]*\p{L}[^>\n]*>|_{3,}/gu
// İki SINIRSIZ olumsuz sınıf, aralarında ZORUNLU bir harf: kapanışı olmayan her
// açılışta motor bölünme noktalarının tamamını dener → O(n²) başlangıç başına,
// O(n³) toplam. Ölçüm (bu konteyner): "[ş" tekrarı 2.000 karakter = 2,5 sn,
// 3.000 karakter = 8,1 sn. Bilgi Tabanı kalemi 20.000 karaktere kadar kabul
// ediliyor (zod) → tahmini ~40 DAKİKA tek iş parçacığı DONMASI.
//
// Neden P1: yüklem beş yerde koşuyor ve biri HALKA AÇIK yol — QR misafir sohbeti
// istemi paketlerken (`packKnowledgeBase`) her kalemin içeriğini tarıyor. Kayıt
// AÇIK (REGISTRATION_OPEN=1): biri hesap açar, 20k'lık "[ş[ş…" kalemi yazar, kendi
// QR'ını okutur → paylaşılan Node süreci TÜM kiracılar için dakikalarca durur.
// Diğer tüketiciler: oto-mesaj göndericileri, model cevabının çıktı vetosu,
// şablon→KB bacağı ve Bilgi Tabanı rozeti (istemcide → host'un SEKMESİ donar).
//
// Düzeltme DOĞRUSAL TARAYICI (regex değil). Anlam BİREBİR korunur — aşağıdaki
// eşdeğerlik testi eski regex'i REFERANS KÂHİN olarak kullanır (yalnız kısa
// girdilerde, orada hızlı).
// ---------------------------------------------------------------------------

/** Eski gerçekleme — YALNIZ referans kâhin olarak, yalnız kısa girdilerde. */
const ORACLE = /\[[^\]\n]*\p{L}[^\]\n]*\]|<[^>\n]*\p{L}[^>\n]*>|_{3,}/gu;
const oracle = (s: string) => Array.from(s.matchAll(ORACLE), (m) => m[0]);

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("kbPlaceholderTokens — doğrusal zaman (ReDoS)", () => {
  it.each([
    ["kapanışsız köşeli + harf", "[ş".repeat(1200)],
    ["kapanışsız açılı + harf", "<ş".repeat(1200)],
    ["karışık açılış", "[ş<ş".repeat(600)],
    ["kapanış sonda, arada harf yok", "[".repeat(2399) + "]"],
  ])("%s (2.400 karakter) → hızlı (eskisi ~4 sn)", (_ad, girdi) => {
    expect(girdi.length).toBeGreaterThanOrEqual(2400);
    expect(ms(() => kbPlaceholderTokens(girdi))).toBeLessThan(150);
  });

  it("zod tavanında (20.000+ karakter) da hızlı — ÖNCE küçük prob (gerileme varsa askıda KALMASIN)", () => {
    // Kübik gerilemede 24k girdi ~40 dk sürer ve CI'ı ("Wait for CI") kilitler. Prob
    // 1.200 karakterde eskisiyle ~0,5 sn — önce o düşer, 24k'ya hiç geçilmez.
    expect(ms(() => kbPlaceholderTokens("[ş".repeat(600))), "prob: doğrusal değil").toBeLessThan(50);
    for (const girdi of ["[ş".repeat(12_000), "<ş".repeat(12_000), "[ş<ş_".repeat(5_000)]) {
      expect(ms(() => kbPlaceholderTokens(girdi))).toBeLessThan(250);
    }
  });
});

describe("kbPlaceholderTokens — anlam BİREBİR korunur (eski regex = kâhin)", () => {
  it("bilinen biçimler", () => {
    expect(kbPlaceholderTokens("Wi-Fi: [ŞİFRE] Adres: <adres> ___ {isim}")).toEqual(["[ŞİFRE]", "<adres>", "___"]);
    expect(kbPlaceholderTokens("[1] madde imi, [2] ikinci")).toEqual([]); // harfsiz → yer tutucu DEĞİL
    expect(kbPlaceholderTokens("[ab[cd]")).toEqual(["[ab[cd]"]); // içte açılış serbest, İLK kapanışa kadar
    expect(kbPlaceholderTokens("[a\nb]")).toEqual([]); // satır sonu keser
    expect(kbPlaceholderTokens("__ ve ____")).toEqual(["____"]);
    expect(kbPlaceholderTokens("[𝒜]")).toEqual(["[𝒜]"]); // BMP dışı harf (vekil çift) de harftir
  });

  it("5.000 tohumlu rastgele girdide eski regex ile AYNI çıktı", () => {
    // Tohumlu PRNG (mulberry32) — koşudan koşuya aynı girdiler, düşerse tekrar üretilebilir.
    let seed = 0x5eed_2309;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ALFABE = ["[", "]", "<", ">", "_", "_", "\n", "a", "ş", "İ", "1", " ", "𝒜", "​", "{", "}"];
    let karşılaştırılan = 0;
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(rnd() * 24);
      let s = "";
      for (let i = 0; i < len; i++) s += ALFABE[Math.floor(rnd() * ALFABE.length)];
      expect(kbPlaceholderTokens(s), JSON.stringify(s)).toEqual(oracle(s));
      karşılaştırılan++;
    }
    // Anti-vakumluk: kâhin gerçekten eşleşme üretiyordu (hep boş liste kıyaslamak hiçbir şey kanıtlamaz).
    let eşleşmeli = 0;
    seed = 0x5eed_2309;
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(rnd() * 24);
      let s = "";
      for (let i = 0; i < len; i++) s += ALFABE[Math.floor(rnd() * ALFABE.length)];
      if (oracle(s).length > 0) eşleşmeli++;
    }
    expect(karşılaştırılan).toBe(5000);
    expect(eşleşmeli, "kâhin neredeyse hiç eşleşme üretmedi — alfabe/uzunluk testi vakumlu yapıyor").toBeGreaterThan(500);
  });
});
