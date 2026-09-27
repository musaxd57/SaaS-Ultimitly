import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { replyRequestIdentity, suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { llmCached } from "./rag-lab/cache";
import { replyCacheKey } from "./rag-lab/cache-keys";
import { runPipeline, type LabQuery } from "./rag-lab/core";
import { parseConfig } from "./rag-lab/config";
import { buildScaleLab, kbForQuery, loadScaleFile } from "./rag-lab/scale-set";
import { answerAnchorHits, foreignNumbers } from "./rag-lab/answer-metrics";
import { writeSidecar } from "./sidecar";

// ---------------------------------------------------------------------------
// RAG CEVAP DÜZEYİ KABUL ÖLÇÜMÜ (#189; Codex kabul kapısı: "kaynaklı doğru misafir cevabı + yanıtsız soruda uydurmama").
// Boru hattının seçtiği bilgi bloğu ÜRETİMİN cevap modeline (`suggestReply`, gerçek istem) verilir; cevap KODLA ölçülür
// (LLM hakem YOK):
//   · cevaplanabilir soru, cevap cümlesi SAYI taşıyorsa (saat, tutar, süre, kod): cevap o sayılardan EN AZ BİRİNİ içeriyor mu
//     (sayı dil değiştirmez; sözel olgunun doğruluğu burada ÖLÇÜLMEZ — yalnız blok kapsamı)
//   · "bilgim yok" itirafı (`admitsMissingKnowledge`, misafire asla gitmeyen biçim) oranı
//   · yanıtsız soruda: iddia desteği denetiminin (üretimin kendi `claimAudit`i) DESTEKSİZ somut iddia sayısı (u > 0 = uydurma)
//   · YABANCI SAYI (#189 geniş blok): cevabın söylediği, dayanağı cevap cümlelerinde / mülk alanlarında / misafirin yazdığında
//     OLMAYAN sayı — blokta başka kalemden alınmış olgu "dayanaklı" görünür, bu ölçü onu yakalar (yalnız eşleştirilmiş fark okunur)
// Bilgi tabanı: varsayılan tüm küme; `EVAL_RAG_ANSWER_KB=perq` = soru başına gerçek müşteri boyutu (`kbForQuery`, varsayılan 60 —
// plan tavanı; `EVAL_RAG_ANSWER_PERQ_SIZE`). Geniş blok (`KB_RETRIEVAL_WIDE_BUDGET`) yapılandırma belirteci `wide` ile kıyaslanır.
// Model çıktıları disk önbellekli (girdi özeti anahtar). İKİ KAPI: RUN_REAL_EVAL=1 + anahtar.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-") && process.env.EVAL_RAG_ANSWER === "1";
const NOW = Date.UTC(2026, 8, 23, 12);
/**
 * Cevap isteminin ANI (Codex 09-27 önbellek anahtarı): istem rezervasyonsuz da "Bugün: … saat SS:DD" satırı taşır; an sabit
 * değilse istem her dakika değişir (anahtar hiç isabet etmez, eşleştirilmiş iki yapılandırma da farklı dakikada farklı istem
 * alırdı). Gün, v1 önbelleğinden taşınan 552 cevabın üretildiği gün (27.09 Pazar, İstanbul 12:00; dakika farkı dışında aynı).
 */
const REPLY_NOW = new Date(Date.UTC(2026, 8, 27, 9));
const CONFIGS = (process.env.EVAL_RAG_ANSWER_CONFIGS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["base0926", "prod"]).map(parseConfig);
const SPLIT = process.env.EVAL_RAG_ANSWER_SPLIT === "holdout" ? "holdout" : "dev";
/** Grup başına en çok bu kadar soru (sabit adımlı örneklem, ücretli koşu bütçesi). */
const PER_GROUP = Math.max(1, Number(process.env.EVAL_RAG_ANSWER_N) || 40);
const GROUPS = ["single_tr", "single_xx", "multi", "neg"] as const;
const KB_MODE = process.env.EVAL_RAG_ANSWER_KB === "perq" ? "perq" : "full";
const PERQ_SIZE = Math.max(1, Math.trunc(Number(process.env.EVAL_RAG_ANSWER_PERQ_SIZE) || 60));
const PROPERTY = { name: "Lale Evleri", checkInTime: "15:00", checkOutTime: "11:00" };
/**
 * Eşzamanlı işçi (varsayılan 1) ve 429 sonrası yeniden deneme (09-27: 3 işçiyle gpt-5.1 dakikalık token sınırına takıldı; 252
 * cevap yedeğe düştü ve rapora HİÇ girmeden kayboldu). Dakikalık tavan `RAG_LAB_RPM` ile (önerilen 8: cevap isteği ~17,5k token).
 */
const WORKERS = Math.max(1, Math.min(4, Math.trunc(Number(process.env.EVAL_RAG_ANSWER_WORKERS) || 1)));
const RETRIES = 3;

interface AnswerRow {
  config: string;
  qid: string;
  group: string;
  /** Cevap modeli yeniden denemelere rağmen cevap üretemedi (429 / arıza) → ölçüye girmez, raporda GEÇERSİZ sayılır. */
  invalid?: boolean;
  inBlock: boolean;
  /** Sayı taşıyan en az bir cevap var. */
  anchored: boolean;
  /** Sayı taşıyan HER cevabın kendi sayısı yanıtta (iki sorulu mesajda ikisi de; Codex 09-27). */
  anchorHit: boolean | null;
  /** Cevap düzeyi: sayı taşıyan cevap sayısı / yanıtta sayısı geçen cevap sayısı. */
  anchoredAnswers?: number;
  anchorHits?: number;
  missing: boolean;
  unsupported: number;
  handoff: boolean;
  foreign: boolean;
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
    const invalid = rows.filter((r) => r.invalid);
    // EŞLEŞTİRME: yapılandırmalar YALNIZ hepsinde geçerli cevabı olan sorular üzerinde kıyaslanır (eksik soru bir kolu kayırmasın).
    const validBy = new Map<string, Set<string>>();
    for (const r of rows) if (!r.invalid) validBy.set(r.qid, (validBy.get(r.qid) ?? new Set()).add(r.config));
    const paired = new Set([...validBy].filter(([, cs]) => CONFIGS.every((c) => cs.has(c.name))).map(([q]) => q));
    const header = !complete
      ? `# GEÇERSİZ — koşu yarıda kaldı — RAG cevap düzeyi (${stamp})`
      : invalid.length > 0
        ? `# EKSİK — ${invalid.length} cevap üretilemedi (eşleştirilmiş alt kümeyle) — RAG cevap düzeyi (${stamp})`
        : `# RAG cevap düzeyi (${stamp})`;
    const lines = [
      header,
      "",
      `- commit: ${commit} · küme: ${SPLIT} · grup başına en çok ${PER_GROUP} soru · bilgi tabanı: ${KB_MODE === "perq" ? `soru başına ${PERQ_SIZE} kalem` : "tüm küme"}`,
      `- geçerli cevap: ${rows.length - invalid.length} · üretilemeyen (yeniden denemeden sonra): ${invalid.length} · eşleştirilmiş soru: ${paired.size}`,
      "",
      "Ölçü: blokta = cevap cümlesi bilgi bloğunda · sayılı = cevap cümlesi sayı taşıyan soru · sayı cevapta = sayı taşıyan HER",
      "cevabın kendi sayısı yanıtta (iki sorulu mesajda İKİSİ de; 09-27'ye kadar herhangi biri yetiyordu) · cevap düzeyi = sayı taşıyan",
      "cevaplardan yanıtta sayısı geçenler / hepsi · bilgim-yok = cevabın kendi yokluk itirafı · devir = cevap modelinin devir",
      "niyeti · desteksiz iddia = üretimin iddia denetiminde verisiz somut iddia taşıyan cevap (yanıtsız soruda uydurma) · yabancı",
      "sayı = cevap cümlelerinde / mülk alanlarında / misafirin yazdığında olmayan sayıyı söyleyen cevap (yalnız eşleştirilmiş fark).",
      "",
      "| yapılandırma | grup | n | blokta | sayılı | sayı cevapta | cevap düzeyi | bilgim-yok | devir | desteksiz iddia | yabancı sayı |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
    ];
    for (const cfg of CONFIGS) {
      for (const g of GROUPS) {
        const rs = rows.filter((r) => r.config === cfg.name && r.group === g && !r.invalid && paired.has(r.qid));
        if (rs.length === 0) continue;
        const anchored = rs.filter((r) => r.anchored);
        const perAnswer = `${rs.reduce((n, r) => n + (r.anchorHits ?? 0), 0)}/${rs.reduce((n, r) => n + (r.anchoredAnswers ?? 0), 0)}`;
        lines.push(
          `| ${cfg.name} | ${g} | ${rs.length} | ${g === "neg" ? "—" : rs.filter((r) => r.inBlock).length} | ${anchored.length} | ${anchored.filter((r) => r.anchorHit).length} | ${perAnswer} | ${rs.filter((r) => r.missing).length} | ${rs.filter((r) => r.handoff).length} | ${rs.filter((r) => r.unsupported > 0).length} | ${rs.filter((r) => r.foreign).length} |`,
        );
      }
    }
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `rag-answer-${stamp}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `rag-answer-${stamp}-${n}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "rag-answer", version: 1, meta: { commit, split: SPLIT, perGroup: PER_GROUP, kb: KB_MODE, ...(KB_MODE === "perq" ? { perqSize: PERQ_SIZE } : {}) }, rows });
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
        Array.from({ length: WORKERS }, async () => {
          while (i < sample.length) {
            const q = sample[i++];
            const run = await runPipeline(KB_MODE === "perq" ? kbForQuery(items, q, PERQ_SIZE) : items, q, cfg, NOW);
            const input: SuggestReplyInput = {
              guestMessage: q.text,
              property: PROPERTY,
              reservation: null,
              knowledgeBase: run.result.items,
              knowledgeBaseDropped: run.result.droppedItems,
              knowledgeBaseSelection: run.result.selection,
              knowledgeBaseNotes: run.result.notes,
              history: q.history ?? [],
              tone: "warm",
              language: "tr",
              now: REPLY_NOW,
            };
            // Anahtar = modele GİDEN istek (model + çaba + sistem/kullanıcı istemi özeti; Codex 09-27): istem kurucusu ya da model
            // değişince ıska, aynı istek isabet. Eski `{ v: 1, input }` girdileri §6d'deki taşımayla (istem birebir aynıysa) okunur.
            const cacheKey = replyCacheKey(replyRequestIdentity(input));
            let out: { reply: string; intent: string; u: number } | null = null;
            for (let attempt = 0; attempt <= RETRIES && !out; attempt++) {
              if (attempt > 0) await new Promise((r) => setTimeout(r, 20_000 * attempt));
              out = await llmCached("reply", cacheKey, async () => {
                const r = await suggestReply(input);
                return r.source === "openai" ? { reply: r.reply, intent: r.intent, u: r.claimAudit?.u ?? 0 } : null;
              });
            }
            if (!out) {
              rows.push({ config: cfg.name, qid: q.id, group: q.group, invalid: true, inBlock: false, anchored: false, anchorHit: null, missing: false, unsupported: 0, handoff: false, foreign: false });
              continue;
            }
            // Cevap BAŞINA (Codex 09-27): iki sorulu mesajda yalnız bir sorunun sayısını söyleyen yanıt başarı değildir.
            const hits = answerAnchorHits(out.reply, q.answers);
            rows.push({
              config: cfg.name,
              qid: q.id,
              group: q.group,
              inBlock: q.answers.length > 0 && q.answers.every((a) => a.needles.some((n) => run.text.includes(n))),
              anchored: hits.anchored > 0,
              anchorHit: hits.all,
              anchoredAnswers: hits.anchored,
              anchorHits: hits.hit,
              missing: admitsMissingKnowledge(out.reply),
              unsupported: out.u,
              handoff: out.intent === "human_request",
              foreign:
                foreignNumbers(out.reply, [
                  ...q.answers.flatMap((a) => a.needles),
                  PROPERTY.checkInTime,
                  PROPERTY.checkOutTime,
                  q.text,
                  ...(q.history ?? []).map((h) => h.body),
                ]).length > 0,
            });
          }
        }),
      );
    }
    complete = true;
    expect(rows.filter((r) => !r.invalid).length).toBeGreaterThan(0);
  }, 90 * 60_000);
});
