import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { analyzeEmergencyFailures, type MeasuredRow } from "./emergency-number-causes";

// ---------------------------------------------------------------------------
// SON acil numara ölçümünün hatalarını YENİDEN ÖLÇMEDEN neden analizine sokar (`failure-analysis.ts` döngüsü). Yeni ölçümde bu adım
// `emergency-number.eval.test.ts` içinde kendiliğinden koşar. İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. Çağrı: vaka başına ~1 + 2 × (1 + aday).
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

describe.skipIf(!enabled)("acil numara — son koşunun hata nedenleri (gerçek model)", () => {
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
  });
  it("analiz", async () => {
    const dir = path.resolve(__dirname, "../../docs/olcum");
    const latest = readdirSync(dir)
      // Kör set koşuları (`-acc<N>`) neden analizine GİRMEZ: analiz misafir metnini rapora yazar, set kör olmaktan çıkardı.
      .filter((f) => /^acil-numara-.*\.json$/.test(f) && !/-(aciklama|neden)\.json$/.test(f) && !/-acc\d+/.test(f))
      .sort()
      .pop();
    expect(latest).toBeDefined();
    const run = JSON.parse(readFileSync(path.join(dir, latest!), "utf8")) as { rows: MeasuredRow[] };
    const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/emergency-number.json"), "utf8")) as {
      scenarios: { id: string; text: string }[];
    };
    const textOf = new Map(data.scenarios.map((s) => [s.id, s.text]));
    const results = await analyzeEmergencyFailures(run.rows, (id) => textOf.get(id), latest!.replace(/\.json$/, ""), dir);
    expect(results.length).toBeGreaterThan(0);
    // Koşulamayan analiz YEŞİL geçmez (ilk deneme 0/0 ile geçmişti).
    expect(results.filter((r) => r.kind === "unrunnable").map((r) => r.id)).toEqual([]);
  }, 1_800_000);
});
