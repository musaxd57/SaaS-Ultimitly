#!/usr/bin/env node
// PARALEL TEST KAPISI (kurucu 10-16): `npm test`.
//   1) `prisma generate` (eski `npm test` ile aynı ön adım)
//   2) veritabanlı kol (tek sıra, PostgreSQL) + veritabanısız kol (N işçi) AYNI ANDA
//   3) iki kol bitince süre ölçen kol (tek sıra, makine boşken)
// Herhangi bir kol kırmızıysa çıkış kodu 1 (kalan kollar yine koşar — bütün kırmızılar tek seferde görünür).
// Geri dönüş: `npm run test:serial` (eski seri düzen, ana `vitest.config.ts`, değişmedi).
// İşçi sayısı: `TEST_NODB_WORKERS` (varsayılan `vitest.nodb.config.ts` içinde).
//   4) RAPOR DENETİMİ (11-13, CI 1797): her kol vitest JSON raporu da yazar (`<dizin>/db.json`, `nodb.json`, `timing.json`); üç kol bitince
//      CI son kapısının AYNI karar fonksiyonu koşar (`scripts/test-gate-verify.mjs`): dosya başına atlanan test tabanı
//      (`tests/ci-skip-baseline.json`), kayıp / fazladan / hiç test koşmayan dosya. Testler yeşil ama denetim kırmızıysa çıkış kodu yine 1 —
//      yeni bir atlanan test push'tan ÖNCE görünür. Dizin: `TEST_REPORT_DIR` (CI'da eski / gruplu düzen karşılaştırması da bunu okur —
//      `scripts/ci-compare-layouts.mjs`); verilmezse geçici dizin. Akışın kendisi (`runGate`) `test-gate-verify.mjs` içinde ve testlidir;
//      bu dosya yalnız gerçek süreç başlatıcıyı verir.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { listTestFiles } from "../tests/test-partition.mjs";
import { runGate } from "./test-gate-verify.mjs";

const VITEST = "node_modules/.bin/vitest";

// Dizin verilmediyse kapı kendi geçici dizinini açar ve YEŞİL koşuda siler (raporlar megabaytlarca; her koşuda birikmesin). Kırmızıda
// bırakır: yolu özetin "rapor" satırında yazar.
const OWN_REPORT_DIR = !process.env.TEST_REPORT_DIR?.trim();
const REPORT_DIR = OWN_REPORT_DIR ? mkdtempSync(join(tmpdir(), "test-gate-")) : process.env.TEST_REPORT_DIR.trim();
mkdirSync(REPORT_DIR, { recursive: true });

function run(label, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const reporters = ["--reporter=default", "--reporter=json", `--outputFile.json=${REPORT_DIR}/${label}.json`];
    const child = spawn(VITEST, ["run", ...args, ...reporters], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const prefix = (stream, out) =>
      createInterface({ input: stream }).on("line", (line) => out.write(`[${label}] ${line}\n`));
    prefix(child.stdout, process.stdout);
    prefix(child.stderr, process.stderr);
    child.on("close", (code, signal) => resolve({ label, code: code ?? 1, signal, seconds: Math.round((Date.now() - t0) / 1000) }));
  });
}

const gen = spawnSync("node_modules/.bin/prisma", ["generate"], { stdio: "inherit", env: process.env });
if (gen.status !== 0) process.exit(gen.status ?? 1);

const ARM_CONFIG = { db: "vitest.db.config.ts", nodb: "vitest.nodb.config.ts", timing: "vitest.timing.config.ts" };
const root = process.cwd();
const { code } = await runGate({
  runArm: (label) => run(label, ["-c", ARM_CONFIG[label]]),
  reportDir: REPORT_DIR,
  root,
  expectedFiles: listTestFiles(root),
  baselinePath: join(root, "tests/ci-skip-baseline.json"),
  log: (line) => console.log(line),
  workers: process.env.TEST_NODB_WORKERS,
});
if (OWN_REPORT_DIR && code === 0) rmSync(REPORT_DIR, { recursive: true, force: true });
process.exit(code);
