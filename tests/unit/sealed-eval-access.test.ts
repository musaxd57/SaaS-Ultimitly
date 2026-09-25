import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// MÜHÜRLÜ FİNAL EVAL SETİ — ERİŞİM + BÜTÜNLÜK PİNİ (09-24, `docs/EVAL-MUHURLU-FINAL.md`).
//
// Dış inceleme: ayarlamada görülen set genelleme ölçüsü olamaz; final set model/istem/kod dondurulana kadar
// açılmamalı. Bu dosya içeriği OKUMAZ — yalnız baytlarının SHA-256'sını mühür kaydıyla kıyaslar ve dosya adının
// depoda yalnız izinli yerlerde geçtiğini denetler. Başarısızlık mesajı içerik basmaz.
//
// İğne parçalardan kurulur: bu dosya kendi taramasının istisnası değil, düz metin burada da geçmez.
// Git taraması iki katmanlı (`brand-name-absent.test.ts` ile aynı ders): `safe.directory` KOMUT kapsamında,
// git çalışmazsa dosya sistemi; ikisi de boşsa kırmızı (fail-open yok).
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../..");
const SEALED_DIR = path.join(REPO, "evals", "sealed");
const NEEDLE = ["stay", "change", "final"].join("-");

/** Dosya adının geçmesine izin verilen yerler (yeni okuyucu = bilinçli liste değişikliği). */
const ALLOWED = new Set([
  "evals/sealed/SEALS.json",
  `evals/sealed/${NEEDLE}.json`,
  "tests/eval/stay-change.eval.test.ts",
  "docs/EVAL-MUHURLU-FINAL.md",
]);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "playwright-report", "test-results"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".zip", ".gz"]);

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
      if (!SKIP_DIRS.has(entry.name)) acc.push(...walkFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) acc.push(relPath);
  }
  return acc;
}

const files = trackedFiles() ?? walkFiles(REPO);

