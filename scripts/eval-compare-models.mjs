#!/usr/bin/env node
// ---------------------------------------------------------------------------
// MODEL KIYASI — aynı eval takımını İKİ (ya da daha çok) modelde koşar ve
// sonuçları YAN YANA basar.
//
// 🚨 NEDEN AYRI BİR KOŞUCU: `suggestReply` modeli `process.env.OPENAI_MODEL`ten
// okur ve bu değer SÜREÇ BAŞINA sabittir. Tek bir vitest süreci içinde modeli
// senaryolar arasında değiştirmek, ölçümü "hangi model hangi satırı koştu"
// belirsizliğine sokardı. Bu yüzden HER MODEL AYRI SÜREÇ: kanıt zinciri
// (commit · istem parmak izi · KB parmak izi) her koşuda kendi raporuna yazılır,
// bu betik yalnız ONLARI birleştirir.
//
// 🚨 KIYAS MARKDOWN PARSE ETMEZ: her koşu `tests/eval/sidecar.ts` üzerinden bir
// JSON yan-dosya yazar ve yolunu stdout'a basar. Bu betik o yolu okur.
//
// KULLANIM:
//   RUN_REAL_EVAL=1 OPENAI_API_KEY=... \
//   node scripts/eval-compare-models.mjs gpt-5.1 gpt-5.6-luna
//
// 🚨 ÜCRETLİ: her model için TÜM senaryolar gerçek model çağrısıdır. Betik
// başlamadan önce kaç çağrı yapacağını yazar ve `EVAL_COMPARE_YES=1` yoksa
// onay bekler — sessizce para harcamaz.
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "docs/olcum");
const DATA_MARKER = "[eval] DATA=";
const REPORT_MARKER = "[eval] REPORT=";

const models = process.argv.slice(2).filter(Boolean);
if (models.length < 2) {
  console.error("Kullanım: node scripts/eval-compare-models.mjs <model-a> <model-b> [...]");
  console.error("En az iki model gerekir; kıyasın anlamı budur.");
  process.exit(2);
}
if (process.env.RUN_REAL_EVAL !== "1") {
  console.error("RUN_REAL_EVAL=1 ŞART — bu betik GERÇEK model çağrısı yapar.");
  process.exit(2);
}
const key = (process.env.OPENAI_API_KEY ?? "").trim();
if (key.length <= 20 || key.startsWith("test-")) {
  console.error("Gerçek bir OPENAI_API_KEY yok — koşu sessizce ATLANIR, o yüzden burada duruyoruz.");
  process.exit(2);
}

/** Senaryo sayısını DATASET'ten okur; "kaç çağrı" uyarısı tahmin değil ÖLÇÜ olsun. */
function scenarioCount() {
  try {
    const qr = JSON.parse(readFileSync(path.join(ROOT, "evals/qr-kb-coverage.json"), "utf8"));
    const paired = JSON.parse(readFileSync(path.join(ROOT, "evals/kb-retrieval-paired.json"), "utf8"));
    // eşleştirilmiş takım her senaryoyu İKİ modda koşar.
    return qr.scenarios.length + paired.scenarios.length * 2;
  } catch {
    return null;
  }
}

const perModel = scenarioCount();
const total = perModel === null ? null : perModel * models.length;
console.log(`Modeller: ${models.join(", ")}`);
console.log(
  total === null
    ? "🚨 Senaryo sayısı okunamadı — çağrı sayısı bilinmiyor."
    : `🚨 GERÇEK MODEL ÇAĞRISI: model başına ${perModel}, toplam ${total}. Bu ÜCRETLİDİR.`,
);

if (process.env.EVAL_COMPARE_YES !== "1") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question("Devam edilsin mi? (evet/hayır) ", res));
  rl.close();
  if (!/^(e|evet|y|yes)$/i.test(answer.trim())) {
    console.log("İptal edildi. Hiçbir çağrı yapılmadı.");
    process.exit(0);
  }
}

