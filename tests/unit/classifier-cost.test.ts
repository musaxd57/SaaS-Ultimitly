import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType, isClosingAck, joinInWordApostrophes, __asciiFoldMissCount } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// SINIFLANDIRICI MALİYETİ — düşmanca girdide sınırlı kalır (09-23 denetimi, ÖLÇÜLDÜ)
//
// `classifyFallback` misafir metninin geçtiği HER yolda koşar (kanal oto-yanıt kapısı,
// bekleyen mesajlar, QR kapısı, QR konu taraması). İki ölçülmüş kusur vardı:
//   ① `matchesWordForm` her belirteç için listedeki her kelimeyi (145 cihaz adı) yeniden
//      katlıyordu → 2.000 karakterlik `a'a'a'…` = 163 ms;
//   ② `deviceTokens`in kesme regex'i `([\p{L}\p{N}]+)['’…](?=…)` kesmesiz UZUN kelimede
//      O(n²) → 2.000 karakterlik "şşş…" 99 ms, karma yazı "оaоa…" 180 ms.
// Düzeltme anlamı DEĞİŞTİRMEZ (saf fonksiyon önbellekleri + eşdeğer doğrusal tarayıcı);
// anlam ayrıca GOLDEN SET ve şikâyet/injection bataryalarıyla pinli.
// Süre pini 4.000 karakterde: doğrusal kodla ~40 ms, eski kodla 300–700 ms — geniş ayrım,
// CI makine hızı farkına dayanıklı.
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

const ADVERSARIAL: [string, string][] = [
  ["kesme tekrarı", "a'".repeat(2000)],
  ["karma yazı (Kiril+Latin)", "оa".repeat(2000)],
  ["tek uzun kelime (Türkçe harf)", "ş".repeat(4000)],
  ["tek uzun kelime (ASCII)", "a".repeat(4000)],
  ["cihaz + dolgu + fiil", "klima " + "çok ".repeat(1000) + "bozuldu"],
  ["özne + dolgu + fiil tekrarı", ("plan " + "çok ".repeat(8) + "bozuldu ").repeat(90)],
  ["ayıraçlı yazım", "a.".repeat(2000)],
  ["birleştirici işaret", "á".repeat(2000)],
];

describe("sınıflandırıcı — düşmanca girdide sınırlı süre", () => {
  it.each(ADVERSARIAL)("%s (~4.000 karakter) → 200 ms altında", (_ad, girdi) => {
    classifyFallback(girdi.slice(0, 40)); // ısınma (JIT) — ölçüme girmez
    const t = ms(() => {
      classifyFallback(girdi);
      isClosingAck(girdi);
      detectRiskType(girdi);
    });
    expect(t).toBeLessThan(200);
  });
});

describe("kelime listesi katlama önbelleği — ÖLÇÜLMÜŞ katkı, deterministik pin", () => {
  // Önbellek yalnız MALİYETİ etkiler; süre pini onu ayırt edemiyordu (mutasyon turu 09-23:
  // kaldıran mutant HAYATTA KALDI). Ölçüm: kaldırılınca 800 gerçekçi mesaj 388 → 678 ms.
  // Pin davranış değil SÖZLEŞME: statik listeler süreç başına BİR kez katlanır.
  const GERCEKCI = [
    "Merhaba, giriş saati kaçta?", "Wifi şifresi nedir?", "Klima çalışmıyor, yardımcı olur musunuz?",
    "Sıcak su gelmiyor", "Teşekkürler, her şey harikaydı!", "Otopark var mı?", "Hi, what time is check-out?",
    "The shower is broken and there is no hot water", "Erken giriş yapabilir miyiz?", "Kapı kodu çalışmıyor",
    "Buzdolabı bozuldu", "Mutfak musluğu akmıyor", "Bir sorun olursa sizi arayabilir miyiz?",
  ];
  const tur = () => {
    for (const m of GERCEKCI) {
      classifyFallback(m);
      detectRiskType(m);
      isClosingAck(m);
    }
  };

  it("ikinci turda HİÇBİR liste yeniden katlanmaz", () => {
    tur();
    expect(__asciiFoldMissCount(), "sayaç hiç artmıyor — önbellek yolu çalışmıyor (vakum)").toBeGreaterThan(0);
    const once = __asciiFoldMissCount();
    tur();
    expect(__asciiFoldMissCount() - once).toBe(0);
  });
});

describe("joinInWordApostrophes — eski regex ile BİREBİR (her yüklemle)", () => {
  /** Eski gerçekleme — YALNIZ referans kâhin olarak, yalnız kısa girdilerde. */
  const ORACLE = /([\p{L}\p{N}]+)['’‘ʼ′`](?=[\p{L}\p{N}])/gu;
  const oracle = (s: string, keep: (l: string) => boolean) => s.replace(ORACLE, (whole, left: string) => (keep(left) ? left : whole));

  const YÜKLEMLER: [string, (l: string) => boolean][] = [
    ["hep doğru", () => true],
    ["hep yanlış", () => false],
    ["çift uzunluk", (l) => l.length % 2 === 0],
    ["cihaz benzeri küme", (l) => ["klima", "kapı", "a", "ş1", "𝒜b"].includes(l)],
  ];

  it.each(YÜKLEMLER)("5.000 tohumlu rastgele girdi — yüklem: %s", (_ad, keep) => {
    let seed = 0x0923_a905;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ALFABE = ["a", "ş", "1", "'", "’", "‘", "ʼ", "′", "`", " ", "-", "𝒜", "\ud835", "klima", "kapı", "b", "\n"];
    let farklı = 0;
    let değişen = 0;
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(rnd() * 16);
      let s = "";
      for (let i = 0; i < len; i++) s += ALFABE[Math.floor(rnd() * ALFABE.length)];
      const beklenen = oracle(s, keep);
      if (joinInWordApostrophes(s, keep) !== beklenen) farklı++;
      if (beklenen !== s) değişen++;
    }
    expect(farklı).toBe(0);
    // Anti-vakumluk: "hep yanlış" dışında kâhin gerçekten birleştirme yapıyordu.
    if (_ad !== "hep yanlış") expect(değişen, "kâhin hiç birleştirme yapmadı — test vakumlu").toBeGreaterThan(200);
  });

  it("uzun kesmesiz kelimede doğrusal (eski regex O(n²))", () => {
    expect(ms(() => joinInWordApostrophes("ş".repeat(20_000), () => true))).toBeLessThan(100);
  });
});
