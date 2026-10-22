import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { autoReplyGateFailure } from "@/lib/automation";
import { claudeKey, extractJson, CLAUDE_GEN_MODEL } from "./claude-client";
import { GREETING, promiseInReply } from "./reply-metrics";
import { writeSidecar } from "./sidecar";
import { languageMatches, factsHit, factsStrict, type FactSpec } from "./reply-scoring";

// ---------------------------------------------------------------------------
// T-c (kurucu 10-22: "Evet" — plan 10-21 §7 "modelin kendisini denemek"): CEVAP KATMANINDA Claude ↔ gpt-5.1 YAN YANA.
//
// AYNI senaryo (`evals/model-reply-compare.json`, sentetik), AYNI istem (ürünün `suggestReply`i kurar), AYNI ayrıştırıcı (katı şema) ve
// AYNI gönderim kapısı (`autoReplyGateFailure`). Değişen YALNIZ istemi cevaplayan model:
//   · SBS_PROVIDER=openai → istek OpenAI'ye gider (yerel koşu, gpt-5.1).
//   · SBS_PROVIDER=claude → ürünün OpenAI isteği yakalanır, aynı sistem + kullanıcı metni Claude'a (Messages API) gider, Claude'un JSON'u
//     OpenAI cevabı biçiminde ürüne geri verilir. Anahtar yalnız GitHub Actions sırrında (claude-eval.yml). Ürün kodu Claude ÇAĞIRMAZ.
// Bilgi tabanı ≤30 kalem → seçim / gömme yok (iki kolda da aynı tam küme, ağ çağrısı yok). Anlama katmanı ve bekçi KAPALI (yalnız cevap
// modeli ölçülür). Puanlama deterministik (LLM hakem yok): sızıntı, olgu isabeti, dil, bekleme sözü, özür / üzüntü cümlesi, gecikme,
// token. Rapor `docs/olcum/claude-zorlu-sbs-*` (iş akışı bu adı günlüğe basar).
// ---------------------------------------------------------------------------

type Provider = "claude" | "openai";
const PROVIDER: Provider = (process.env.SBS_PROVIDER?.trim() as Provider) || (claudeKey() ? "claude" : "openai");
const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled =
  process.env.RUN_REAL_EVAL === "1" &&
  (PROVIDER === "claude" ? claudeKey().length > 20 : openaiKey.length > 20 && !openaiKey.startsWith("test-"));
const N = Math.min(60, Number(process.env.CLAUDE_EVAL_N) > 0 ? Math.trunc(Number(process.env.CLAUDE_EVAL_N)) : 40);
const RPM = Number(process.env.SBS_RPM) > 0 ? Number(process.env.SBS_RPM) : 12;

interface Scenario {
  id: string;
  class: string;
  lang: string;
  kb: "full" | "sparse";
  history?: { direction: "inbound" | "outbound"; body: string }[];
  message: string;
  expect: { autoSend: "yes" | "no" | "any"; facts?: FactSpec[] };
}
interface Dataset {
  property: { name: string; checkInTime: string; checkOutTime: string; address?: string; city?: string };
  kbSets: Record<"full" | "sparse", { category: string; title: string; content: string }[]>;
  scenarios: Scenario[];
}
const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/model-reply-compare.json"), "utf8")) as Dataset;

/** Sınıflar arasında sıra sıra (round-robin) ilk N senaryo — küçük N'de de her sınıf temsil edilir; seçim deterministik. */
export function stratifiedPick<T extends { class: string }>(list: readonly T[], n: number): T[] {
  const byClass = new Map<string, T[]>();
  for (const s of list) byClass.set(s.class, [...(byClass.get(s.class) ?? []), s]);
  const queues = [...byClass.values()];
  const out: T[] = [];
  for (let i = 0; out.length < n && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < n) out.push(q[i]);
  }
  return out;
}

/** Özür / üzüntü / kusur kabulü cümlesi (kurucu T-a: misafire gitmez) — rapor ölçüsü, kapı değil. */
export const APOLOGY = /(?<!\p{L})(?:özür|üzgün|üzüldü|kusura bakma|sorry|apolog|regret|entschuldig|bedauer|désolé|lo siento|lamentamos|извин|сожале)/iu;

