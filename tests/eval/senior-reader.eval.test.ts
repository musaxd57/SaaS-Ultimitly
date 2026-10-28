import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runAbsenceJudge } from "@/lib/ai/semantic/absence-judge";

// ---------------------------------------------------------------------------
// KIDEMLİ OKUYUCU ÖLÇÜMÜ (T-b, kurucu 10-22). Set: `evals/airbnb-message-policy.json` (misafir mesajı + taslak + beklenen üç hüküm; null =
// iki cevap da kabul). Okuyucu gerçek modelle, iki okumayla koşar; sonuç `EVAL_SENIOR_OUT`a yazılır, soru başına doğru / yanlış özeti basılır.
// Koşul: RUN_REAL_EVAL=1 + OPENAI_API_KEY + EVAL_SENIOR_OUT. Bütçe: vaka başına iki küçük çağrı.
// ---------------------------------------------------------------------------

type Expect = { payHost: boolean | null; contact: boolean | null; apology: boolean | null };
const OUT = process.env.EVAL_SENIOR_OUT;
/** Set adı (`evals/` içinde; varsayılan Airbnb mesaj kuralları seti). 10-28: hizmet ücreti cümleleri seti `airbnb-fee-statements.json`. */
const SET_FILE = (process.env.EVAL_SENIOR_SET?.trim() || "airbnb-message-policy.json").replace(/[^a-z0-9._-]/gi, "");
const run = process.env.RUN_REAL_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(OUT);

describe.skipIf(!run)("KIDEMLİ OKUYUCU — Airbnb / ödeme / özür seti (gerçek model)", () => {
  it(
    "her vakada okuyucu koşar; soru başına sapma sayılır",
    async () => {
      const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals", SET_FILE), "utf8")) as {
        cases: { id: string; guest: string; draft: string; attack?: boolean; expect: Expect }[];
      };
      const rows: unknown[] = [];
      const miss: Record<keyof Expect, string[]> = { payHost: [], contact: [], apology: [] };
      let failed = 0;
      for (const c of set.cases) {
        const started = Date.now();
        const v = await runAbsenceJudge({ guestMessage: c.guest, reply: c.draft, senior: true });
        const checks = v.status === "ok" ? v.checks : undefined;
        if (!checks) failed++;
        for (const k of ["payHost", "contact", "apology"] as const) {
          if (checks && c.expect[k] !== null && checks[k] !== c.expect[k]) miss[k].push(c.id);
        }
        rows.push({ ...c, got: checks ?? null, ms: Date.now() - started });
      }
      writeFileSync(OUT!, JSON.stringify(rows, null, 1));
      console.log(
        `[senior-reader] ${set.cases.length} vaka, düşen ${failed} · sapma ödeme ${miss.payHost.join(",") || "-"} · iletişim ${
          miss.contact.join(",") || "-"
        } · özür ${miss.apology.join(",") || "-"}`,
      );
      expect(rows.length).toBe(set.cases.length);
    },
    1_800_000,
  );
});
