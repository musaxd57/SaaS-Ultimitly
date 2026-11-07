#!/usr/bin/env node
// Grup dengesi için dosya süreleri (`tests/ci-shard-weights.json`) — vitest JSON raporlarından. Kullanım:
//   node scripts/ci-shard-weights.mjs <rapor.json> [<rapor.json> …]
// Yalnız DENGEYİ etkiler, kapsamı asla (`tests/ci-shards.mjs`). Ağırlıklar saniye, 0,1 hassasiyet.
import { readFileSync, writeFileSync } from "node:fs";
import { relativeTestPath } from "./ci-verify-core.mjs";
import { partitionTestFiles } from "../tests/test-partition.mjs";

const db = new Set(partitionTestFiles().db);
const out = {};
for (const p of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(p, "utf8")).testResults ?? []) {
    const f = relativeTestPath(r.name, process.cwd());
    if (db.has(f) && r.endTime > r.startTime) out[f] = Math.round((r.endTime - r.startTime) / 100) / 10;
  }
}
writeFileSync("tests/ci-shard-weights.json", `${JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 1)}\n`);
console.log(`${Object.keys(out).length} dosya, toplam ${Math.round(Object.values(out).reduce((a, b) => a + b, 0))} sn`);
