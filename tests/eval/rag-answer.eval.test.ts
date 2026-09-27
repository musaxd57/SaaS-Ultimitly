import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { replyRequestIdentity, suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { auditClaims } from "@/lib/ai/claim-support";
import { buildReplyPrompt } from "@/lib/ai/prompts";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { llmCached } from "./rag-lab/cache";
import { replyCacheKey } from "./rag-lab/cache-keys";
import { runPipeline, type LabQuery } from "./rag-lab/core";
import { parseConfig } from "./rag-lab/config";
import { buildScaleLab, kbForQuery, loadScaleFile } from "./rag-lab/scale-set";
import { answerAnchorHits, foreignNumbers, numericAnchors } from "./rag-lab/answer-metrics";
import { caseVerdict } from "./rag-lab/answer-acceptance";
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
/**
 * Gruplar: varsayılan dört grup (09-27 ücretli önbelleğiyle eşleşir). HOLDOUT KABULÜ (kurucu kararı 09-27) çelişki / eski sürüm / taslak
 * gruplarını da ister — "çelişkide kesin konuşmama" ve "sıfır sızıntı" yalnız o gruplarda ölçülür; `EVAL_RAG_ANSWER_GROUPS` ile verilir.
 */
const ALL_GROUPS = ["single_tr", "single_xx", "multi", "neg", "conflict", "version", "draft"] as const;
const GROUPS: readonly string[] =
  process.env.EVAL_RAG_ANSWER_GROUPS?.split(",").map((g) => g.trim()).filter(Boolean) ??
  (process.env.EVAL_RAG_ANSWER_SPLIT === "holdout" ? ALL_GROUPS : ["single_tr", "single_xx", "multi", "neg"]);
const KB_MODE = process.env.EVAL_RAG_ANSWER_KB === "perq" ? "perq" : "full";
const PERQ_SIZE = Math.max(1, Math.trunc(Number(process.env.EVAL_RAG_ANSWER_PERQ_SIZE) || 60));
const PROPERTY = { name: "Lale Evleri", checkInTime: "15:00", checkOutTime: "11:00" };
/**
 * Eşzamanlı işçi (varsayılan 1) ve 429 sonrası yeniden deneme (09-27: 3 işçiyle gpt-5.1 dakikalık token sınırına takıldı; 252
 * cevap yedeğe düştü ve rapora HİÇ girmeden kayboldu). Dakikalık tavan `RAG_LAB_RPM` ile (önerilen 8: cevap isteği ~17,5k token).
 */
const WORKERS = Math.max(1, Math.min(4, Math.trunc(Number(process.env.EVAL_RAG_ANSWER_WORKERS) || 1)));
const RETRIES = 3;
/**
 * KÖR İNCELEME DÖKÜMÜ (kurucu 09-27: "Kalan adayların son kararını bağımsız kör inceleyici versin"): kırmızı adaylarla "cevap
 * kaçırıldı" vakalarının içeriği (soru · cevap cümleleri · model yanıtı) bu JSON dosyasına yazılır — RAPORA DEĞİL. YALNIZ dev kümesinde
 * (holdout içeriği açılmaz; holdout'ta döküm istemek hatadır).
 */
const DUMP = process.env.EVAL_RAG_ANSWER_DUMP?.trim() || null;
if (DUMP && SPLIT === "holdout") throw new Error("holdout içeriği dökülmez (EVAL_RAG_ANSWER_DUMP yalnız dev)");

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
  /** VAKA KABULÜ (kurucu kararı 09-27): müşteriye giden cevap kırmızı mı ve neden (kapalı küme, `answer-acceptance.ts`). */
  red?: boolean;
  reasons?: string[];
  /** Cevaplanabilir soruda somut cevap yok, yanlış da yok (dürüst devir / yalnız sözel). */
  handedOff?: boolean;
  /** `answer` = cevap blokta VARKEN verilmedi ("cevap kaçırıldı") · `retrieval` = cevap bloğa girmedi (kurucu 09-27). */
  missed?: "answer" | "retrieval" | null;
  /** Önbellekteki (ücretli çağrı anındaki kodla hesaplanmış) iddia denetimi — `unsupported` BUGÜNKÜ kodla yeniden hesaplanır. */
  unsupportedCached?: number;
}

interface DumpCase {
  config: string;
  qid: string;
  group: string;
  question: string;
  history: string[];
  answers: string[];
  reply: string;
  reasons: string[];
  missed: "answer" | "retrieval" | null;
  /** İddia denetiminin desteksiz bulduğu CÜMLELER (cümle cümle denetimle bulunur; inceleme kolaylığı, hüküm değil). */
  unsupportedSentences: string[];
  /** Yanıttaki (cevap cümlelerinde olmayan) sayıların modelin GÖRDÜĞÜ blokta geçtiği cümleler — kör inceleyici "yanlış bilgi" ile
   * "doğru ek bilgi"yi ayırabilsin (hüküm değil, kanıt). */
  blockEvidence: string[];
}

