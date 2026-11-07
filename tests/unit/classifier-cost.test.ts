import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType, isClosingAck, isSafetyEmergencyText, joinInWordApostrophes, __asciiFoldMissCount } from "@/lib/ai/fallback";
import { isPhysicalEmergency } from "@/lib/guest-chat";

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
  // ReDoS denetimi 09-28 (ÖLÇÜLDÜ): cihaz adı + TEK uzun sözcük + arıza fiili sonek kalıplarını (`\p{L}{2,}(…)$`) uzun
  // sözcükte karesel koşturuyordu; aday biçim çoğaltan önekle 2.000 harfte 0,65 sn, 20.000'de 66 sn.
  ["cihaz + tek uzun sözcük + fiil", "klima " + "a".repeat(3990) + " bozuldu"],
  ["aday çoğaltan önek + cihaz + tek uzun sözcük + fiil", "\u00e9 \u043e a.b.c.d x'y klima " + "a".repeat(3970) + " bozuldu"],
  // İyelikli ad ("rengi") tamlayan zincirini açar: tamlayan kalıbı SOLDAKİ uzun sözcükte koşar (pencere yokken 0,9 sn).
  ["önek + cihaz + uzun sözcük + iyelikli ad + fiil", "\u00e9 \u043e a.b.c.d x'y klima " + "a".repeat(3955) + " rengi bozuldu"],
  // K6 (09-30): acil ağının bağlam nötrlemesi (yer / eşya adı, "acil değil") + olay bağlamı denetimi.
  ["acil değil + tek uzun sözcük", "acil değil " + "a".repeat(3990)],
  ["aday çoğaltan önek + acil değil + lamba tekrarı", "\u00e9 \u043e a.b.c.d x'y acil değil " + "lamba ".repeat(660)],
  ["yangın söndürücü tekrarı", "yangın söndürücü ".repeat(235)],
  ["no emergency tekrarı", "no emergency ".repeat(307)],
  ["değil + uzun boşluk + mi", "acil değil" + " ".repeat(3990) + "mi"],
  // 10-02: Türkçe "parti" tam sözcük kalıbı (kural ihlali ağı) — tekrar eden aday ve sözcük içi eşleşme doğrusal.
  ["partir / partiye tekrarı", "partir partiye ".repeat(270)],
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

// UZUN MESAJ YOLU (K10-t): 8.000 kod noktasını aşan kanal mesajında YALNIZ acil ağı koşar ve kanal mesajında uzunluk tavanı yok.
// K6 (09-30) bağlam nötrlemesi doğrusal kalmalı: 50.000 karakterde bugün ~15–75 ms; karesel bir gerileme saniyeler sürerdi.
const LONG_PATH: [string, string][] = [
  ["acil değil + tek uzun sözcük", "acil değil " + "a".repeat(50_000)],
  ["aday çoğaltan önek + acil değil + lamba tekrarı", "\u00e9 \u043e a.b.c.d x'y acil değil " + "lamba ".repeat(8_300)],
  ["polis merkezi tekrarı", "polis merkezi ".repeat(3_570)],
  ["acil + uzun boşluk + değil", "acil" + " ".repeat(50_000) + "değil"],
  // 10-02 sözcük içi / öbek çakışması düzeltmesi: yeni öbek nötrlemeleri + ASCII dışı kalıplar uzun boşluk / tekrarda doğrusal.
  ["can't + uzun boşluk + get in touch", "can't" + " ".repeat(50_000) + "get in touch"],
  ["feux d + uzun boşluk + artifice", "le feux d" + " ".repeat(50_000) + "artifice"],
  ["n + uzun boşluk + y a pas le feu", "il n" + " ".repeat(50_000) + "y a pas le feu"],
  ["smoke + uzun boşluk + free", "smoke" + " ".repeat(50_000) + "free"],
  ["flooded with + uzun boşluk + light", "flooded with" + " ".repeat(50_000) + "light"],
  ["her yeri + uzun boşluk + su", "her yeri" + " ".repeat(50_000) + "su"],
  ["хранение tekrarı", "хранение ".repeat(5_500)],
  ["المصابيح tekrarı", "المصابيح ".repeat(5_500)],
  ["gas station tekrarı", "gas station ".repeat(4_200)],
];
describe("uzun mesaj yolu — acil ağı + fiziksel acil 50.000 karakterde sınırlı süre (K6)", () => {
  it.each(LONG_PATH)("%s → 1.000 ms altında", (_ad, girdi) => {
    isSafetyEmergencyText(girdi.slice(0, 40)); // ısınma
    const t = ms(() => {
      isSafetyEmergencyText(girdi);
      isPhysicalEmergency(girdi);
    });
    expect(t).toBeLessThan(1_000);
  });
});

describe("sonek kalıpları sözcüğün SON harflerine bakar — uzun sözcükte hüküm aynı (ReDoS denetimi 09-28)", () => {
  // Kalıp yalnız son 32 kod noktasına uygulanır; en uzun sonek ("ıyorsunuz") + öndeki 2 harf pencereye sığmalı.
  it.each(["ıyorsunuz", "dığında", "iyordu", "tik", "mıştı"])("%s: kısa ve 40 harflik sözcükte aynı hüküm", (suf) => {
    const short = classifyFallback(`klima kk${suf} bozuldu`).intent;
    expect(short).toBe("complaint");
    expect(classifyFallback(`klima ${"k".repeat(40)}${suf} bozuldu`).intent).toBe(short);
  });

  it("KONTROL — eksiz sözcükte hüküm farklı (pin gerçekten sonek okumasını sınar)", () => {
    expect(classifyFallback("klima kk bozuldu").intent).not.toBe("complaint");
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
