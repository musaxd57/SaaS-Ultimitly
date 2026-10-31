#!/usr/bin/env node
// PARALEL TEST KAPISI (kurucu 10-16): `npm test`.
//   1) `prisma generate` (eski `npm test` ile aynı ön adım)
//   2) veritabanlı kol (tek sıra, PostgreSQL) + veritabanısız kol (N işçi) AYNI ANDA
//   3) iki kol bitince süre ölçen kol (tek sıra, makine boşken)
// Herhangi bir kol kırmızıysa çıkış kodu 1 (kalan kollar yine koşar — bütün kırmızılar tek seferde görünür).
// Geri dönüş: `npm run test:serial` (eski seri düzen, ana `vitest.config.ts`, değişmedi).
// İşçi sayısı: `TEST_NODB_WORKERS` (varsayılan `vitest.nodb.config.ts` içinde).
// `TEST_REPORT_DIR` verilirse her kol ayrıca vitest JSON raporu yazar (`<dizin>/db.json`, `nodb.json`, `timing.json`) — CI'da eski düzen ile
// gruplu düzenin aynı commit'te karşılaştırılması için (`scripts/ci-compare-layouts.mjs`); verilmezse davranış AYNEN eskisi.
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const VITEST = "node_modules/.bin/vitest";

const REPORT_DIR = process.env.TEST_REPORT_DIR?.trim();

function run(label, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const reporters = REPORT_DIR ? ["--reporter=default", "--reporter=json", `--outputFile.json=${REPORT_DIR}/${label}.json`] : [];
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
process.exit(results.every((r) => r.code === 0) ? 0 : 1);
