import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { runAbsenceJudge, quoteFoundInReply } from "@/lib/ai/semantic/absence-judge";

// ---------------------------------------------------------------------------
// BAĞLAM HAKEMİ ÖLÇÜMÜ (kurucu 10-21: "kelime bazlı yapma, bağlam / anlam / amaç bazlı — gerçek sorularla test et").
// Girdi: gerçek model ölçümlerinden çıkarılmış misafir mesajı + yapay zekâ taslağı çiftleri (JSONL, `guest` + `reply`), yol
// `EVAL_ABSENCE_PAIRS`. Her çift için kelime kuralı (`admitsMissingKnowledge`) ve bağlam hakemi (`runAbsenceJudge`, gerçek model)
// koşar; sonuç `EVAL_ABSENCE_OUT`a yazılır. Etiket (doğru cevap) ayrı adımda insan / bağımsız okuyucu tarafından verilir.
// Koşul: RUN_REAL_EVAL=1 + OPENAI_API_KEY. Bütçe: çift başına bir küçük çağrı.
// ---------------------------------------------------------------------------

const PAIRS = process.env.EVAL_ABSENCE_PAIRS;
const OUT = process.env.EVAL_ABSENCE_OUT;
const run = process.env.RUN_REAL_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(PAIRS) && Boolean(OUT);
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.EVAL_ABSENCE_CONCURRENCY) || 4));

describe.skipIf(!run)("BAĞLAM HAKEMİ — bilgim yok (gerçek model)", () => {
  it(
    "kelime kuralı ve hakem her çiftte koşar",
    async () => {
      const rows = readFileSync(PAIRS!, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as { guest: string; reply: string; [k: string]: unknown });
      const out: unknown[] = new Array(rows.length);
      let next = 0;
      let failed = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= rows.length) return;
          const r = rows[i];
          const started = Date.now();
          const verdict = await runAbsenceJudge({ guestMessage: r.guest, reply: r.reply });
          if (verdict.status !== "ok") failed++;
          out[i] = {
            ...r,
            lexical: admitsMissingKnowledge(r.reply),
            judge: verdict.status === "ok" ? (verdict.admits ? "admits" : "no") : "failed",
            quote: verdict.status === "ok" ? verdict.quote : "",
            quoteFound: verdict.status === "ok" && verdict.quote ? quoteFoundInReply(verdict.quote, r.reply) : null,
            ms: Date.now() - started,
          };
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      writeFileSync(OUT!, JSON.stringify(out, null, 1));
      console.log(`[absence-judge] ${rows.length} çift, hakem düşen ${failed}`);
      expect(out.filter(Boolean).length).toBe(rows.length);
    },
    3_600_000,
  );
});
