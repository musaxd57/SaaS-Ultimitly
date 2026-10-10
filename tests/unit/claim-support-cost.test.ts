import { describe, it, expect } from "vitest";
import { auditClaimsSafe, mixedCodeTokenMatches } from "@/lib/ai/claim-support";

// ---------------------------------------------------------------------------
// İDDİA DESTEĞİ ÖLÇÜMÜ MALİYETİ (ReDoS denetimi 09-28, ÖLÇÜLDÜ): ölçüm her cevaptan sonra misafir metnine (mesaj + geçmiş)
// koşar; kanal mesajında uzunluk tavanı yok. İki kalıp karesel idi: harf+rakam belirteci rakamsız tireli dizide ("a-a-a-…",
// 100.000 karakterde 5 sn) ve anahtar sözcükten sonraki iki bitişik boşluk dizisi ("şifre" + boşluk, 7,7 sn). Belirteç artık
// doğrusal bir tarayıcıyla bulunur; sonuç düzenli ifadenin kendisiyle BİREBİR aynı (aşağıda rastgele girdiyle pinli — düzenli
// ifade burada KÂHİN olarak durur).
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("iddia ölçümü — düşmanca misafir metninde sınırlı süre", () => {
  it.each([
    ["rakamsız tireli dizi", "a-".repeat(25000)],
    ["anahtar sözcük + uzun boşluk", "\u015fifre" + " ".repeat(50000) + ","],
    ["sonda tek rakamlı tireli dizi", "a-".repeat(25000) + "1"],
    // 10-10 (Haiku incelemesi): merdiven basamağı / üleştirme eki / eksi işaretli kat yolları.
    ["rakam-tire dizisi + kat", "1-".repeat(25000) + "kat"],
    ["tekrarlanan 'adet' öneki", "1 " + "adet ".repeat(10000) + "basamak"],
    ["tekrarlanan üleştirme eki", "1'er".repeat(12500)],
    ["tekrarlanan 'iç merdiven'", "52 " + "iç merdiven ".repeat(4000) + "basamağı"],
    // 10-10 (kurucu: "-1. kat ile 1. kat aynı değil"): eksi kat okuyucusu.
    ["eksi kat + uzun sonek", "-1 kat" + "t".repeat(50000)],
    ["uzun eksi dizisi + kat", "-".repeat(50000) + "1 kat"],
  ])("%s (50.000 karakter) → 150 ms altında", (_ad, guest) => {
    auditClaimsSafe("Kapı kodu 1234.", { facts: [], operator: [], guest: ["a"] }); // ısınma
    expect(ms(() => auditClaimsSafe("Kapı kodu 1234, saat 15:00, 100 TL.", { facts: [], operator: [], guest: [guest] }))).toBeLessThan(150);
  });
});

describe("harf + rakam belirteci tarayıcısı — düzenli ifadeyle BİREBİR aynı eşleşme dizisi", () => {
  const ORACLE = /\b(?=[a-z_-]*\d)(?=\d*[a-z])[a-z0-9_-]{2,24}\b/g;
  const oracle = (s: string) => {
    const r: string[] = [];
    ORACLE.lastIndex = 0;
    for (let m = ORACLE.exec(s); m; m = ORACLE.exec(s)) r.push(`${m.index}:${m[0]}`);
    return r;
  };
  const scan = (s: string) => mixedCodeTokenMatches(s).map((m) => `${m.index}:${m[0]}`);

  it("tohumlu rastgele 20.000 dizge (harf / rakam / alt çizgi / tire / boşluk / büyük harf / Türkçe harf / vekil çift)", () => {
    let seed = 20260928;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alpha = ["a", "b", "z", "0", "1", "9", "_", "-", " ", ".", "A", "\u015f", "\n", "\u{1F600}"];
    let matches = 0;
    for (let it = 0; it < 20000; it += 1) {
      const len = 1 + Math.floor(rnd() * (it % 10 === 0 ? 80 : 30));
      let s = "";
      for (let i = 0; i < len; i += 1) s += alpha[Math.floor(rnd() * alpha.length)];
      const want = oracle(s);
      matches += want.length;
      expect(scan(s), JSON.stringify(s)).toEqual(want);
    }
    expect(matches).toBeGreaterThan(10000); // pin boş değil: eşleşmeler gerçekten sınandı
  });

  it("uzunluk sınırı (24) ve tire sınırları", () => {
    // "a" + 30 tire + "1": 24 karakter içinde sözcük sınırı yalnız 1. konumda → düzenli ifadenin en az 2 uzunluğu eşleşmeyi keser.
    for (const s of ["abcdefghijklmnopqrstuvwxy1z", "ab-cdefghijklmnopqrstuvwxyz-1", "a1", "3b", "15te", "lalenet_5g", "x" + "-a".repeat(30) + "1", "a" + "-".repeat(30) + "1"]) {
      expect(scan(s), s).toEqual(oracle(s));
    }
  });
});

describe("anlam aynı — örtüşme ve anahtar sözcük yolu", () => {
  it("bağlantının içindeki harf+rakam belirteci ayrıca sayılmaz (tek iddia)", () => {
    const a = auditClaimsSafe("Ayrıntı: https://lale.example/ab1 adresinde.", { facts: [], operator: [], guest: [] })!;
    expect(a.n).toBe(1);
    expect(a.uc).toEqual(["url"]);
  });

  it("anahtar sözcükten sonraki kod bağlamda varsa dayanaklı, yoksa desteksiz", () => {
    expect(auditClaimsSafe("Wi-Fi şifreniz: lale2025.", { facts: [], operator: [], guest: [] })!.uc).toEqual(["code"]);
    expect(auditClaimsSafe("Wi-Fi şifreniz: lale2025.", { facts: ["WIFI: şifre lale2025"], operator: [], guest: [] })!.u).toBe(0);
    expect(auditClaimsSafe("Daire 3b'de kalıyorsunuz.", { facts: [], operator: [], guest: [] })!.uc).toEqual(["code"]);
  });
});
