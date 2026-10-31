import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DECISION_WRITER_SYSTEM_PROMPT, decisionWriterCallParams, draftDecisionMessage, type DecisionDraftResult } from "@/lib/decisions/ai-text";
import { checkDecisionText, type DecisionTextFacts } from "@/lib/decisions/text-check";
import { formatDecisionDay, type DecisionKind, type DecisionLang, type DecisionResolution } from "@/lib/decisions/core";
import { timesIn } from "@/lib/ai/retrieval/time-fields";
import { confidentLanguage } from "@/lib/ai/language-signal";
import { evalRuntime, evalRuntimeMarkdown } from "./run-meta";
import { priceFor } from "./reply-scoring";
import { writeSidecar, uniqueReportName } from "./sidecar";
import { claudeArmFromEnv, installAnthropicReplyShim, shimSummaryLine } from "./anthropic-reply-shim";

// ---------------------------------------------------------------------------
// KARAR MESAJI — YAPAY ZEKÂ YAZAR, KOD + BEKÇİ DOĞRULAR (Sabah Kararları 62 h, kurucu 10-07). Ürünün `draftDecisionMessage`
// fonksiyonu OLDUĞU GİBİ koşar (yazıcı = `AI_DECISION_TEXT_MODEL` / `…_REASONING_EFFORT` → cevap modeli; bekçi = `AI_STAY_GUARD_MODEL` →
// `AI_SEMANTIC_MODEL` → `OPENAI_MODEL`). Ölçüler deterministik: yapay zekâ metni mi geldi (yoksa neden şablon), metin karar kaydıyla
// uyuşuyor mu (bağımsız yeniden denetim), gün adlandırılmış mı, iç bilgi sızdı mı, beklenen gerekçe anıldı mı (sezgisel — metinler
// raporda tam, insan okur). LLM puanlayıcı YOK. Set `EVAL_DECISION_SET` (geliştirme `decision-text-dev.json`, kör kabul
// `decision-text-acc1.json`). İKİ KAPI: RUN_REAL_EVAL=1 + gerçek anahtar. Maliyet her OpenAI yanıtının `usage`ından.
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  kind: DecisionKind;
  resolution: DecisionResolution;
  lang: DecisionLang;
  dayKey: string;
  time: string | null;
  requestedTime: string | null;
  standardTime: string;
  fee: { amount: number; currency: string } | null;
  note: string | null;
  checklist: string[];
  guestRequest: string;
  expectReason?: "cleaning" | "previous_guest" | "next_guest" | null;
}

const SET = (process.env.EVAL_DECISION_SET?.trim() || "decision-text-dev.json").replace(/[^a-z0-9._-]/gi, "");
const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals", SET), "utf8")) as { scenarios: Scenario[] };
// Claude kolu (kurucu 10-31): yazıcı VE bekçi çağrısı aynı istemle Claude'a gider (köprü sohbet ucunun hepsini çevirir).
const CLAUDE = claudeArmFromEnv();
const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
// Rapor adı ve başlığı yazıcının GERÇEK modeli (ürünün çözücüsü; 10-09: katman değişkeni gelince `OPENAI_MODEL` yanlış olurdu).
const MODEL = CLAUDE ? CLAUDE.label : decisionWriterCallParams().model;
const TAG = (process.env.EVAL_DECISION_TAG ?? "").trim().replace(/[^a-z0-9.-]+/gi, "_");
const RPM = Number(process.env.EVAL_DECISION_RPM) > 0 ? Number(process.env.EVAL_DECISION_RPM) : 20;
const LIMIT = Number(process.env.EVAL_DECISION_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_DECISION_LIMIT)) : Infinity;
const BUDGET_USD = Number(process.env.EVAL_BUDGET_USD) > 0 ? Number(process.env.EVAL_BUDGET_USD) : Infinity;

/** Misafire SIZMAMASI gereken iç bilgi sözcükleri (görev, personel, kural, kontrol listesi, otomasyon, bakım). */
const INTERNAL =
  /görev|personel|kural|kontrol listesi|otomati|bakım|\btask|staff|\brule|checklist|maintenance|automat|aufgabe|personal\b|regel|tâche|règle|tarea|regla|задач|персонал|правил|مهمة|قاعدة|صيانة/i;
const REASON: Record<string, RegExp> = {
  cleaning: /temizl|clean|reinig|putz|ménage|nettoy|limpi|уборк|убира|تنظيف/i,
  previous_guest: /önceki misafir|previous guest|guests? (?:before|checking out)|vorherige|vorige|précédent|anterior|предыдущ|السابق/i,
  next_guest: /yeni misafir|aynı gün gelen|sonraki misafir|next guest|new guest|another guest|arriving guest|nächste|neue[rn]? gäste?|prochain|nouveau|nouvelle|siguiente|otro huésped|nuevo|следующ|новы[ехй]|ضيف جديد|ضيوف/i,
};

