import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// METİN DOSYALARINDA HAM KONTROL BAYTI YOK (09-23 denetimi, ÖLÇÜLDÜ)
//
// `src/lib/ai/absence.ts` içinde HAM bir NUL baytı vardı (`const SEP = "<NUL>"`).
// Çalışma zamanı değeri doğruydu, ama: git dosyayı İKİLİ saydı (`git diff` →
// "Binary files differ" — incelemede görünmez), grep "binary file matches" deyip
// içerik göstermedi ve metin taramalı pinler dosyayı SESSİZCE atlayabilirdi. Bu dosya
// ürünün "bilgim yok misafire gitmez" kapısıdır — incelenemez olması en pahalı yerdi.
// Doğru yazım kaçış dizisidir (`"\u0000"`): değer aynı, dosya metin kalır.
//
// Kapsam: takip edilen METİN dosyaları (ikili uzantılar hariç). İzinli: \t \n \r.
// İki katmanlı git deyimi (CLAUDE.md: `safe.directory` KOMUT kapsamında + dosya
// sistemi yedeği + anti-vakumluk), `brand-name-absent` emsali.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "coverage",
  "playwright-report", "test-results", ".turbo", ".vercel",
]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2",
  ".ttf", ".otf", ".eot", ".zip", ".gz", ".mp4", ".webm", ".node", ".wasm", ".7z", ".dump",
]);

function trackedFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["-c", `safe.directory=${REPO}`, "ls-files", "-z"], {
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

/** \t (9), \n (10), \r (13) DIŞINDAKİ C0 kontrol baytları + DEL. */
function hasRawControlByte(buf: Buffer): boolean {
  for (const b of buf) {
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) return true;
  }
  return false;
}

function textFiles(): string[] {
  return (trackedFiles() ?? walkFiles(REPO)).filter((f) => !BINARY_EXT.has(path.extname(f).toLowerCase()));
}

describe("takip edilen metin dosyalarında ham kontrol baytı yok", () => {
  it("🚨 hiçbir metin dosyası ham NUL/kontrol baytı taşımaz (kaçış dizisi kullan)", () => {
    const hits: string[] = [];
    for (const f of textFiles()) {
      const abs = path.join(REPO, f);
      try {
        if (statSync(abs).size > 8 * 1024 * 1024) continue;
        if (hasRawControlByte(readFileSync(abs))) hits.push(f);
      } catch {
        continue;
      }
    }
    expect(hits, "ham kontrol baytı: git/grep dosyayı ikili sayar, inceleme ve pinler onu görmez").toEqual([]);
  });

  it("ANTİ-VAKUMLUK: tarama gerçekten dosya görüyor ve dedektör gerçekten yakalıyor", () => {
    const files = textFiles();
    expect(files).toContain("src/lib/ai/absence.ts"); // kusurun yaşadığı dosya kapsamda
    expect(files.length).toBeGreaterThan(200);
    expect(hasRawControlByte(Buffer.from("a\u0000b"))).toBe(true);
    expect(hasRawControlByte(Buffer.from("a\u001bb"))).toBe(true);
    expect(hasRawControlByte(Buffer.from("satır\n\tgirinti\r\n"))).toBe(false);
  });
});
