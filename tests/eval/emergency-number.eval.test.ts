import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { evalRuntime, evalRuntimeMarkdown } from "./run-meta";
import { analyzeEmergencyFailures, decisionOf, explainFailuresEnabled } from "./emergency-number-causes";
import { emergencyNumberReply } from "@/lib/ai/emergency-number";

// ---------------------------------------------------------------------------
// ACİL NUMARA SORUSU — ANLAMA KATMANI BAĞLAMI AYIRT EDİYOR MU? (kurucu 10-11: "önce ölçüm sonra kod; Luna 6.0'a yaptıralım").
// Öneri (`docs/TASARIM-2026-10-11-acil-numara-ve-yer-onerisi.md`): misafir resmî numarayı açıkça sorarsa kod "Türkiye'de acil numara
// 112'dir." der; anlama katmanı ev sahibini şikâyet / iade / insan talebi okursa cevap verilmez, ev sahibine kalır. Bu ölçüm yalnız
// ayırt etmeyi sınar: kural = risk niyeti complaint_issue / cancellation_refund / human_request → hold, aksi → give.
// İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. Model `AI_UNDERSTANDING_MODEL` (koşuda gpt-6-luna). ~2 × N anlama çağrısı.
// Veri: `evals/emergency-number.json` (geliştirme seti, görüldü) ya da `EVAL_EMERGENCY_SET=emergency-number-acc1` (KÖR kabul seti — Haiku
// yazdı, Claude açmaz). Rapora misafir metni GİRMEZ (yalnız kimlik + sınıf); kör sette neden analizi KOŞMAZ (metni rapora taşırdı).
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const REPEATS = Math.max(1, Math.min(5, Number(process.env.EVAL_REPEATS ?? "2") || 2));

interface Scenario {
  id: string;
  lang: string;
  class: string;
  expect: "give" | "hold" | "either";
  text: string;
}

const HOLD_KINDS = new Set(["complaint_issue", "cancellation_refund", "human_request"]);