/**
 * Yanıttaki cevap-dışı sayıların blokta geçtiği cümleler: sayı başına, yanıtla SÖZCÜK ortaklığı en yüksek TEK cümle (en çok 4, kalem
 * başlığıyla). Salt sayı eşleşmesi gürültülüydü ("20 derece" ↔ taksi ücretindeki "yüzde 20").
 */
function blockEvidenceFor(reply: string, answers: readonly { needles: readonly string[] }[], items: readonly { title: string; content: string }[]): string[] {
  const own = new Set(answers.flatMap((a) => a.needles.flatMap((n) => numericAnchors(n))));
  const wanted = numericAnchors(reply).filter((a) => !own.has(a));
  if (wanted.length === 0) return [];
  const words = (t: string) => new Set(t.toLocaleLowerCase("tr").match(/\p{L}{5,}/gu) ?? []);
  const replyWords = words(reply);
  const sentences = items.flatMap((it) => it.content.split(/(?<=[.!?])\s+/).map((sentence) => ({ it, sentence: sentence.trim(), anchors: new Set(numericAnchors(sentence)) })));
  const out: string[] = [];
  for (const w of wanted) {
    let best: { text: string; score: number } | null = null;
    for (const x of sentences) {
      if (!x.anchors.has(w)) continue;
      const score = [...words(`${x.it.title} ${x.sentence}`)].filter((t) => replyWords.has(t)).length;
      if (!best || score > best.score) best = { text: `${x.it.title}: ${x.sentence}`, score };
    }
    if (best && best.score > 0 && !out.includes(best.text)) out.push(best.text);
    if (out.length >= 4) break;
  }
  return out;
}