/** Bir modeli koşar, ürettiği JSON yan-dosyalarının yollarını döndürür. */
function runModel(model) {
  console.log(`\n──────── ${model} ────────`);
  const res = spawnSync("npm", ["run", "eval"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, OPENAI_MODEL: model },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  process.stdout.write(out);
  const dataPaths = [...out.matchAll(new RegExp(`${DATA_MARKER.replace(/[[\]]/g, "\\$&")}(.+)`, "g"))].map((m) => m[1].trim());
  const reportPaths = [...out.matchAll(new RegExp(`${REPORT_MARKER.replace(/[[\]]/g, "\\$&")}(.+)`, "g"))].map((m) => m[1].trim());
  return { model, exitCode: res.status, dataPaths, reportPaths };
}

const runs = [];
for (const m of models) runs.push(runModel(m));

// ── Sonuçları OKU ──────────────────────────────────────────────────────────
// 🚨 EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ (eval sözleşmesinin aynısı): bir model
// hiç yan-dosya bırakmadıysa satırları BOŞ değil BİLİNMİYOR sayılır.
const bySuite = new Map(); // suiteName -> Map(model -> rows[])
const missing = [];
for (const r of runs) {
  if (r.dataPaths.length === 0) {
    missing.push(`${r.model}: yan-dosya yok (çıkış kodu ${r.exitCode})`);
    continue;
  }
  for (const p of r.dataPaths) {
    if (!existsSync(p)) {
      missing.push(`${r.model}: ${p} bulunamadı`);
      continue;
    }
    const payload = JSON.parse(readFileSync(p, "utf8"));
    if (!bySuite.has(payload.suite)) bySuite.set(payload.suite, new Map());
    bySuite.get(payload.suite).set(r.model, payload);
  }
}

function cell(row) {
  if (!row) return "—";
  if (row.outcome === "ok") return "✅";
  if (row.outcome === "invalid") return `⚠️ geçersiz`;
  return `❌ ${row.failures?.length ?? "?"}`;
}

const now = new Date();
const stamp = now.toISOString().slice(0, 10);
const runId = `${now.toISOString().slice(11, 19).replace(/:/g, "")}`;
let md = `# MODEL KIYASI — ${models.join(" vs ")} (${stamp})\n\n`;
md += `> \`scripts/eval-compare-models.mjs\` tarafından ÜRETİLİR; elle yazılmaz.\n`;
md += `> Her model AYRI SÜREÇTE koştu; kanıt zinciri kendi raporunda.\n\n`;
if (missing.length > 0) {
  md += `> 🚨 **BU KIYAS EKSİK** — ${missing.length} koşu sonuç bırakmadı:\n`;
  for (const m of missing) md += `> - ${m}\n`;
  md += `\n`;
}
md += `## Koşu dosyaları\n\n| Model | Çıkış kodu | Raporlar |\n|---|---|---|\n`;
for (const r of runs) {
  md += `| \`${r.model}\` | ${r.exitCode} | ${r.reportPaths.map((p) => path.basename(p)).join(", ") || "—"} |\n`;
}

for (const [suiteName, byModel] of bySuite) {
  md += `\n## ${suiteName}\n\n`;
  const modelsHere = [...byModel.keys()];
  const ids = [...new Set(modelsHere.flatMap((m) => byModel.get(m).rows.map((x) => x.id)))];
  md += `| Senaryo | ${modelsHere.map((m) => `\`${m}\``).join(" | ")} |\n|${"---|".repeat(modelsHere.length + 1)}\n`;
  for (const id of ids) {
    const cells = modelsHere.map((m) => cell(byModel.get(m).rows.find((x) => x.id === id)));
    md += `| ${id} | ${cells.join(" | ")} |\n`;
  }
  md += `\n**Özet**\n\n| Model | geçti | düştü | geçersiz |\n|---|---|---|---|\n`;
  for (const m of modelsHere) {
    const rs = byModel.get(m).rows;
    md += `| \`${m}\` | ${rs.filter((x) => x.outcome === "ok").length} | ${rs.filter((x) => x.outcome === "failed_checks").length} | ${rs.filter((x) => x.outcome === "invalid").length} |\n`;
  }
  md += `\n**Ayrışan satırlar** (modeller AYNI sonucu vermedi — kararın verildiği yer burasıdır)\n\n`;
  const diverging = ids.filter((id) => new Set(modelsHere.map((m) => byModel.get(m).rows.find((x) => x.id === id)?.outcome ?? "yok")).size > 1);
  if (diverging.length === 0) {
    md += `Yok — tüm senaryolarda aynı sonuç.\n`;
  } else {
    for (const id of diverging) {
      md += `\n### ${id}\n\n`;
      for (const m of modelsHere) {
        const row = byModel.get(m).rows.find((x) => x.id === id);
        md += `- \`${m}\`: ${cell(row)}${row?.failures?.length ? ` — ${row.failures.join("; ")}` : ""}\n`;
      }
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
let name = `eval-model-kiyas-${stamp}.md`;
if (existsSync(path.join(OUT_DIR, name))) name = `eval-model-kiyas-${stamp}-${runId}.md`;
const outPath = path.join(OUT_DIR, name);
writeFileSync(outPath, md, "utf8");
console.log(`\nKIYAS RAPORU: ${outPath}`);
// 🚨 Eksik koşu varsa ÇIKIŞ KODU 1 — CI/otomasyon "geçti" sanmasın.
process.exit(missing.length > 0 ? 1 : 0);
