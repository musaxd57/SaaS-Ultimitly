import { writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeFailure, failureAnalysisMarkdown, type FailureAnalysis } from "./failure-analysis";
import { rerunUnderstanding, understandingExplainer } from "./failure-analysis-understanding";
import { semanticModel } from "@/lib/ai/semantic/config";
import { evalRuntime, evalRuntimeMarkdown } from "./run-meta";

// ---------------------------------------------------------------------------
// ACİL NUMARA ÖLÇÜMÜ → NEDEN ANALİZİ (`failure-analysis.ts` döngüsü; kurucu 10-11: "bundan sonra hata olunca hemen nedenini gör").
// Ölçüm kuralı: anlama niyetlerinden biri complaint_issue / cancellation_refund / human_request → hold, aksi → give. Yanlış ayrılan her
// SENARYO (tekrarlar tekilleşir) için: modelin açıklaması + karşı deneme + düzeltme katmanı önerisi. Tavan `EVAL_EXPLAIN_MAX_CASES`
// (varsayılan 5); `EVAL_EXPLAIN_FAILURES=0` kapatır. Rapor docs/olcum altına `<koşu>-neden.{md,json}` (koşu kimliğiyle).
// ---------------------------------------------------------------------------

export const HOLD_KINDS = new Set(["complaint_issue", "cancellation_refund", "human_request"]);
/** ÜRÜNÜN kuralı (`ai/emergency-number.ts`): niyetlerden HERHANGİ biri şikâyet / iade / insan talebi → hold (yalnız en öncelikli değil). */
export const decisionOf = (intents: readonly string[]) => (intents.some((i) => HOLD_KINDS.has(i)) ? "hold" : "give");

export interface MeasuredRow {
  id: string;
  expect: string;
  intents: string[];
  decision: string;
}

export function explainFailuresEnabled(): boolean {
  return process.env.EVAL_EXPLAIN_FAILURES !== "0";
}

export async function analyzeEmergencyFailures(
  rows: readonly MeasuredRow[],
  textOf: (id: string) => string | undefined,
  outStem: string,
  outDir: string,
): Promise<FailureAnalysis[]> {
  const max = Math.max(0, Math.min(20, Number(process.env.EVAL_EXPLAIN_MAX_CASES ?? "5") || 5));
  // Hata ürünün kuralıyla yeniden hesaplanır (saklı `decision` eski "en öncelikli niyet" kuralıyla yazılmış olabilir — ilk denemede
  // doğru ayrılan h2 / h3 / h5 bu yüzden listeye girmişti).
  const wrong = rows.filter((r) => r.expect !== "either" && r.decision !== "fail" && decisionOf(r.intents) !== r.expect);
  const firstPerId = [...new Map(wrong.map((r) => [r.id, r])).values()].slice(0, max);
  const explain = understandingExplainer((c) =>
    c.expected === "hold"
      ? "Ev sahibine bırakılmalı: ev sahibi şikâyeti / iade / insan talebi (complaint_issue / cancellation_refund / human_request) etiketlerinden en az biri."
      : "Numara verilebilir: ev sahibi şikâyeti / iade / insan talebi etiketi OLMAMALI.",
  );
  const results: FailureAnalysis[] = [];
  for (const r of firstPerId) {
    const text = textOf(r.id);
    if (!text) continue;
    results.push(
      await analyzeFailure(
        { id: r.id, text, observed: r.intents, expected: r.expect },
        {
          run: rerunUnderstanding,
          isCorrect: (intents) => decisionOf(intents) === r.expect,
          show: (intents) => `[${intents.join(", ")}] → ${decisionOf(intents)}`,
          explain,
          reps: 2,
          maxAblations: 5,
        },
      ),
    );
  }
  const meta = evalRuntime();
  writeFileSync(path.join(outDir, `${outStem}-neden.json`), JSON.stringify({ meta, model: semanticModel("understanding"), results }, null, 1));
  writeFileSync(
    path.join(outDir, `${outStem}-neden.md`),
    failureAnalysisMarkdown(
      `Acil numara — hata nedeni analizi (${semanticModel("understanding")})`,
      `${evalRuntimeMarkdown(meta)}\n\nKaynak koşu: \`${outStem}.json\`. Ölçüm kuralı: şikâyet / iade / insan talebi niyetinden biri → hold, aksi → give.`,
      results,
    ),
  );
  return results;
}
