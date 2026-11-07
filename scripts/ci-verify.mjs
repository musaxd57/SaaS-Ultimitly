#!/usr/bin/env node
// CI TEST RAPORU DENETİMİ — komut satırı (karar `scripts/ci-verify-core.mjs`). Kullanım:
//   node scripts/ci-verify.mjs meta <ad> <çıktı.json>              → raporun yanına commit kimliği (GITHUB_SHA) + deneme no
//   node scripts/ci-verify.mjs shard <i/n> <dizin>                 → tek veritabanlı grubun kendi raporu (kendi işinde)
//   node scripts/ci-verify.mjs nodb <dizin>                        → veritabanısız + süre ölçen kolun raporları
//   node scripts/ci-verify.mjs gate <dizin>                        → SON KAPI: bütün raporlar + `NEEDS_JSON` (işlerin sonucu)
//   node scripts/ci-verify.mjs baseline <dizin>                    → dosya başına atlanan test tabanını basar (bilinçli güncelleme için)
// Raporlar AÇIK adlarla okunur (`db-1.json` … `nodb.json`, `timing.json` + `<ad>.meta.json`); joker yok.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyReports, skippedPerFile } from "./ci-verify-core.mjs";
import { listTestFiles, partitionTestFiles } from "../tests/test-partition.mjs";
import { CI_DB_SHARDS, CI_REQUIRED_JOBS, dbShards, parseShard } from "../tests/ci-shards.mjs";

const root = process.cwd();
const [mode, a, b] = process.argv.slice(2);
const sha = process.env.GITHUB_SHA ?? "";
const readJson = (p) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
};
const report = (dir, name) => ({ label: name, json: readJson(join(dir, `${name}.json`)), meta: readJson(join(dir, `${name}.meta.json`)) });
// Atlanan test tabanı ZORUNLU: dosya yoksa / okunamıyorsa denetim kırmızıdır ("taban yok" = "hiç atlama yok" sayılıp sessizce gevşemesin).
const BASELINE_PATH = join(root, "tests/ci-skip-baseline.json");
function baseline() {
  const b = readJson(BASELINE_PATH);
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.values(b).some((n) => !Number.isInteger(n) || n < 0)) {
    console.log(`── KIRMIZI: ${BASELINE_PATH} yok ya da bozuk (dosya → atlanan test sayısı)`);
    process.exit(1);
  }
  return b;
}

function finish(res, label) {
  console.log(`── ${label}: ${res.ok ? "YEŞİL" : "KIRMIZI"} · dosya ${res.files} · test ${res.tests} · atlanan ${res.skipped}`);
  for (const e of res.errors) console.log(`  ✗ ${e}`);
  process.exitCode = res.ok ? 0 : 1;
}

if (mode === "meta") {
  writeFileSync(b, JSON.stringify({ label: a, sha, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null }));
} else if (mode === "shard") {
  const { index, total } = parseShard(a);
  const expected = dbShards(root, total)[index].files;
  const name = `db-${index + 1}`;
  finish(verifyReports({ expectedFiles: expected, reports: [report(b, name)], skipBaseline: baseline(), sha, root }), name);
} else if (mode === "nodb") {
  const p = partitionTestFiles(root);
  finish(verifyReports({ expectedFiles: [...p.nodb, ...p.timing], reports: [report(a, "nodb"), report(a, "timing")], skipBaseline: baseline(), sha, root }), "nodb+timing");
} else if (mode === "gate") {
  const names = [...Array.from({ length: CI_DB_SHARDS }, (_, i) => `db-${i + 1}`), "nodb", "timing"];
  let needs = null;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? "null");
  } catch {
    needs = { NEEDS_JSON: { result: "okunamadı" } };
  }
  if (!needs || typeof needs !== "object") needs = { NEEDS_JSON: { result: "yok" } };
  // Grupların dağıtımı da yeniden hesaplanır: kayıp dosya olamaz (birleşim = bütün veritabanlı dosyalar, kesişim boş).
  const shards = dbShards(root, CI_DB_SHARDS).flatMap((s) => s.files);
  const dbFiles = partitionTestFiles(root).db;
  const shardErrors = [];
  if (shards.length !== new Set(shards).size) shardErrors.push("dağıtımda iki gruba düşen dosya var");
  if (shards.length !== dbFiles.length || dbFiles.some((f) => !shards.includes(f))) shardErrors.push("dağıtım veritabanlı dosyaların tamamını kapsamıyor");
  const res = verifyReports({
    expectedFiles: listTestFiles(root),
    reports: names.map((n) => report(a, n)),
    skipBaseline: baseline(),
    sha,
    root,
    needs,
    requiredJobs: CI_REQUIRED_JOBS,
    checkBaselineFiles: true,
  });
  finish({ ...res, ok: res.ok && shardErrors.length === 0, errors: [...shardErrors, ...res.errors] }, "SON KAPI");
} else if (mode === "baseline") {
  const out = {};
  for (const n of [...Array.from({ length: CI_DB_SHARDS }, (_, i) => `db-${i + 1}`), "db", "nodb", "timing", "serial"]) {
    const j = readJson(join(a, `${n}.json`));
    if (j) Object.assign(out, skippedPerFile(j, root));
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2));
} else {
  console.error("kullanım: meta | shard | nodb | gate | baseline");
  process.exitCode = 2;
}
