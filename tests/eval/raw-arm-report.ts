import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RAW_DEV_SETS, renderRawReport, reportLabel, scoreRawSet, type RawDevSet, type RawRow, type RawSetScore } from "./raw-arm-score";

// ---------------------------------------------------------------------------
// HAM MODEL KOLU — RAPOR (komut satırı; model ÇAĞIRMAZ, ücretsiz).
//
//   npx tsx tests/eval/raw-arm-report.ts <ham çıktı dizini> [etiket] [çıktı dizini]
//
// <ham çıktı dizini>: `<set>.json` dosyaları (`scripts/claude-work/run.ts` `raw_baseline` üretir). Etiket rapor adına girer (ör. model adı);
// çıktı dizini verilmezse `docs/olcum`. Yazılanlar: `raw-arm-<gün>-<etiket>.md` + `.json` (ayrıntı).
//
// Karar burada DEĞİL: puanlama ve rapor metni `raw-arm-score.ts` (saf, pinli). Bu dosya yalnız okur, yazar ve çıkış kodunu verir.
// Çıkış 1: dizinde hiç ham çıktı yok (klasör adı yanlış olabilir) ya da bir setin tek senaryosu bile puanlanamadı.
// 🚨 Yalnız `RAW_DEV_SETS` içindeki geliştirme setleri okunur; set adı komut satırından ALINMAZ (mühürlü / kör set bu yoldan açılamaz).
// ---------------------------------------------------------------------------

const [rawDirArg, labelArg, outDirArg] = process.argv.slice(2);
if (!rawDirArg) {
  console.error("kullanım: npx tsx tests/eval/raw-arm-report.ts <ham çıktı dizini> [etiket] [çıktı dizini]");
  process.exit(2);
}
const rawDir = path.resolve(rawDirArg);
const label = reportLabel(labelArg);
const outDir = outDirArg ? path.resolve(outDirArg) : path.join(process.cwd(), "docs", "olcum");

const scores: Record<string, RawSetScore | null> = {};
for (const set of RAW_DEV_SETS) {
  const rawPath = path.join(rawDir, `${set}.json`);
  if (!existsSync(rawPath)) {
    scores[set] = null;
    continue;
  }
  const data = JSON.parse(readFileSync(path.join(process.cwd(), "evals", `${set}.json`), "utf8")) as RawDevSet;
  const rows = JSON.parse(readFileSync(rawPath, "utf8")) as RawRow[];
  scores[set] = scoreRawSet(data, rows);
}

const report = renderRawReport(label, scores);
console.log(report.lines.join("\n"));
if (report.scoredSets === 0 && report.emptySets.length === 0) {
  console.error(`ham çıktı bulunamadı: ${rawDir}`);
  process.exit(1);
}
if (report.emptySets.length > 0) {
  console.error(`puanlanan senaryo yok: ${report.emptySets.join(", ")}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const base = `raw-arm-${new Date().toISOString().slice(0, 10)}-${label}`;
writeFileSync(path.join(outDir, `${base}.md`), `${report.lines.join("\n")}\n`, "utf8");
writeFileSync(path.join(outDir, `${base}.json`), `${JSON.stringify(report.sidecar, null, 2)}\n`, "utf8");
console.log(`\nyazıldı: ${path.join(outDir, base)}.md + .json`);
