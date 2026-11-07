import { describe, it, expect } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { autoReplyGateFailure } from "@/lib/automation";
import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";
import { replyPromptVersion } from "@/lib/ai";
import { writeSidecar, uniqueReportName } from "./sidecar";
import { PRICES, languageMatches } from "./reply-scoring";

// ---------------------------------------------------------------------------
// BİLGİ TABANINDAKİ ÜÇÜNCÜ ŞAHIS → BİRİNCİ KİŞİ — ÜCRETLİ A/B (kurucu 11-07: "e'yi yapabilirsin").
//
//   RUN_REAL_EVAL=1 NODE_USE_ENV_PROXY=1 npx vitest run --config vitest.eval.config.ts tests/eval/host-voice-kb.eval.test.ts
//
// AYNI senaryolar (`evals/host-voice-kb-2026-11-07.json`, sentetik) cevap modeline ürünle aynı yoldan iki kolda gider: anahtar
// `AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED` kapalı (bugün) / açık (istemde tek örnek). Ölçülenler — hepsi DETERMİNİSTİK, LLM hakem YOK:
//   · ÜÇÜNCÜ ŞAHIS: cevapta ev sahibinden üçüncü kişi olarak söz (`hostVoiceViolation` — kapının kendi denetçisi).
//   · GİDER Mİ: gerçek kapı (`autoReplyGateFailure`) cevabı geçiriyor mu; tutulduysa gerekçe (`reply_host_voice` ayrı sayılır).
//   · OLGU: bilgi tabanındaki saat / tutar / koşul cevapta var mı (birinci kişiye çevirirken bilgi kaybolmasın).
//   · DİL: cevap misafirin dilinde mi. Kontrol senaryoları (nötr kalem) istemin başka cevapları bozmadığını gösterir.
// Örnek cevaplar raporda iki kol yan yana basılır (insan okur). Kurgusal "Lale" dairesi; gerçek veri yok.
// ---------------------------------------------------------------------------

type Scenario = { id: string; cls: "kb3p" | "control"; lang: string; message: string; facts: string[][] };
type Dataset = {
  version: number;
  property: { name: string; checkInTime: string; checkOutTime: string; address?: string; city?: string };
  kb: { category: string; title: string; content: string }[];
  scenarios: Scenario[];
};
type Arm = "off" | "on";
type Row = {
  id: string;
  cls: Scenario["cls"];
  lang: string;
  arm: Arm;
  sample: number;
  ok: boolean;
  reply?: string;
  third?: boolean;
  gate?: string | null;
  facts?: boolean;
  langOk?: boolean;
  pt?: number;
  ct?: number;
  cpt?: number;
  error?: string;
};

const FLAG = "AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED";
const DATASET = path.resolve(__dirname, "../../evals/host-voice-kb-2026-11-07.json");
const data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.1";
const SAMPLES = Number(process.env.EVAL_SAMPLES) > 0 ? Math.trunc(Number(process.env.EVAL_SAMPLES)) : 2;
const CONCURRENCY = 3;
const NOW = new Date();

/** Olgu eşleşmesi: binlik ayırıcı ve büyük / küçük harf farkı yok sayılır; her olgu grubundan en az bir seçenek geçmeli. */
export function factsHitLoose(facts: string[][], reply: string): boolean {
  const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2");
  const r = norm(reply);
  return facts.every((alts) => alts.some((a) => r.includes(norm(a))));
}

