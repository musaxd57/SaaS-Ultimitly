#!/usr/bin/env node
// ESKİ ↔ YENİ DÜZEN KARŞILAŞTIRMASI (kurucu 10-31: "aynı commit üzerinde eski ve yeni düzeni karşılaştır"). Kullanım:
//   node scripts/ci-compare-layouts.mjs <eski-dizin> <yeni-dizin>
// Eski dizin: `db.json`, `nodb.json`, `timing.json` (`TEST_REPORT_DIR` ile `npm test`); yeni dizin: `db-1..3.json`, `nodb.json`, `timing.json`.
// Dosya kümesi ve dosya başına geçen / atlanan / başarısız test sayısı AYNI olmalı; fark varsa adıyla basar ve çıkış 1.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { relativeTestPath } from "./ci-verify-core.mjs";

const [oldDir, newDir] = process.argv.slice(2);
const root = process.cwd();
function load(dir, names) {
  const out = new Map();
  for (const n of names) {
    const p = join(dir, `${n}.json`);
    if (!existsSync(p)) {
      console.log(`✗ ${p} yok`);
      process.exitCode = 1;
      continue;
    }
    for (const r of JSON.parse(readFileSync(p, "utf8")).testResults ?? []) {
      const c = { passed: 0, skipped: 0, failed: 0 };
      for (const a of r.assertionResults ?? []) {
        if (a.status === "passed") c.passed++;
        else if (a.status === "failed") c.failed++;
        else c.skipped++;
      }
      out.set(relativeTestPath(r.name, root), c);
    }
  }
  return out;
}
const a = load(oldDir, ["db", "nodb", "timing"]);
const b = load(newDir, ["db-1", "db-2", "db-3", "nodb", "timing"]);
let diffs = 0;
for (const f of new Set([...a.keys(), ...b.keys()])) {
  const x = a.get(f);
  const y = b.get(f);
  if (!x || !y || x.passed !== y.passed || x.skipped !== y.skipped || x.failed !== y.failed) {
    diffs++;
    console.log(`✗ ${f}: eski ${JSON.stringify(x ?? "yok")} · yeni ${JSON.stringify(y ?? "yok")}`);
  }
}
const sum = (m) => [...m.values()].reduce((s, c) => ({ passed: s.passed + c.passed, skipped: s.skipped + c.skipped, failed: s.failed + c.failed }), { passed: 0, skipped: 0, failed: 0 });
console.log(`eski: ${a.size} dosya ${JSON.stringify(sum(a))} · yeni: ${b.size} dosya ${JSON.stringify(sum(b))} · fark: ${diffs}`);
if (diffs > 0) process.exitCode = 1;
