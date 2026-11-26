import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { partReaderModel, partReaderReasoningEffort, runPartReader } from "@/lib/ai/semantic/part-reader";

// ---------------------------------------------------------------------------
// PARÇA OKUYUCUSU KARŞILAŞTIRMASI (Codex / kurucu 10-23: "Önce aynı soru–kaynak–cevap örnekleriyle okuyucuları karşılaştırırız. Ardından tüm
// akışı ölçeriz."). Set: `evals/part-reader-dev.json` (misafir mesajı + istek + kodun doğruladığı parça + notlar + beklenen keep / hold).
// Kollar ortamdan: B = kıdemli okuyucunun ayarı (`AI_STAY_GUARD_*`), C = yalnız okuyucuda başka model (`AI_PART_READER_MODEL` /
// `AI_PART_READER_REASONING_EFFORT`). Ayrı sayılır: YANLIŞ GEÇİŞ (tutulması gereken parça okuyucudan geçti) · GEREKSİZ TUTMA (gitmesi gereken
// parça tutuldu) · düşen çağrı. Tekrar (`EVAL_PART_READER_REPEAT`, varsayılan 1) kararsızlığı ölçer.
// Koşul: RUN_REAL_EVAL=1 + OPENAI_API_KEY + EVAL_PART_READER_OUT. Bütçe: vaka başına bir küçük çağrı.
// ---------------------------------------------------------------------------

interface Case {
  id: string;
  guest: string;
  earlier?: string[];
  request: string;
  part: string;
  notes: string[];
  expect: "keep" | "hold";
  why: string;
}
const OUT = process.env.EVAL_PART_READER_OUT;
const REPEAT = Math.max(1, Math.min(5, Math.trunc(Number(process.env.EVAL_PART_READER_REPEAT) || 1)));
const run = process.env.RUN_REAL_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(OUT);

describe.skipIf(!run)("PARÇA OKUYUCUSU — soru / kaynak / parça seti (gerçek model)", () => {
  it(
    "her vaka okunur; yanlış geçiş ve gereksiz tutma ayrı sayılır",
    async () => {
      const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/part-reader-dev.json"), "utf8")) as { cases: Case[] };
      const rows: { id: string; expect: string; got: string[]; ms: number[] }[] = [];
      for (const c of set.cases) {
        const got: string[] = [];
        const ms: number[] = [];
        for (let i = 0; i < REPEAT; i++) {
          const started = Date.now();
          const out = await runPartReader({
            guestMessage: c.guest,
            earlierGuestMessages: c.earlier ?? [],
            parts: [{ ref: "R1", request: c.request, text: c.part, notes: c.notes }],
          });
          ms.push(Date.now() - started);
          got.push(out.status !== "ok" ? "failed" : (out.holds.get("R1") ?? "keep"));
        }
        rows.push({ id: c.id, expect: c.expect, got, ms });
      }
      const verdict = (g: string) => (g === "keep" ? "keep" : g === "failed" ? "failed" : "hold");
      const all = rows.flatMap((r) => r.got.map((g) => ({ id: r.id, expect: r.expect, got: verdict(g), reason: g })));
      const wrongPass = all.filter((x) => x.expect === "hold" && x.got === "keep");
      const needless = all.filter((x) => x.expect === "keep" && x.got === "hold");
      const failed = all.filter((x) => x.got === "failed");
      const unstable = rows.filter((r) => new Set(r.got.map(verdict)).size > 1).map((r) => r.id);
      const arm = `${partReaderModel()}/${partReaderReasoningEffort() ?? "(varsayılan)"}`;
      mkdirSync(path.dirname(OUT!), { recursive: true });
      writeFileSync(OUT!, JSON.stringify({ arm, repeat: REPEAT, rows }, null, 1));
      console.log(
        `[part-reader] kol ${arm} · ${set.cases.length} vaka × ${REPEAT} · YANLIŞ GEÇİŞ ${wrongPass.length} (${[...new Set(wrongPass.map((x) => x.id))].join(",") || "-"}) · GEREKSİZ TUTMA ${needless.length} (${needless.map((x) => `${x.id}:${x.reason}`).join(",") || "-"}) · düşen ${failed.length} · kararsız ${unstable.join(",") || "-"} · ort. ${Math.round(rows.flatMap((r) => r.ms).reduce((a, b) => a + b, 0) / Math.max(1, rows.length * REPEAT))} ms`,
      );
      expect(rows.length).toBe(set.cases.length);
    },
    1_800_000,
  );
});
