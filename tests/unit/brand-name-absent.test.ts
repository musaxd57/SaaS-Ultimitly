import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
// ⚠️ ORTAM BAĞIMSIZ OLMAK ZORUNDA (CI'da ÖLÇÜLDÜ, koşu #1058): `git grep` CI
// konteynerinde `detected dubious ownership` ile 128 döndü — checkout'u yapan
// kullanıcı ile testi koşan kullanıcı farklı. Test o koşuda DOĞRU davrandı
// (sessizce geçmek yerine KIRMIZI verdi) ama bir koruma pini ortam farkından
// kırılmamalı. İki katman:
//   1) `git ls-files` (hızlı, TAKİP EDİLEN dosyalar) — `safe.directory` KOMUT
//      kapsamında verilir, global git ayarına DOKUNULMAZ.
//   2) Git herhangi bir sebeple çalışmazsa DOSYA SİSTEMİ TARAMASI.
// 🚨 FAIL-OPEN YOK: iki katman da boş dönerse anti-vakumluk testi kırmızıdır.
//
// ⚠️ Geçmiş commit'ler bu testin konusu DEĞİL (yeniden yazım gerektirir, ayrı ve
// kurucuya ait bir karar) — burada ölçülen şey ÇALIŞMA AĞACI.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../..");
const SELF = "tests/unit/brand-name-absent.test.ts";

/** Taramanın dışında kalan dizinler — üretilmiş/çekilmiş içerik. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "coverage",
  "playwright-report", "test-results", ".turbo", ".vercel",
]);
/** İkili dosyalar: metin araması anlamsız, okumak da pahalı. */
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2",
  ".ttf", ".otf", ".eot", ".zip", ".gz", ".mp4", ".webm", ".node", ".wasm",
]);

/** İğneyi kod noktalarından kurar — literal repoda YER ALMAZ. */
function needle(): string {
  return String.fromCharCode(110, 117, 118, 101); // n u v e
}

/** Türkçe "ü" varyantı, aynı gerekçeyle kod noktalarından. */
function needleTr(): string {
  return String.fromCharCode(110, 252, 118, 101); // n ü v e
}

/** Katman 1 — takip edilen dosyalar. Başarısızsa `null` (istisna DEĞİL). */
function trackedFiles(): string[] | null {
  try {
    const out = execFileSync(
      "git",
      // `safe.directory` KOMUT kapsamında da okunur (git >= 2.38, "protected
      // configuration"); global/system ayar DEĞİŞTİRİLMEZ.
      ["-c", `safe.directory=${REPO}`, "ls-files", "-z"],
      { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const files = out.split("\0").filter(Boolean);
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

/** Katman 2 — dosya sistemi taraması (git yoksa / çalışmazsa). */
function walkFiles(dir: string, rel = ""): string[] {
  const acc: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      acc.push(...walkFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      acc.push(relPath);
    }
  }
  return acc;
}

/** Aranan metni TAŞIYAN dosyaların yolları (büyük/küçük harf duyarsız). */
function filesContaining(pattern: string): string[] {
  const list = trackedFiles() ?? walkFiles(REPO);
  const lower = pattern.toLowerCase();
  const hits: string[] = [];
  for (const f of list) {
    if (f === SELF) continue; // iğnenin kendisi burada kod noktası olarak yaşar
    if (BINARY_EXT.has(path.extname(f).toLowerCase())) continue;
    const abs = path.join(REPO, f);
    let text: string;
    try {
      if (statSync(abs).size > 4 * 1024 * 1024) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // silinmiş / okunamayan dosya taramayı DURDURMAZ
    }
    if (text.toLowerCase().includes(lower)) hits.push(f);
  }
  return hits;
}

describe("marka adı repoda geçmez (kurucu talimatı 09-11)", () => {
  it("🚨 hiçbir dosyada geçmiyor (ASCII ve Türkçe varyant)", () => {
    for (const p of [needle(), needleTr()]) {
      const hits = filesContaining(p);
      expect(
        hits,
        `Marka adı ${hits.length} dosyada geri gelmiş. Fikstürlerde kurgusal "Lale", ` +
          'canlı hesaba atıfta "kurucu org" kullanılır (CLAUDE.md).',
      ).toEqual([]);
    }
  });

  it("PİN VAKUMLU DEĞİL — tarama gerçekten çalışıyor", () => {
    // 🚨 Anti-vakumluk: aynı mekanizma repoda KESİNLİKLE bulunan bir kelimeyi
    // bulmalı. Bulamıyorsa (dosya listesi boş, cwd kaymış, okuma sessizce
    // yutulmuş) üstteki iddia her zaman boş liste döndürür ve sessizce
    // anlamsızlaşır. Bu satır o sınıfı kırmızıya çevirir — ölçüldü: geri
    // çekilme dalı silinip git bozulunca YAKALIYOR.
    expect(filesContaining("knowledgeBase").length).toBeGreaterThan(0);
  });

  it("İKİ KATMAN DA CANLI — git yolu çalışıyorsa dosya listesi dolu", () => {
    // Git yolu bu ortamda çalışıyorsa ONUN kullanıldığını, çalışmıyorsa
    // yürüyüşün devreye girdiğini pinler. Hangisi olursa olsun liste BOŞ OLAMAZ.
    const tracked = trackedFiles();
    const fallback = walkFiles(REPO);
    expect(fallback.length).toBeGreaterThan(100);
    if (tracked) expect(tracked.length).toBeGreaterThan(100);
  });
});
