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
//      `scripts/ci-compare-layouts.mjs`); verilmezse geçici dizin.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { listTestFiles } from "../tests/test-partition.mjs";
import { gateExitCode, verifyLocalGate } from "./test-gate-verify.mjs";

const VITEST = "node_modules/.bin/vitest";

const REPORT_DIR = process.env.TEST_REPORT_DIR?.trim() || mkdtempSync(join(tmpdir(), "test-gate-"));
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

const t0 = Date.now();
const parallel = await Promise.all([run("db", ["-c", "vitest.db.config.ts"]), run("nodb", ["-c", "vitest.nodb.config.ts"])]);
const timing = await run("timing", ["-c", "vitest.timing.config.ts"]);
const results = [...parallel, timing];
const total = Math.round((Date.now() - t0) / 1000);

console.log("\n── Test kapısı özeti ──");
for (const r of results) console.log(`${r.label.padEnd(7)} ${r.code === 0 ? "yeşil" : `KIRMIZI (çıkış ${r.code}${r.signal ? `, ${r.signal}` : ""})`}  ${r.seconds} sn`);
console.log(`toplam  ${total} sn  (işçi: ${process.env.TEST_NODB_WORKERS || "varsayılan"})`);

const root = process.cwd();
const verify = verifyLocalGate({ reportDir: REPORT_DIR, root, expectedFiles: listTestFiles(root), baselinePath: join(root, "tests/ci-skip-baseline.json") });
console.log(`rapor   ${verify.ok ? "yeşil" : "KIRMIZI"}  dosya ${verify.files} · test ${verify.tests} · atlanan ${verify.skipped}  (${REPORT_DIR})`);
for (const e of verify.errors) console.log(`  ✗ ${e}`);
process.exit(gateExitCode(results, verify));
