import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

// ---------------------------------------------------------------------------
// KURUCUNUN GERÇEK İŞLETME ADI REPODA GEÇMEZ — MEKANİK PİN (09-11).
//
// 🚨 NEDEN VAR: 3cca38b ile 95 dosyadan 296 geçiş temizlendi, sonra BEN aynı
// gün `34fc701` ile yeni bir fikstür yazarken adı GERİ GETİRDİM ve push ettim.
// Hiçbir test bunu görmedi; mutasyon turunda "adı geri koy" mutantı HAYATTA
// KALDI. Kural bir insan hatırlatmasıyla değil, bir kapıyla korunur.
//
// 🚨 ARANAN KELİME BU DOSYAYA DA YAZILMAZ — kural "dosyalarda geçmesin" diyor
// ve bir koruma testi kuralın istisnası olamaz. Bu yüzden iğne KARAKTER
// KODLARINDAN kurulur; kaynakta hiçbir yerde düz metin olarak durmaz.
//
// ⚠️ Kapsam: `git ls-files` = TAKİP EDİLEN dosyalar (node_modules ve .next
// zaten dışarıda). Arama büyük/küçük harf duyarsız ve Türkçe "ü" varyantını da
// kapsar. Geçmiş commit'ler bu testin konusu DEĞİL (yeniden yazım gerektirir,
// ayrı ve kurucuya ait bir karar) — burada ölçülen şey ÇALIŞMA AĞACI.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../..");

/** İğneyi kod noktalarından kurar — literal repoda YER ALMAZ. */
function needle(): string {
  return String.fromCharCode(110, 117, 118, 101); // n u v e
}

/** Türkçe "ü" varyantı, aynı gerekçeyle kod noktalarından. */
function needleTr(): string {
  return String.fromCharCode(110, 252, 118, 101); // n ü v e
}

function grepCount(pattern: string): string[] {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-I", "-i", "-l", "-e", pattern, "--", ":!tests/unit/brand-name-absent.test.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch (err) {
    // `git grep` eşleşme yoksa 1 ile çıkar — bu BAŞARIDIR, hata değil.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return [];
    throw err;
  }
}

describe("marka adı repoda geçmez (kurucu talimatı 09-11)", () => {
  it("🚨 takip edilen hiçbir dosyada geçmiyor (ASCII ve Türkçe varyant)", () => {
    for (const p of [needle(), needleTr()]) {
      const hits = grepCount(p);
      expect(
        hits,
        `Marka adı ${hits.length} dosyada geri gelmiş. Fikstürlerde kurgusal "Lale", ` +
          "canlı hesaba atıfta \"kurucu org\" kullanılır (CLAUDE.md).",
      ).toEqual([]);
    }
  });

  it("PİN VAKUMLU DEĞİL — arama gerçekten çalışıyor", () => {
    // Anti-vakumluk: aynı mekanizma repoda KESİNLİKLE bulunan bir kelimeyi
    // bulmalı. Bulamıyorsa (git yok, cwd yanlış, bayrak bozuk) üstteki iddia
    // her zaman boş liste döndürür ve sessizce anlamsızlaşır.
    expect(grepCount("knowledgeBase").length).toBeGreaterThan(0);
  });
});