describe.skipIf(!enabled)("acil numara sorusu — anlama katmanı bağlam ayrımı (gerçek model)", () => {
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  const savedNumber = process.env.AI_EMERGENCY_NUMBER_ENABLED;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    // Ürün kararı sütunu için kod yolu açık (yalnız bu ölçüm sürecinde; model çağrısı yapmaz).
    process.env.AI_EMERGENCY_NUMBER_ENABLED = "1";
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
    if (savedNumber === undefined) delete process.env.AI_EMERGENCY_NUMBER_ENABLED;
    else process.env.AI_EMERGENCY_NUMBER_ENABLED = savedNumber;
  });

  it("give / hold ayrımı", async () => {
    const setName = (process.env.EVAL_EMERGENCY_SET ?? "emergency-number").replace(/[^a-z0-9-]/gi, "");
    const blind = /-acc\d+$/.test(setName);
    const data = JSON.parse(readFileSync(path.resolve(__dirname, `../../evals/${setName}.json`), "utf8")) as { scenarios: Scenario[] };
    const jobs = data.scenarios.flatMap((s) => Array.from({ length: REPEATS }, (_, r) => ({ s, r })));
    const rows: {
      id: string;
      cls: string;
      expect: string;
      rep: number;
      status: string;
      risk: string | null;
      intents: string[];
      decision: string;
      product: string;
    }[] = [];
    let i = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (i < jobs.length) {
          const { s, r } = jobs[i++];
          __resetUnderstandingCache();
          const o = await understandGuestMessages({ guestMessage: s.text, items: true });
          const value = o.status === "ok" ? o.value : null;
          const risk = understandingRiskOf(value);
          const decision = o.status !== "ok" ? "fail" : risk && HOLD_KINDS.has(risk) ? "hold" : "give";
          const intents = value ? value.requests.map((q) => q.intent).sort() : [];
          // ÜRÜNÜN gerçek kararı: kod kuralları (ev sahibi sözcüğü, konaklama konusu, numara sorusu) + bu koşunun anlama niyetleri.
          const product =
            o.status !== "ok"
              ? "fail"
              : emergencyNumberReply({ message: s.text, timeZone: "Europe/Istanbul", language: s.lang, understandingIntents: intents })
                ? "give"
                : "hold";
          rows.push({ id: s.id, cls: s.class, expect: s.expect, rep: r, status: o.status, risk, intents, decision, product });
        }
      }),
    );
    rows.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }) || a.rep - b.rep);
    const scored = rows.filter((r) => r.expect !== "either");
    const correct = scored.filter((r) => r.decision === r.expect).length;
    const wrongGive = scored.filter((r) => r.expect === "hold" && r.decision === "give");
    const wrongHold = scored.filter((r) => r.expect === "give" && r.decision === "hold");
    const failed = rows.filter((r) => r.decision === "fail").length;
    const stable = new Set(data.scenarios.map((s) => s.id)).size - new Set(
      data.scenarios.filter((s) => new Set(rows.filter((r) => r.id === s.id).map((r) => r.decision)).size > 1).map((s) => s.id),
    ).size;

    const meta = evalRuntime();
    const outDir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(outDir, { recursive: true });
    const stem = `acil-numara-${new Date().toISOString().slice(0, 10)}-${process.env.AI_UNDERSTANDING_MODEL ?? "varsayilan"}${blind ? `-${setName.replace(/^emergency-number-/, "")}` : ""}${process.env.AI_UNDERSTANDING_THREAT_RULE_ENABLED === "1" ? "-thr" : ""}-${Date.now().toString(36)}`;
    writeFileSync(path.join(outDir, `${stem}.json`), JSON.stringify({ meta, repeats: REPEATS, rows }, null, 1));
    const md = [
      `# Acil numara sorusu — anlama katmanı bağlam ayrımı (${blind ? `KÖR set \`${setName}\`` : `geliştirme seti \`${setName}\``})`,
      "",
      evalRuntimeMarkdown(meta),
      "",
      `Kural: risk niyeti complaint_issue / cancellation_refund / human_request → **hold** (ev sahibine), aksi → **give** (resmî numara).`,
      "",
      `| ölçü | değer |`,
      `|---|---|`,
      `| doğru karar (give + hold, puanlanan; en öncelikli niyet kuralı) | ${correct}/${scored.length} |`,
      `| doğru karar — anlama kuralı (niyetlerden herhangi biri şikâyet / iade / insan talebi → hold) | ${scored.filter((r) => r.decision !== "fail" && decisionOf(r.intents) === r.expect).length}/${scored.length} |`,
      `| **doğru karar — ÜRÜN (kod kuralları + anlama; \`emergencyNumberReply\`)** | **${scored.filter((r) => r.product === r.expect).length}/${scored.length}** |`,
      `| 🚨 ürün: bırakılması gerekirken numara verirdi | ${scored.filter((r) => r.expect === "hold" && r.product === "give").length} |`,
      `| ürün: numara verilmesi gerekirken bırakırdı | ${scored.filter((r) => r.expect === "give" && r.product === "hold").length} |`,
      `| 🚨 bırakılması gerekirken numara verilecekti (hold → give) | ${wrongGive.length} |`,
      `| numara verilmesi gerekirken bırakılacaktı (give → hold) | ${wrongHold.length} |`,
      `| anlama çağrısı başarısız | ${failed} |`,
      `| tekrarlarda kararı aynı kalan senaryo | ${stable}/${data.scenarios.length} |`,
      "",
      `| kimlik | sınıf | beklenen | tekrar | risk niyeti | niyetler | anlama kararı | ürün kararı |`,
      `|---|---|---|---|---|---|---|---|`,
      ...rows.map((r) => {
        const mark = (v: string) => (v === r.expect || r.expect === "either" ? v : `**${v}**`);
        return `| ${r.id} | ${r.cls} | ${r.expect} | ${r.rep + 1} | ${r.risk ?? "—"} | ${r.intents.join(", ") || "—"} | ${mark(decisionOf(r.intents))} | ${mark(r.product)} |`;
      }),
    ].join("\n");
    writeFileSync(path.join(outDir, `${stem}.md`), `${md}\n`);
    // Hata çıktıysa NEDEN ANALİZİ hemen (kurucu 10-11): modelin açıklaması + karşı deneme + düzeltme katmanı → `${stem}-neden.md`.
    if (!blind && explainFailuresEnabled() && scored.some((r) => r.decision !== "fail" && decisionOf(r.intents) !== r.expect)) {
      const textOf = new Map(data.scenarios.map((s) => [s.id, s.text]));
      const causes = await analyzeEmergencyFailures(rows, (id) => textOf.get(id), stem, outDir);
      expect(causes.filter((c) => c.kind === "unrunnable").map((c) => c.id)).toEqual([]);
    }
    expect(rows.length).toBe(jobs.length);
  }, 900_000);
});