async function runOne(s: Scenario, arm: Arm, sample: number): Promise<Row> {
  const base: Row = { id: s.id, cls: s.cls, lang: s.lang, arm, sample, ok: false };
  try {
    const kbSel = await retrieveKbForPrompt({
      items: data.kb.map((k, i) => ({ id: `kb-${i}`, ...k, updatedAt: new Date("2026-09-01T00:00:00Z") })) as never,
      guestMessage: s.message,
      history: [],
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
      history: [],
      conversationState: { isFirstOperatorReply: true },
      tone: "warm",
      language: "tr",
    };
    // İstem anahtarı çağrı anında okunur (`replySystemPromptForItems`) — kol başına süreç ortamı ayarlanır, kollar SIRAYLA koşar.
    let r = await suggestReply(input);
    if (r.source !== "openai") {
      await new Promise((res) => setTimeout(res, 20_000));
      r = await suggestReply(input);
    }
    const reply = r.reply ?? "";
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
      { history: [], pendingGuestMessages: [], stayTimes: { checkIn: data.property.checkInTime, checkOut: data.property.checkOutTime } },
    );
    return {
      ...base,
      ok: r.source === "openai",
      reply,
      third: hostVoiceViolation(reply) === "host_third_person",
      gate,
      facts: factsHitLoose(s.facts, reply),
      langOk: languageMatches(s.lang, reply),
      pt: r.llmUsage?.pt,
      ct: r.llmUsage?.ct,
      cpt: r.llmUsage?.cpt,
    };
  } catch (err) {
    return { ...base, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

async function runArm(arm: Arm): Promise<{ rows: Row[]; promptVersion: string }> {
  process.env[FLAG] = arm === "on" ? "1" : "";
  const promptVersion = replyPromptVersion();
  const jobs: (() => Promise<Row>)[] = [];
  for (let k = 0; k < SAMPLES; k++) for (const s of data.scenarios) jobs.push(() => runOne(s, arm, k));
  const rows: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) rows.push(await jobs[next++]());
    }),
  );
  return { rows, promptVersion };
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${n}/${d} (${Math.round((100 * n) / d)}%)`);

function summary(rows: Row[], cls: Scenario["cls"]) {
  const r = rows.filter((x) => x.cls === cls && x.ok);
  return {
    n: r.length,
    third: r.filter((x) => x.third).length,
    auto: r.filter((x) => x.gate === null).length,
    voiceHeld: r.filter((x) => x.gate === "reply_host_voice").length,
    facts: r.filter((x) => x.facts).length,
    autoWithFacts: r.filter((x) => x.gate === null && x.facts).length,
    langOk: r.filter((x) => x.langOk).length,
  };
}

function costUsd(rows: Row[]): number | null {
  const p = PRICES[MODEL];
  if (!p) return null;
  return rows.reduce((u, r) => u + (((r.pt ?? 0) - (r.cpt ?? 0)) * p.in + (r.cpt ?? 0) * p.cached + (r.ct ?? 0) * p.out) / 1e6, 0);
}

describe.skipIf(!enabled)("bilgi tabanındaki üçüncü şahıs → birinci kişi (ücretli A/B)", () => {
  it(
    "iki kol: anahtar kapalı / açık",
    async () => {
      const saved = process.env[FLAG];
      const off = await runArm("off");
      const on = await runArm("on");
      if (saved === undefined) delete process.env[FLAG];
      else process.env[FLAG] = saved;
      const rows = [...off.rows, ...on.rows];

      const dir = path.resolve(__dirname, "../../docs/olcum");
      mkdirSync(dir, { recursive: true });
      const day = NOW.toISOString().slice(0, 10);
      const name = uniqueReportName(dir, `host-voice-kb-${day}-${MODEL}.md`);
      const lines: string[] = [
        `# Bilgi tabanındaki üçüncü şahıs → birinci kişi — ücretli A/B (${day}, ${MODEL})`,
        "",
        `Set: \`evals/host-voice-kb-2026-11-07.json\` · ${data.scenarios.length} senaryo × ${SAMPLES} örnek × 2 kol · istem kimliği kapalı \`${off.promptVersion}\` / açık \`${on.promptVersion}\``,
        `Maliyet (yaklaşık): ${costUsd(rows)?.toFixed(2) ?? "?"} USD · çağrı hatası: ${rows.filter((r) => !r.ok).length}`,
        "",
        "| Küme · kol | Cevap | Üçüncü şahıs | Kapıdan geçti | Ev sahibi sesi kapısı tuttu | Olgu doğru | Geçti + olgu doğru | Dil doğru |",
        "|---|---|---|---|---|---|---|---|",
      ];
      for (const cls of ["kb3p", "control"] as const) {
        for (const [arm, res] of [["kapalı", off], ["açık", on]] as const) {
          const s = summary(res.rows, cls);
          lines.push(
            `| ${cls === "kb3p" ? "üçüncü şahıs kalem" : "kontrol (nötr kalem)"} · ${arm} | ${s.n} | ${pct(s.third, s.n)} | ${pct(s.auto, s.n)} | ${pct(s.voiceHeld, s.n)} | ${pct(s.facts, s.n)} | ${pct(s.autoWithFacts, s.n)} | ${pct(s.langOk, s.n)} |`,
          );
        }
      }
      lines.push("", "## Örnekler (örnek 0, iki kol yan yana)", "");
      for (const s of data.scenarios) {
        const a = off.rows.find((r) => r.id === s.id && r.sample === 0);
        const b = on.rows.find((r) => r.id === s.id && r.sample === 0);
        const fmt = (r?: Row) => (r?.ok ? `${(r.reply ?? "").replace(/\s+/g, " ").slice(0, 300)} — kapı: ${r.gate ?? "geçti"}${r.third ? " · üçüncü şahıs" : ""}${r.facts ? "" : " · OLGU EKSİK"}` : `HATA ${r?.error ?? ""}`);
        lines.push(`- **${s.id}** (${s.cls}, ${s.lang}) — "${s.message}"`, `  - kapalı: ${fmt(a)}`, `  - açık: ${fmt(b)}`);
      }
      lines.push("");
      writeFileSync(path.join(dir, name), lines.join("\n"), "utf8");
      writeSidecar(dir, name, {
        suite: "host-voice-kb",
        version: data.version,
        meta: { model: MODEL, samples: SAMPLES, promptOff: off.promptVersion, promptOn: on.promptVersion },
        rows,
      });
      console.log(lines.slice(0, 12).join("\n"));
      expect(rows.filter((r) => r.ok).length).toBeGreaterThan(0);
    },
    60 * 60_000,
  );
});