describe("mühürlü final eval seti", () => {
  it("anti-vakum: tarama gerçekten dosya görüyor ve harness dosyası listede", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("tests/eval/stay-change.eval.test.ts");
  });

  it("dosya adı YALNIZ izinli yerlerde geçer (yeni okuyucu = bilinçli liste değişikliği)", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === "tests/unit/sealed-eval-access.test.ts" || BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
      const abs = path.join(REPO, rel);
      let text: string;
      try {
        if (statSync(abs).size > 4 * 1024 * 1024) continue;
        text = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (text.includes(NEEDLE) && !ALLOWED.has(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("bütünlük: her MÜHÜRLÜ ya da YANMIŞ dosyanın SHA-256'sı mühür kaydıyla eşleşir (içerik okunmaz, yalnız baytlar)", () => {
    const seals = JSON.parse(readFileSync(path.join(SEALED_DIR, "SEALS.json"), "utf8")) as Record<
      string,
      {
        sha256: string;
        sealedAt: string;
        author: string;
        state: "sealed" | "burned";
        location?: "local-only";
        burnedAt?: string;
        runSha?: string;
        report?: string;
      }
    >;
    // "local-only" = gerçek misafir mesajlarından set (B): dosya depoya ASLA girmez, SHA'sını harness koşuda doğrular.
    for (const [name, seal] of Object.entries(seals).filter(([, s]) => s.location === "local-only")) {
      expect(seal.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(path.join(SEALED_DIR, name)), `${name}: gerçek set depoda OLAMAZ`).toBe(false);
    }
    // Yanmış set de DEĞİŞMEZ: kararın dayandığı rapor o baytlarla koşuldu (09-25: A seti f584075'te koşuldu, yandı).
    const inRepo = Object.entries(seals).filter(([, s]) => s.location !== "local-only");
    expect(inRepo.length).toBeGreaterThan(0); // anti-vakum
    for (const [name, seal] of inRepo) {
      expect(["sealed", "burned"], name).toContain(seal.state);
      expect(seal.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      const digest = createHash("sha256").update(readFileSync(path.join(SEALED_DIR, name))).digest("hex");
      // Mesaj içerik basmaz: yalnız ad + eşleşme.
      expect(digest === seal.sha256, `${name}: SHA-256 mühürle eşleşmiyor`).toBe(true);
    }
    // Yanmış set geri "sealed" yapılıp yeniden koşulamaz: yakma izi taşıyan kayıt yanmış kalır (harness yalnız "sealed" koşar).
    for (const [name, seal] of inRepo.filter(([, s]) => s.burnedAt !== undefined || s.runSha !== undefined || s.report !== undefined)) {
      expect(seal.state, `${name}: yakma izi var ama durum yanmış değil`).toBe("burned");
    }
    // Yakma kaydı eksiksiz: hangi dondurulmuş commit'te koşuldu + kararın okunduğu rapor depoda (protokol "Yak" adımı).
    for (const [name, seal] of inRepo.filter(([, s]) => s.state === "burned")) {
      expect(seal.burnedAt, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(seal.runSha, name).toMatch(/^[0-9a-f]{40}$/);
      expect(seal.report ?? "", name).toMatch(/^docs\/olcum\/stay-change-FINAL-eval-\d{4}-\d{2}-\d{2}\.md$/);
      expect(existsSync(path.join(REPO, seal.report ?? "")), `${name}: yakma raporu depoda yok`).toBe(true);
    }
  });

  it("harness mührü yalnız açık bayrak + gerçek model koşusunda okur (kısmi koşu mührü yakamaz)", () => {
    const src = readFileSync(path.join(REPO, "tests/eval/stay-change.eval.test.ts"), "utf8");
    expect(src).toContain('const SEALED = process.env.EVAL_SEALED_FINAL === "1";');
    const guard = src.indexOf('if (SEALED && !enabled) throw new Error("EVAL_SEALED_FINAL=1');
    const read = src.indexOf("const DATASET = SEALED ? SEALED_FILE");
    expect(guard).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(guard);
    // Mühürlü dosya başka hiçbir yoldan okunmaz (tek okuma DATASET üzerinden).
    expect(src.split("SEALED_FILE").length - 1).toBe(2); // tanım + DATASET seçimi
    // Normal test takımı bayrağı hiçbir koşulda set etmez.
    expect(readFileSync(path.join(REPO, "vitest.config.ts"), "utf8")).not.toContain("EVAL_SEALED_FINAL");
  });
});

describe("gerçek misafir mesajı seti (B) — depoya girmez", () => {
  it(".gitignore evals/private/ dizinini yok sayar ve orada TAKİP EDİLEN dosya yoktur", () => {
    expect(readFileSync(path.join(REPO, ".gitignore"), "utf8").split(/\r?\n/)).toContain("/evals/private/");
    // "Takip edilen" yalnız git ile bilinir; git yoksa dosya sistemi taraması kurucunun YEREL (yok sayılan) dosyalarını
    // da görür → o durumda yalnız .gitignore kuralı (↑) denetlenir.
    const tracked = trackedFiles();
    if (tracked) expect(tracked.filter((f) => f.startsWith("evals/private/"))).toEqual([]);
  });

  it("🚨 harness mühürlü A setini yalnız SHA + 'sealed' durumu eşleşirse koşar; mühürlü koşuda örnek sınırı YASAK (inceleme 09-24)", () => {
    const src = readFileSync(path.join(REPO, "tests/eval/stay-change.eval.test.ts"), "utf8");
    const state = src.indexOf('if (!seal || seal.state !== "sealed") throw new Error(');
    const sha = src.indexOf('if (createHash("sha256").update(datasetBytes).digest("hex") !== seal.sha256) throw new Error(');
    const limit = src.indexOf("if (process.env.EVAL_STAY_LIMIT) throw new Error(");
    const parse = src.indexOf('const base = JSON.parse(datasetBytes.toString("utf8"))');
    for (const [name, at] of Object.entries({ state, sha, limit, parse })) expect(at, name).toBeGreaterThan(-1);
    expect(Math.max(state, sha, limit)).toBeLessThan(parse); // denetimler içerik ayrıştırılmadan ÖNCE
  });

  it("harness gerçek seti yalnız mühürlü final koşusunda ve mühürle eşleşirse okur", () => {
    const src = readFileSync(path.join(REPO, "tests/eval/stay-change.eval.test.ts"), "utf8");
    expect(src).toContain('if (REAL_SET && !SEALED) throw new Error(');
    expect(src).toContain('seal.location !== "local-only" || seal.state !== "sealed"');
    expect(src).toContain("!== seal.sha256) throw new Error(");
  });
});
