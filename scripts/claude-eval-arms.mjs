// Claude ölçüm iş akışının (claude-eval.yml) koşucusu. `evals/claude-run-request.json`:
//   · `suite` (vitest yol öneki) + isteğe bağlı `env` (bütün kollara ortak ortam) + isteğe bağlı `arms` (kol başına ortam, sırayla koşar).
//   · `arms` yoksa tek koşu (eski davranış). Kol başarısız olsa da sıradaki koşar (ölçüm; kalite kapısı değil) — çıkış kodu ilk hatanınki.
// Sonra rapor dosyaları (claude-zorlu-* ve Claude kollu model kıyası) günlüğe basılır; yan dosyadan satır özeti (cevap metniyle) yazılır.
import { readFileSync, readdirSync, appendFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const req = JSON.parse(readFileSync("evals/claude-run-request.json", "utf8"));
const suite = req.suite ?? "tests/eval/claude-adversarial.eval.test.ts";
const common = Object.fromEntries(Object.entries(req.env ?? {}).map(([k, v]) => [k, String(v)]));
const arms = Array.isArray(req.arms) && req.arms.length > 0 ? req.arms : [{}];
if (arms.length > 8) throw new Error("en çok 8 kol (ücret)");

let exit = 0;
const started = Date.now();
for (const [i, arm] of arms.entries()) {
  // Kol kendi ölçerini `suite` ile seçebilir (10-31: anlama + karar metni aynı istekte); `suite` ortama GİRMEZ.
  const { suite: armSuite, ...armEnv } = arm;
  const env = { ...process.env, ...common, ...Object.fromEntries(Object.entries(armEnv).map(([k, v]) => [k, String(v)])) };
  console.log(`===== kol ${i + 1}/${arms.length}: ${JSON.stringify(arm)} =====`);
  const r = spawnSync("npx", ["vitest", "run", "--config", "vitest.eval.config.ts", armSuite ?? suite], { env, stdio: "inherit" });
  if (r.status !== 0 && exit === 0) exit = r.status ?? 1;
}

const dir = "docs/olcum";
// Bu koşuda YAZILAN her rapor (eski kalıp: claude-zorlu-* / Claude kollu cevap kıyası; 10-31: hangi ölçer olursa olsun yeni .md).
const files = readdirSync(dir).filter((f) => f.endsWith(".md") && statSync(`${dir}/${f}`).mtimeMs >= started);
for (const f of files) {
  const text = readFileSync(`${dir}/${f}`, "utf8");
  console.log(`===== ${f} =====\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${text}\n`);
  const side = `${dir}/${f.replace(/\.md$/, ".json")}`;
  try {
    const rows = JSON.parse(readFileSync(side, "utf8")).rows ?? [];
    console.log(`===== SATIRLAR ${f} =====`);
    for (const r of rows) {
      console.log(JSON.stringify({ id: r.id, cls: r.cls, ok: r.ok, auto: r.auto, gate: r.gate, facts: r.facts, fs: r.factsStrict?.ok ?? null, u: r.u, p: r.promise, lang: r.langOk, ms: r.ms, reply: r.reply }));
    }
  } catch {
    /* yan dosya yoksa yalnız rapor */
  }
}
process.exit(exit);