interface Row {
  id: string;
  kind: DecisionKind;
  resolution: DecisionResolution;
  lang: DecisionLang;
  source: "ai" | "template";
  why: string | null;
  problems: string[];
  text: string | null;
  recheckOk: boolean | null;
  dayNamed: boolean;
  timeOk: boolean | null;
  langOk: boolean | null;
  internalLeak: boolean;
  expectReason: string | null;
  reasonMentioned: boolean | null;
  ms: number;
}

// ── Maliyet ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const usage = new Map<string, { calls: number; in: number; cached: number; out: number; reasoning: number }>();
const realFetch = globalThis.fetch;
let baseFetch: typeof fetch = realFetch;
let undoShim: (() => void) | null = null;
function metered(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> {
  return baseFetch(input, init).then(async (res) => {
    try {
      const j = (await res.clone().json()) as { model?: unknown; usage?: Record<string, unknown> };
      const m = typeof j.model === "string" ? j.model : "unknown";
      const u = j.usage ?? {};
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      const r = usage.get(m) ?? { calls: 0, in: 0, cached: 0, out: 0, reasoning: 0 };
      r.calls += 1;
      r.in += n(u.prompt_tokens);
      r.cached += n((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
      r.out += n(u.completion_tokens);
      r.reasoning += n((u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
      usage.set(m, r);
    } catch {
      /* JSON olmayan yanıt */
    }
    return res;
  });
}
function usd(): number {
  let t = 0;
  for (const [m, u] of usage) {
    const p = priceFor(m);
    if (p) t += ((u.in - u.cached) * p.in + u.cached * p.cached + u.out * p.out) / 1e6;
  }
  return t;
}

let lastStart = 0;
async function throttle() {
  const wait = lastStart + 60_000 / RPM - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
}

const promptId = createHash("sha256").update(DECISION_WRITER_SYSTEM_PROMPT).digest("hex").slice(0, 12);

describe.skipIf(!enabled)(`KARAR MESAJI — ${MODEL}`, () => {
  const rows: Row[] = [];
  const saved = { ...process.env };
  let planned = 0;
  beforeAll(() => {
    process.env.HOST_DECISION_AI_TEXT_ENABLED = "1";
    process.env.AI_STAY_GUARD_ENABLED = "1";
    if (CLAUDE) {
      undoShim = installAnthropicReplyShim(CLAUDE.opts, CLAUDE.key);
      baseFetch = globalThis.fetch;
    }
    globalThis.fetch = metered as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    undoShim?.();
    baseFetch = realFetch;
    const runtime = evalRuntime();
    process.env = { ...saved };
    if (rows.length === 0) return;
    const pct = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);
    const ai = rows.filter((r) => r.source === "ai");
    const why = new Map<string, number>();
    for (const r of rows) if (r.source === "template") why.set(`${r.why}${r.problems.length ? ` (${r.problems.join(", ")})` : ""}`, (why.get(`${r.why}${r.problems.length ? ` (${r.problems.join(", ")})` : ""}`) ?? 0) + 1);
    const withReason = ai.filter((r) => r.resolution === "decline" && r.expectReason);
    const noReason = ai.filter((r) => r.resolution === "decline" && !r.expectReason);
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0);
    const status = rows.length === planned ? "GEÇERLİ" : "EKSİK";
    const stamp = new Date().toISOString().slice(0, 10);
    const lines = [
      `# Karar mesajı (yapay zekâ + kod + bekçi) — ${MODEL} (${stamp})`,
      "",
      `Durum: **${status}** · set \`evals/${SET}\` · satır ${rows.length}/${planned} · yazıcı istem kimliği \`${promptId}\``,
      "",
      ...(CLAUDE ? [`Claude kolu: yazıcı VE bekçi ${CLAUDE.opts.model} (düşünme ${CLAUDE.opts.thinking}, çaba ${CLAUDE.opts.effort}).`, "", shimSummaryLine(), ""] : []),
      "| ölçü | değer |",
      "|---|---|",
      `| yapay zekâ metni kullanıldı | ${pct(ai.length, rows.length)} |`,
      `| 🚨 kullanılan yapay zekâ metni bağımsız yeniden denetimden geçti | ${pct(ai.filter((r) => r.recheckOk).length, ai.length)} |`,
      `| 🚨 onayda karar saati metinde | ${pct(ai.filter((r) => r.timeOk === true).length, ai.filter((r) => r.timeOk !== null).length)} |`,
      `| gün adlandırıldı | ${pct(ai.filter((r) => r.dayNamed).length, ai.length)} |`,
      `| misafirin dili (kodun kesin tespiti olanlarda) | ${pct(ai.filter((r) => r.langOk === true).length, ai.filter((r) => r.langOk !== null).length)} |`,
      `| 🚨 iç bilgi sızıntısı (görev / kural / bakım…) | ${pct(ai.filter((r) => r.internalLeak).length, ai.length)} |`,
      `| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | ${pct(withReason.filter((r) => r.reasonMentioned).length, withReason.length)} |`,
      `| gerekçesiz ret: gerekçe UYDURULDU mu (sezgisel, düşük iyi) | ${pct(noReason.filter((r) => Object.values(REASON).some((rx) => rx.test(r.text ?? ""))).length, noReason.length)} |`,
      `| gecikme p50 / p95 (yazıcı + bekçi) | ${(q(0.5) / 1000).toFixed(1)} sn / ${(q(0.95) / 1000).toFixed(1)} sn |`,
      `| maliyet (liste fiyatı) | $${usd().toFixed(4)} |`,
      "",
      "## Şablona düşüş nedenleri",
      "",
      ...[...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`),
      "",
      "## Metinler",
      "",
      ...rows.map(
        (r) =>
          `- **${r.id}** (${r.kind} · ${r.resolution} · ${r.lang}${r.expectReason ? ` · gerekçe ${r.expectReason}` : ""}) — ${r.source === "ai" ? "YZ" : `şablon/${r.why}`}${r.internalLeak ? " · 🚨 SIZINTI" : ""}${r.recheckOk === false ? " · 🚨 DENETİM" : ""}: ${(r.text ?? "(yok)").replace(/\s+/g, " ")}`,
      ),
      "",
      evalRuntimeMarkdown(runtime),
      "",
      "| model (sunulan) | çağrı | girdi | önbellek | çıktı | düşünme |",
      "|---|---|---|---|---|---|",
      ...[...usage].map(([m, u]) => `| ${m} | ${u.calls} | ${u.in} | ${u.cached} | ${u.out} | ${u.reasoning} |`),
    ];
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const name = uniqueReportName(dir, `karar-mesaji-${stamp}-${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}-${SET.replace(/\.json$/, "")}${TAG ? `-${TAG}` : ""}.md`);
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    console.log(`[eval] REPORT=${path.join(dir, name)}`);
    writeSidecar(dir, name, { suite: "decision-text", version: 1, meta: { model: MODEL, set: SET, promptId, status, usd: usd() }, rows, runtime });
  });

  it(
    "senaryolar",
    async () => {
      const list = data.scenarios.slice(0, LIMIT);
      planned = list.length;
      for (const s of list) {
        if (usd() > BUDGET_USD) break;
        await throttle();
        const facts: DecisionTextFacts = {
          kind: s.kind,
          resolution: s.resolution,
          lang: s.lang,
          dayKey: s.dayKey,
          time: s.time,
          requestedTime: s.requestedTime,
          standardTime: s.standardTime,
          fee: s.fee,
          note: s.note,
          checklist: s.checklist,
        };
        const t0 = Date.now();
        const out: DecisionDraftResult = await draftDecisionMessage({
          ...facts,
          guestRequest: s.guestRequest,
          stayTimes: s.kind === "early_checkin" ? { checkIn: s.standardTime, checkOut: "11:00" } : { checkIn: "15:00", checkOut: s.standardTime },
        });
        const ms = Date.now() - t0;
        const text = out.text;
        const isAi = out.source === "ai";
        const detected = text ? confidentLanguage(text) : null;
        rows.push({
          id: s.id,
          kind: s.kind,
          resolution: s.resolution,
          lang: s.lang,
          source: out.source,
          why: out.source === "template" ? out.why : null,
          problems: out.source === "template" ? (out.problems ?? []) : [],
          text,
          recheckOk: isAi ? checkDecisionText(text, facts).ok : null,
          dayNamed: !!text && text.includes(formatDecisionDay(s.dayKey, s.lang)),
          timeOk: isAi && s.resolution === "approve" && s.time ? timesIn(text ?? "").has(s.time) : null,
          langOk: detected === null ? null : detected === s.lang,
          internalLeak: isAi && INTERNAL.test(text ?? ""),
          expectReason: s.expectReason ?? null,
          reasonMentioned: isAi && s.resolution === "decline" && s.expectReason ? REASON[s.expectReason].test(text ?? "") : null,
          ms,
        });
      }
      expect(rows.length).toBeGreaterThan(0);
    },
    60 * 60 * 1000,
  );
});