// ── Claude bağdaştırıcısı: ürünün OpenAI isteği → Claude Messages → OpenAI cevabı biçimi ─────────────────────────────────────────
const usage = { calls: 0, inTok: 0, outTok: 0 };
const realFetch = globalThis.fetch;
async function claudeAdapter(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("api.openai.com/v1/chat/completions")) {
    // Bu ölçer başka OpenAI ucu kullanmaz (gömme yok); beklenmeyen çağrı ürünün kendi yedek yoluna düşsün.
    if (url.includes("api.openai.com")) return new Response("{}", { status: 503 });
    return realFetch(input, init);
  }
  const req = JSON.parse(String(init?.body ?? "{}")) as { messages?: { role: string; content: string }[] };
  const system = (req.messages ?? []).filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = (req.messages ?? []).filter((m) => m.role !== "system");
  const body = {
    model: CLAUDE_GEN_MODEL,
    max_tokens: 2000,
    system: `${system}\n\nÇIKTI: yalnız istenen JSON nesnesi — başında / sonunda açıklama ya da kod çiti yok.`,
    messages: turns.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await realFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": claudeKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: init?.signal ?? undefined,
      });
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    const j = (await res.json().catch(() => ({}))) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    if (!res.ok) return new Response(JSON.stringify({ error: { message: `claude ${res.status}` } }), { status: 400 });
    usage.calls++;
    usage.inTok += j.usage?.input_tokens ?? 0;
    usage.outTok += j.usage?.output_tokens ?? 0;
    const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    let content: string | null = null;
    try {
      content = JSON.stringify(extractJson<Record<string, unknown>>(text));
    } catch {
      content = text; // ürünün katı ayrıştırıcısı reddeder → yedeğe düşüş olarak sayılır (modelin şema uyumu ölçüsü)
    }
    return new Response(
      JSON.stringify({
        model: CLAUDE_GEN_MODEL,
        choices: [{ index: 0, finish_reason: j.stop_reason === "max_tokens" ? "length" : "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: j.usage?.input_tokens ?? 0, completion_tokens: j.usage?.output_tokens ?? 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ error: { message: "claude unavailable" } }), { status: 503 });
}

interface Row {
  id: string;
  cls: string;
  lang: string;
  expectAuto: string;
  ok: boolean;
  auto?: boolean;
  gate?: string | null;
  facts?: boolean | null;
  factsStrict?: { ok: boolean; missing: number; wrong: number } | null;
  u?: number | null;
  langOk?: boolean;
  greetRepeat?: boolean | null;
  promise?: boolean;
  apology?: boolean;
  ms?: number;
  pt?: number;
  ct?: number;
  reply?: string;
  error?: string;
}

const NOW = new Date();
const sent: number[] = [];
async function throttle(): Promise<void> {
  for (;;) {
    const cutoff = Date.now() - 60_000;
    while (sent.length && sent[0] < cutoff) sent.shift();
    if (sent.length < RPM) {
      sent.push(Date.now());
      return;
    }
    await new Promise((r) => setTimeout(r, 250 + sent[0] - cutoff));
  }
}

async function runOne(s: Scenario): Promise<Row> {
  const base: Row = { id: s.id, cls: s.class, lang: s.lang, expectAuto: s.expect.autoSend, ok: false };
  const kb = data.kbSets[s.kb];
  const history = s.history ?? [];
  const t0 = Date.now();
  try {
    const kbSel = await retrieveKbForPrompt({
      items: kb.map((k, i) => ({ id: `kb-${s.kb}-${i}`, ...k, updatedAt: new Date("2026-09-01T00:00:00Z") })) as never,
      guestMessage: s.message,
      history,
      stayTimes: { checkIn: data.property.checkInTime, checkOut: data.property.checkOutTime },
    });
    const input: SuggestReplyInput = {
      guestMessage: s.message,
      property: { ...data.property },
      reservation: { guestName: "Alex Doe", arrivalDate: new Date(NOW.getTime() - 86_400_000), departureDate: new Date(NOW.getTime() + 3 * 86_400_000), status: "confirmed" },
      knowledgeBase: kbSel.items,
      knowledgeBaseDropped: kbSel.droppedItems,
      knowledgeBaseSelection: kbSel.selection,
      knowledgeBaseNotes: kbSel.notes,
      history,
      conversationState: { isFirstOperatorReply: !history.some((h) => h.direction === "outbound") },
      tone: "warm",
      language: "tr",
    };
    await throttle();
    const r = await suggestReply(input);
    const ms = Date.now() - t0;
    const gate = autoReplyGateFailure(
      {
        intent: r.intent,
        riskLevel: r.riskLevel,
        confidence: r.confidence,
        source: r.source,
        riskType: r.riskType ?? null,
        reply: r.reply,
        stayChange: r.stayChange ?? null,
        timeConflicts: r.timeConflicts ?? null,
        claimedActions: r.claimedActions ?? null,
      },
      s.message,
      {
        history: history.map((h) => h.body),
        pendingGuestMessages: history
          .slice(history.map((h) => h.direction).lastIndexOf("outbound") + 1)
          .filter((h) => h.direction === "inbound")
          .map((h) => h.body),
        stayTimes: { checkIn: data.property.checkInTime, checkOut: data.property.checkOutTime },
      },
    );
    const reply = r.reply ?? "";
    return {
      ...base,
      ok: r.source === "openai",
      auto: gate === null,
      gate,
      facts: factsHit(s.expect.facts, reply),
      factsStrict: factsStrict(s.expect.facts, reply),
      u: r.claimAudit?.u ?? null,
      langOk: languageMatches(s.lang, reply),
      greetRepeat: history.some((h) => h.direction === "outbound") ? GREETING.test(reply) : null,
      promise: promiseInReply(reply),
      apology: APOLOGY.test(reply),
      ms,
      pt: r.llmUsage?.pt,
      ct: r.llmUsage?.ct,
      reply,
    };
  } catch (err) {
    return { ...base, error: String((err as Error)?.message ?? err).slice(0, 200), ms: Date.now() - t0 };
  }
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${n}/${d} (${Math.round((100 * n) / d)}%)`);
const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);

export function summarizeSbs(rows: Row[]): string[] {
  const ok = rows.filter((r) => r.ok);
  const leaks = ok.filter((r) => r.expectAuto === "no" && r.auto);
  const grounded = ok.filter((r) => r.cls === "grounded" || (r.cls === "multi_turn" && r.expectAuto === "yes"));
  const withFacts = grounded.filter((r) => r.facts !== null);
  const info = ok.filter((r) => ["grounded", "missing", "multi_turn", "greeting_closing"].includes(r.cls));
  const complaints = ok.filter((r) => r.cls === "complaint" || (r.cls === "multi_turn" && r.expectAuto === "no"));
  const ms = ok.map((r) => r.ms ?? 0);
  return [
    "| ölçü | değer |",
    "|---|---|",
    `| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | ${pct(leaks.length, ok.filter((r) => r.expectAuto === "no").length)} |`,
    `| otomatik cevap (cevabı bilgi tabanında olan soru) | ${pct(grounded.filter((r) => r.auto).length, grounded.length)} |`,
    `| doğru olgu — KATI (olumlu, alanına bağlı) | ${pct(withFacts.filter((r) => r.factsStrict?.ok).length, withFacts.length)} |`,
    `| olgu YANLIŞ | ${pct(withFacts.filter((r) => (r.factsStrict?.wrong ?? 0) > 0).length, withFacts.length)} |`,
    `| UYDURMA: desteksiz somut iddia (bilgi soruları) | ${pct(info.filter((r) => (r.u ?? 0) > 0).length, info.length)} |`,
    `| 🚨 bekleme sözü misafire giden cevapta | ${pct(ok.filter((r) => r.auto && r.promise).length, ok.filter((r) => r.auto).length)} |`,
    `| özür / üzüntü cümlesi (şikâyet taslaklarında; T-a hedefi 0) | ${pct(complaints.filter((r) => r.apology).length, complaints.length)} |`,
    `| dil uyumu (TR dışı) | ${pct(ok.filter((r) => r.lang !== "tr" && r.langOk).length, ok.filter((r) => r.lang !== "tr").length)} |`,
    `| selam tekrarı | ${pct(ok.filter((r) => r.greetRepeat).length, ok.filter((r) => r.greetRepeat !== null).length)} |`,
    `| şema / yedek düşüşü (ürünün katı ayrıştırıcısı) | ${pct(rows.length - ok.length, rows.length)} |`,
    `| gecikme p50 / p95 | ${(q(ms, 0.5) / 1000).toFixed(1)} sn / ${(q(ms, 0.95) / 1000).toFixed(1)} sn |`,
  ];
}

const rows: Row[] = [];
afterAll(() => {
  if (!enabled || rows.length === 0) return;
  const sha = (() => {
    try {
      return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "?";
    }
  })();
  const model = PROVIDER === "claude" ? CLAUDE_GEN_MODEL : process.env.OPENAI_MODEL?.trim() || "gpt-5.1";
  const dir = path.resolve(__dirname, "../../docs/olcum");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `claude-zorlu-sbs-${stamp}-${PROVIDER}`;
  const md = [
    `# Cevap katmanı yan yana — ${model} (${stamp})`,
    "",
    `commit \`${sha}\` · senaryo ${rows.length} (model-reply-compare, sınıflar arası sıra sıra) · aynı istem + aynı kapı · token: ${PROVIDER === "claude" ? `${usage.inTok} girdi / ${usage.outTok} çıktı (${usage.calls} çağrı)` : `${rows.reduce((a, r) => a + (r.pt ?? 0), 0)} girdi / ${rows.reduce((a, r) => a + (r.ct ?? 0), 0)} çıktı`}`,
    "",
    ...summarizeSbs(rows),
    "",
    "## Satırlar",
    "",
    "| id | sınıf | beklenti | gitti | kapı | olgu | özür | cevap (ilk 160) |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.cls} | ${r.expectAuto} | ${r.ok ? (r.auto ? "✓" : "—") : "düştü"} | ${r.gate ?? ""} | ${r.facts === null || r.facts === undefined ? "" : r.facts ? "✓" : "✗"} | ${r.apology ? "⚠" : ""} | ${(r.reply ?? r.error ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 160)} |`,
    ),
  ].join("\n");
  writeFileSync(path.join(dir, `${name}.md`), md);
  // Yan dosya + kimlik bloğu (katman modelleri, commit, bayraklar) ortak yazıcıdan — her ölçüm raporu bunu taşır (pin).
  writeSidecar(dir, `${name}.md`, { suite: "claude-side-by-side", version: 1, meta: { provider: PROVIDER, model, sha, n: rows.length }, rows });
});

describe.skipIf(!enabled)(`cevap katmanı yan yana (${PROVIDER})`, () => {
  it(
    "aynı senaryo, aynı istem, aynı kapı — yalnız model farklı",
    async () => {
      if (PROVIDER === "claude") {
        // Ürün anahtarsız istek atmaz; istek bağdaştırıcıda yakalanır, OpenAI'ye GİTMEZ.
        process.env.OPENAI_API_KEY = "sk-sbs-claude-adapter-0000000000000000";
        process.env.OPENAI_MODEL = "gpt-5.1";
        globalThis.fetch = claudeAdapter as typeof fetch;
      }
      process.env.AI_UNDERSTANDING_ENABLED = "";
      process.env.AI_STAY_GUARD_ENABLED = "";
      try {
        for (const s of stratifiedPick(data.scenarios, N)) rows.push(await runOne(s));
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(rows.length).toBeGreaterThan(0);
    },
    90 * 60 * 1000,
  );
});

describe("yan yana ölçer — çevrimdışı pinler", () => {
  it("sıra sıra seçim her sınıftan alır ve deterministik", () => {
    const list = [
      { id: "a1", class: "a" },
      { id: "a2", class: "a" },
      { id: "a3", class: "a" },
      { id: "b1", class: "b" },
      { id: "c1", class: "c" },
    ];
    expect(stratifiedPick(list, 4).map((x) => x.id)).toEqual(["a1", "b1", "c1", "a2"]);
    expect(stratifiedPick(list, 10)).toHaveLength(5);
  });
  it("özür ölçüsü üzüntü / özür kalıplarını yakalar, olgu cümlesini yakalamaz", () => {
    expect(APOLOGY.test("Yaşadığınız sorun için üzgünüz.")).toBe(true);
    expect(APOLOGY.test("Sorry for the inconvenience.")).toBe(true);
    expect(APOLOGY.test("Wi-Fi şifresi Lale2025!")).toBe(false);
  });
});
