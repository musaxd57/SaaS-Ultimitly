// CI VERİTABANLI TEST GRUPLARI (kurucu 10-31, `docs/TASARIM-2026-10-31-ci-paralel-test.md`). SAF.
// Veritabanlı dosyalar (TEK kaynak `partitionTestFiles().db`) N gruba "en uzun önce" (LPT) dağıtılır: ölçülmüş dosya süreleri
// (`tests/ci-shard-weights.json`) dengeyi belirler, KAPSAMI ASLA — süresi bilinmeyen dosya ortanca ağırlıkla yine bir gruba düşer.
// Eşitlikte dosya adı (belirlenimci: her iş ve son kapı aynı dağıtımı yeniden hesaplar).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { partitionTestFiles } from "./test-partition.mjs";

export const CI_DB_SHARDS = 3;
/** Son kapının (`verify`) sonucunu ŞART koştuğu işler — `.github/workflows/ci.yml` `verify.needs` ile aynı (pin: `ci-workflow-shards.test.ts`). */
export const CI_REQUIRED_JOBS = ["test-db", "test-nodb"];

/** `"2/3"` → { index: 1, total: 3 }; geçersizse fırlatır (yanlış biçimli grup sessizce boş koşmasın). */
export function parseShard(spec) {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(spec ?? "").trim());
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`TEST_DB_SHARD geçersiz: ${JSON.stringify(spec)} (beklenen "i/n", 1 ≤ i ≤ n)`);
  return { index: Number(m[1]) - 1, total: Number(m[2]) };
}

/**
 * LPT dağıtımı: her dosya TAM BİR gruba.
 * @param {string[]} files
 * @param {Record<string, number>} weights
 * @param {number} total
 * @returns {{ files: string[], load: number }[]}
 */
export function assignShards(files, weights, total) {
  const known = files.map((f) => weights[f]).filter((w) => typeof w === "number" && w > 0).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const w = (f) => (typeof weights[f] === "number" && weights[f] > 0 ? weights[f] : median);
  const order = [...files].sort((a, b) => w(b) - w(a) || (a < b ? -1 : a > b ? 1 : 0));
  const groups = Array.from({ length: total }, () => ({ files: /** @type {string[]} */ ([]), load: 0 }));
  for (const f of order) {
    let best = 0;
    for (let i = 1; i < total; i++) if (groups[i].load < groups[best].load) best = i;
    groups[best].files.push(f);
    groups[best].load += w(f);
  }
  return groups.map((g) => ({ files: g.files.sort(), load: g.load }));
}

export function readShardWeights(root = process.cwd()) {
  const p = join(root, "tests/ci-shard-weights.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

/** Bu commit'teki veritabanlı dosyaların N gruba dağıtımı. */
export function dbShards(root = process.cwd(), total = CI_DB_SHARDS) {
  return assignShards(partitionTestFiles(root).db, readShardWeights(root), total);
}
