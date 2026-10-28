// Decisions API olasılıklarından karar (eşik). Saf; ağ yok. Kullanım:
//   node 7d-decisions-esik.mjs <decisions-sonucu.json> <çıktı-model-sonucu.json> <tauRisk> <tauNeed>
// Çıktı `7d-model-kolu.mjs` sonuç biçimindedir (`final`), `7d-puan.mjs` ile aynı kod kurallarıyla puanlanır.
// Kural: risk = max(open_issue, contradiction, wrong_target, time_shift, content_problem). Gönderim YALNIZ still_needed ≥ tauNeed VE
// risk ≤ tauRisk iken; still_needed < tauNeed → hold (gereksiz); risk yüksek → open_editor. Araya mesaj girdiyse (direct < 0,5) bağlaçla,
// metin kendi başına anlaşılmıyorsa (self_contained < 0,5) düzenleyici.
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath, tauRiskArg, tauNeedArg] = process.argv;
const tauRisk = Number(tauRiskArg);
const tauNeed = Number(tauNeedArg);
const src = JSON.parse(readFileSync(inPath, "utf8"));
const RISKS = ["open_issue", "contradiction", "wrong_target", "time_shift", "content_problem"];

export function decide(p, tr, tn) {
  if (!p) return "open_editor";
  const risk = Math.max(...RISKS.map((k) => p[k] ?? 1));
  if ((p.still_needed ?? 0) < tn) return "hold";
  if (risk > tr) return "open_editor";
  if ((p.direct ?? 0) >= 0.5) return "send";
  return (p.self_contained ?? 0) >= 0.5 ? "send_with_anchor" : "open_editor";
}

const results = src.results.map((r) => ({ id: r.id, final: decide(r.p, tauRisk, tauNeed), raw: { reason: `decisions risk≤${tauRisk} need≥${tauNeed}` }, p: r.p }));
writeFileSync(outPath, JSON.stringify({ set: src.set, model: `decisions(gpt-6-luna) τr=${tauRisk} τn=${tauNeed}`, results }, null, 1));