describe.skipIf(!enabled)("RAG CEVAP DÜZEYİ (gerçek cevap modeli)", () => {
  const rows: AnswerRow[] = [];
  const dump: DumpCase[] = [];
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
      "Desteksiz iddia BUGÜNKÜ iddia denetimiyle yeniden hesaplanır (önbellekteki değer ücretli çağrı anındaki kodla; parantezde).",
      "cevap kaçırıldı = cevap blokta VARKEN verilmedi (başarı değil, kırmızı değil; kurucu 09-27) · getirme kaçırdı = cevap bloğa girmedi",
      "(dürüst devir o durumda doğru davranış).",
      "",
      "| yapılandırma | grup | n | blokta | sayılı | sayı cevapta | cevap düzeyi | bilgim-yok | devir | desteksiz iddia | yabancı sayı | KIRMIZI aday | cevap kaçırıldı | getirme kaçırdı |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ];
    for (const cfg of CONFIGS) {
      for (const g of GROUPS) {
        const rs = rows.filter((r) => r.config === cfg.name && r.group === g && !r.invalid && paired.has(r.qid));
        if (rs.length === 0) continue;
        const anchored = rs.filter((r) => r.anchored);
        const perAnswer = `${rs.reduce((n, r) => n + (r.anchorHits ?? 0), 0)}/${rs.reduce((n, r) => n + (r.anchoredAnswers ?? 0), 0)}`;
        lines.push(
          `| ${cfg.name} | ${g} | ${rs.length} | ${g === "neg" ? "—" : rs.filter((r) => r.inBlock).length} | ${anchored.length} | ${anchored.filter((r) => r.anchorHit).length} | ${perAnswer} | ${rs.filter((r) => r.missing).length} | ${rs.filter((r) => r.handoff).length} | ${rs.filter((r) => r.unsupported > 0).length} (${rs.filter((r) => (r.unsupportedCached ?? r.unsupported) > 0).length}) | ${rs.filter((r) => r.foreign).length} | ${rs.filter((r) => r.red).length} | ${rs.filter((r) => r.missed === "answer").length} | ${rs.filter((r) => r.missed === "retrieval").length} |`,
        );
      }
    }
    // Kırmızı vakalar (kimlik + sebep; içerik YOK — holdout metni rapora girmez).
    const reds = rows.filter((r) => !r.invalid && r.red);
    lines.push(
      "",
      `KIRMIZI ADAY vakalar (${reds.length}; kurucu kararı 09-27 — müşteriye giden cevap: kanıtsız iddia / yanlış sayı / başka olgu / uydurma /`,
      "çelişkide kesin saat / sızıntı). ⚠️ ADAY: son hüküm bağımsız KÖR inceleyicinin (kurucu 09-27; yardımcı model yalnız ön eleme); `baska_olgu`",
      "= yalnız bloktaki BAŞKA kalemin sayısı (yanlış yere verilmiş bilgi ya da doğru ek bilgi — kodla ayrılamaz).",
    );
    for (const r of reds) lines.push(`- ${r.config} · ${r.qid} · ${(r.reasons ?? []).join(", ")}`);
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `rag-answer-${stamp}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `rag-answer-${stamp}-${n}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "rag-answer", version: 1, meta: { commit, split: SPLIT, perGroup: PER_GROUP, kb: KB_MODE, ...(KB_MODE === "perq" ? { perqSize: PERQ_SIZE } : {}) }, rows });
    if (DUMP && SPLIT === "dev") writeFileSync(DUMP, `${JSON.stringify({ commit, split: SPLIT, cases: dump }, null, 1)}\n`);
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
            const allowedTexts = [PROPERTY.checkInTime, PROPERTY.checkOutTime, q.text, ...(q.history ?? []).map((h) => h.body)];
            const inBlock = q.answers.length > 0 && q.answers.every((a) => a.needles.some((n) => run.text.includes(n)));
            // İddia denetimi BUGÜNKÜ kodla, modelin gördüğü AYNI bağlamla (istem kurucusu ağa çıkmaz): önbellekteki `u` ücretli çağrı
            // anındaki kodla hesaplanmıştı; denetim o günden beri değiştiyse eski yanlış alarm ölçüye taşınırdı.
            const claimContext = buildReplyPrompt(input).claimContext;
            const unsupported = auditClaims(out.reply, claimContext).u;
            const verdict = caseVerdict({
              group: q.group,
              answers: q.answers,
              forbiddenNeedles: q.forbiddenNeedles,
              conflict: q.conflictOk === true,
              reply: out.reply,
              unsupported,
              allowedTexts,
              inBlock,
              blockTexts: run.result.items.map((i) => `${i.title} ${i.content}`),
            });
            if (DUMP && (verdict.red || verdict.missed === "answer")) {
              dump.push({
                config: cfg.name,
                qid: q.id,
                group: q.group,
                question: q.text,
                history: (q.history ?? []).map((h) => `${h.direction}: ${h.body}`),
                answers: q.answers.map((a) => a.needles[0] ?? ""),
                reply: out.reply,
                reasons: verdict.reasons,
                missed: verdict.missed,
                unsupportedSentences:
                  unsupported > 0
                    ? out.reply
                        .split(/(?<=[.!?])\s+|\n+/)
                        .map((t) => ({ t, a: auditClaims(t, claimContext) }))
                        .filter(({ t, a }) => t.trim() && a.u > 0)
                        .map(({ t, a }) => `[${a.uc.join("/")}] ${t}`)
                    : [],
                blockEvidence: blockEvidenceFor(out.reply, q.answers, run.result.items),
              });
            }
            rows.push({
              config: cfg.name,
              qid: q.id,
              group: q.group,
              inBlock,
              anchored: hits.anchored > 0,
              anchorHit: hits.all,
              anchoredAnswers: hits.anchored,
              anchorHits: hits.hit,
              missing: admitsMissingKnowledge(out.reply),
              unsupported,
              unsupportedCached: out.u,
              handoff: out.intent === "human_request",
              foreign:
                foreignNumbers(out.reply, [
                  ...q.answers.flatMap((a) => a.needles),
                  PROPERTY.checkInTime,
                  PROPERTY.checkOutTime,
                  q.text,
                  ...(q.history ?? []).map((h) => h.body),
                ]).length > 0,
              red: verdict.red,
              reasons: verdict.reasons,
              handedOff: verdict.handedOff,
              missed: verdict.missed,
            });
          }
        }),
      );
    }
    complete = true;
    expect(rows.filter((r) => !r.invalid).length).toBeGreaterThan(0);
    if (SPLIT === "holdout") {
      // KABUL (kurucu kararı 09-27): holdout'ta eksik koşu kabul değildir — tüm gruplar koşulur (çelişki / sızıntı yalnız kendi
      // gruplarında ölçülür), üretilemeyen cevap olmaz. Vaka kırmızıları şimdilik ADAY (rapor): ölçücü kuru koşuda ~%50 isabetli,
      // kesin kırmızı insan incelemesiyle — kural kurucu kararı bekliyor (task #202); o zamana kadar kapı DEĞİL.
      expect(ALL_GROUPS.filter((g) => !GROUPS.includes(g))).toEqual([]);
      expect(rows.filter((r) => r.invalid).map((r) => `${r.config} · ${r.qid}`)).toEqual([]);
    }
  }, 90 * 60_000);
});
