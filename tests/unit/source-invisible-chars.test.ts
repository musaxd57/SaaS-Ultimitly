import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ÜRÜN KAYNAĞINDA GERÇEK GÖRÜNMEZ / DENETİM KARAKTERİ YOK (sızma testi 11-14).
//
// Neden: yön denetim karakterleri (sağdan sola geçersiz kılma vb.) kodun EKRANDA göründüğü mantıkla derleyicinin gördüğü mantığı
// ayırabilir ("Trojan Source", CVE-2021-42574); sıfır genişlikli karakter bir tanımlayıcıyı ya da düzenli ifade sınıfını incelemede
// görünmez kılar. 11-14 taramasında `src/` altında 16 dosyada bu karakterlerin GERÇEK hâli vardı (çoğu düzenli ifade sınıfında, bir
// kısmı yorumda) — işlevleri doğruydu ama incelemede görünmüyorlardı. Hepsi eşdeğer kaçış dizisine / yorumda "U+XXXX" gösterimine
// çevrildi. Kapsam `src/`, `scripts/`, `prisma/` — testler BİLEREK dışarıda (görünmez karakter işlemeyi sınayan girdiler taşırlar).
//
// İki katman (marka adı pininin dersi, CI #1058): `git ls-files` (komut kapsamında `safe.directory`), git çalışmazsa dosya sistemi
// taraması; ikisi de boşsa anti-vakumluk testi KIRMIZI (fail-open yok).
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../..");
const ROOTS = ["src/", "scripts/", "prisma/"];
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".prisma", ".sql", ".json"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

/** Yasak: \t \n \r dışındaki denetim karakterleri (Cc), biçim karakterleri (Cf: yön denetimi, sıfır genişlik, BOM…), Braille boşluğu
 *  ve Hangul doldurucuları (görünmez ama Cf değil). */
function forbiddenChars(text: string): string[] {
  const found = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\t" || ch === "\n" || ch === "\r") continue;
    if (/[\p{Cc}\p{Cf}]/u.test(ch) || cp === 0x2800 || cp === 0x3164 || cp === 0x115f || cp === 0xffa0) {
      found.add(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  return [...found];
}

function trackedFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["-c", `safe.directory=${REPO}`, "ls-files", "-z", ...ROOTS], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = out.split("\0").filter(Boolean);
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

function walkFiles(dir: string, rel: string): string[] {
  const acc: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const relPath = `${rel}${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) acc.push(...walkFiles(path.join(dir, entry.name), `${relPath}/`));
    } else if (entry.isFile()) acc.push(relPath);
  }
  return acc;
}

function sourceFiles(): string[] {
  const list = trackedFiles() ?? ROOTS.flatMap((r) => walkFiles(path.join(REPO, r), r));
  return list.filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
}

describe("ürün kaynağında gerçek görünmez / denetim karakteri yok", () => {
  it("🚨 src / scripts / prisma: hiçbir dosyada yok (kaçış dizisi ya da U+XXXX gösterimi kullanılır)", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const abs = path.join(REPO, f);
      let text: string;
      try {
        if (statSync(abs).size > 4 * 1024 * 1024) continue;
        text = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const bad = forbiddenChars(text);
      if (bad.length > 0) offenders.push(`${f}: ${bad.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("anti-vakumluk: tarama gerçekten yüzlerce kaynak dosyası görüyor (bilinen dosya dahil)", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/lib/route-guard.ts");
  });

  it("dedektörün kendisi: yön denetimi, sıfır genişlik, BOM, Braille boşluğu yakalanır; Türkçe / emoji / sekme yakalanmaz", () => {
    expect(forbiddenChars("a\u202eb")).toEqual(["U+202E"]);
    expect(forbiddenChars("x\u200by\ufeff")).toEqual(["U+200B", "U+FEFF"]);
    expect(forbiddenChars("\u2800")).toEqual(["U+2800"]);
    expect(forbiddenChars("\u0000")).toEqual(["U+0000"]);
    expect(forbiddenChars("Çağrı şöğüİı 🙂 é\tsatır\n")).toEqual([]);
  });
});
