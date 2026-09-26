import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { llmCached } from "./rag-lab/cache";
import { runPipeline, type LabQuery } from "./rag-lab/core";
import { parseConfig } from "./rag-lab/config";
import { buildScaleLab, loadScaleFile } from "./rag-lab/scale-set";
import { writeSidecar } from "./sidecar";

// ---------------------------------------------------------------------------
// RAG CEVAP DÜZEYİ KABUL ÖLÇÜMÜ (#189; Codex kabul kapısı: "kaynaklı doğru misafir cevabı + yanıtsız soruda uydurmama").
// Boru hattının seçtiği bilgi bloğu ÜRETİMİN cevap modeline (`suggestReply`, gerçek istem) verilir; cevap KODLA ölçülür
// (LLM hakem YOK):
//   · cevaplanabilir soru, cevap cümlesi SAYI taşıyorsa (saat, tutar, süre, kod): cevap o sayılardan EN AZ BİRİNİ içeriyor mu
//     (sayı dil değiştirmez; sözel olgunun doğruluğu burada ÖLÇÜLMEZ — yalnız blok kapsamı)
//   · "bilgim yok" itirafı (`admitsMissingKnowledge`, misafire asla gitmeyen biçim) oranı
//   · yanıtsız soruda: iddia desteği denetiminin (üretimin kendi `claimAudit`i) DESTEKSİZ somut iddia sayısı (u > 0 = uydurma)
// Model çıktıları disk önbellekli (girdi özeti anahtar). İKİ KAPI: RUN_REAL_EVAL=1 + anahtar.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-") && process.env.EVAL_RAG_ANSWER === "1";
const NOW = Date.UTC(2026, 8, 23, 12);
const CONFIGS = (process.env.EVAL_RAG_ANSWER_CONFIGS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["base0926", "prod"]).map(parseConfig);
const SPLIT = process.env.EVAL_RAG_ANSWER_SPLIT === "holdout" ? "holdout" : "dev";
/** Grup başına en çok bu kadar soru (sabit adımlı örneklem, ücretli koşu bütçesi). */
const PER_GROUP = Math.max(1, Number(process.env.EVAL_RAG_ANSWER_N) || 40);
const GROUPS = ["single_tr", "single_xx", "multi", "neg"] as const;

