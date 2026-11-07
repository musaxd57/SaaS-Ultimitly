import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectRiskTypes } from "@/lib/ai/fallback";
import { hazardEvidenceOf } from "@/lib/ai/hazard-evidence";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";

// ---------------------------------------------------------------------------
// MİZAH / MÜBALAĞA / ALAY ÖLÇÜMÜ (kurucu 10-22: "model espri anlayışı olarak iyi mi test edebilirsin"). Set: `evals/humor-exaggeration.json`.
// Her mesajda iki okuma yan yana: KELİME KURALLARI (`detectRiskTypes`, `hazardEvidenceOf`) ve ANLAMA MODELİ (`understandGuestMessages`,
// gerçek model). Beklenen: mecaz / abartı acil ya da şikâyet SAYILMAZ; alaylı şikâyet ŞİKÂYETTİR; gülme işaretiyle yazılmış gerçek tehlike
// ACİLDİR. Sonuç `EVAL_HUMOR_OUT`a yazılır, özet basılır. Koşul: RUN_REAL_EVAL=1 + OPENAI_API_KEY + EVAL_HUMOR_OUT. Bütçe: vaka başına bir küçük çağrı.
// ---------------------------------------------------------------------------

const OUT = process.env.EVAL_HUMOR_OUT;
const run = process.env.RUN_REAL_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(OUT);

describe.skipIf(!run)("MİZAH / MÜBALAĞA — kelime kuralı ile anlama modeli yan yana (gerçek model)", () => {
  it(
    "her vakada iki okuma",
    async () => {
      process.env.AI_UNDERSTANDING_ENABLED = "1";
      const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/humor-exaggeration.json"), "utf8")) as {
        cases: { id: string; text: string; emergency: boolean | null; complaint: boolean | null; ask: string }[];
      };
      const rows = [];
      const tally = { lexEmergencyWrong: 0, lexComplaintWrong: 0, modelEmergencyWrong: 0, modelComplaintWrong: 0, modelFailed: 0 };
      for (const c of set.cases) {
        const lex = detectRiskTypes(c.text);
        const hazard = hazardEvidenceOf(c.text);
        const lexEmergency = lex.includes("safety_emergency") || hazard.level === "clear";
        const lexComplaint = lex.includes("complaint");
        const u = await understandGuestMessages({ guestMessage: c.text });
        const value = u.status === "ok" ? u.value : null;
        if (!value) tally.modelFailed++;
        const risk = understandingRiskOf(value);
        const modelEmergency = risk === "emergency";
        const modelComplaint = risk === "complaint_issue" || Boolean(value?.requests.some((r) => r.intent === "complaint_issue"));
        // null = iki cevap da kabul.
        if (c.emergency !== null && lexEmergency !== c.emergency) tally.lexEmergencyWrong++;
        if (c.complaint !== null && lexComplaint !== c.complaint) tally.lexComplaintWrong++;
        if (value && c.emergency !== null && modelEmergency !== c.emergency) tally.modelEmergencyWrong++;
        if (value && c.complaint !== null && modelComplaint !== c.complaint) tally.modelComplaintWrong++;
        rows.push({
          ...c,
          lexical: { labels: lex, hazard: hazard.level },
          model: value ? { risk, intents: value.requests.map((r) => r.intent) } : null,
        });
      }
      writeFileSync(OUT!, JSON.stringify({ tally, rows }, null, 1));
      console.log(`[humor] ${set.cases.length} vaka`, JSON.stringify(tally));
      expect(rows.length).toBe(set.cases.length);
    },
    1_800_000,
  );
});