/** Cevap cümlesindeki sayısal çapalar: saat (15.00 / 15:00), ≥2 haneli sayı, ondalık. Tek haneli sayı çapa değil (gürültü). */
export function numericAnchors(needle: string): string[] {
  const out = new Set<string>();
  for (const m of needle.matchAll(/\d{1,2}[.:]\d{2}|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    if (/^\d$/.test(raw)) continue;
    out.add(raw.replace(":", ".").replace(",", "."));
  }
  return [...out];
}

export function replyHasAnchor(reply: string, anchors: readonly string[]): boolean {
  const norm = reply.replace(/(\d{1,2}):(\d{2})/g, "$1.$2").replace(/(\d),(\d)/g, "$1.$2");
  return anchors.some((a) => new RegExp(`(^|[^\\d])${a.replace(".", "\\.")}([^\\d]|$)`).test(norm));
}

interface AnswerRow {
  config: string;
  qid: string;
  group: string;
  inBlock: boolean;
  anchored: boolean;
  anchorHit: boolean | null;
  missing: boolean;
  unsupported: number;
  handoff: boolean;
}

describe.skipIf(!enabled)("RAG CEVAP DÜZEYİ (gerçek cevap modeli)", () => {
  const rows: AnswerRow[] = [];
  let complete = false;
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetKbIndexCache();
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
    if (rows.length === 0) return;
    let commit = "?";
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      /* uydurma yazılmaz */
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const lines = [
      complete ? `# RAG cevap düzeyi (${stamp})` : `# GEÇERSİZ — koşu yarıda kaldı — RAG cevap düzeyi (${stamp})`,
      "",
      `- commit: ${commit} · küme: ${SPLIT} · grup başına en çok ${PER_GROUP} soru`,
      "",
      "Ölçü: blokta = cevap cümlesi bilgi bloğunda · sayılı = cevap cümlesi sayı taşıyan soru · sayı cevapta = sayılı soruda",
      "cevabın sayılardan en az birini söylemesi · bilgim-yok = cevabın kendi yokluk itirafı · devir = cevap modelinin devir",
      "niyeti · desteksiz iddia = üretimin iddia denetiminde verisiz somut iddia taşıyan cevap (yanıtsız soruda uydurma).",
      "",
      "| yapılandırma | grup | n | blokta | sayılı | sayı cevapta | bilgim-yok | devir | desteksiz iddia |",
      "|---|---|---|---|---|---|---|---|---|",
    ];
    for (const cfg of CONFIGS) {
      for (const g of GROUPS) {
        const rs = rows.filter((r) => r.config === cfg.name && r.group === g);
        if (rs.length === 0) continue;
        const anchored = rs.filter((r) => r.anchored);
        lines.push(
          `| ${cfg.name} | ${g} | ${rs.length} | ${g === "neg" ? "—" : rs.filter((r) => r.inBlock).length} | ${anchored.length} | ${anchored.filter((r) => r.anchorHit).length} | ${rs.filter((r) => r.missing).length} | ${rs.filter((r) => r.handoff).length} | ${rs.filter((r) => r.unsupported > 0).length} |`,
        );
      }
    }
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `rag-answer-${stamp}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `rag-answer-${stamp}-${n}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "rag-answer", version: 1, meta: { commit, split: SPLIT, perGroup: PER_GROUP }, rows });
  });

  it("boru hattı → cevap modeli", async () => {
    const file = loadScaleFile(SPLIT);
    if (!file) throw new Error(`evals/rag-scale/${SPLIT}.json yok`);
    const { items, queries } = buildScaleLab(file);
    const pick = (g: string) => {
      const qs = queries.filter((q) => q.group === g);
      const step = Math.max(1, Math.floor(qs.length / PER_GROUP));
      return qs.filter((_, i) => i % step === 0).slice(0, PER_GROUP);
    };
    const sample: LabQuery[] = GROUPS.flatMap((g) => pick(g));
    for (const cfg of CONFIGS) {
      let i = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (i < sample.length) {
            const q = sample[i++];
            const run = await runPipeline(items, q, cfg, NOW);
            const input: SuggestReplyInput = {
              guestMessage: q.text,
              property: { name: "Lale Evleri", checkInTime: "15:00", checkOutTime: "11:00" },
              reservation: null,
              knowledgeBase: run.result.items,
              knowledgeBaseDropped: run.result.droppedItems,
              knowledgeBaseSelection: run.result.selection,
              knowledgeBaseNotes: run.result.notes,
              history: q.history ?? [],
              tone: "warm",
              language: "tr",
            };
            const out = await llmCached("reply", { v: 1, input }, async () => {
              const r = await suggestReply(input);
              return r.source === "openai" ? { reply: r.reply, intent: r.intent, u: r.claimAudit?.u ?? 0 } : null;
            });
            if (!out) continue;
            const anchors = q.answers.flatMap((a) => numericAnchors(a.needles[0] ?? ""));
            rows.push({
              config: cfg.name,
              qid: q.id,
              group: q.group,
              inBlock: q.answers.length > 0 && q.answers.every((a) => a.needles.some((n) => run.text.includes(n))),
              anchored: anchors.length > 0,
              anchorHit: anchors.length > 0 ? replyHasAnchor(out.reply, anchors) : null,
              missing: admitsMissingKnowledge(out.reply),
              unsupported: out.u,
              handoff: out.intent === "human_request",
            });
          }
        }),
      );
    }
    complete = true;
    expect(rows.length).toBeGreaterThan(0);
  }, 90 * 60_000);
});
