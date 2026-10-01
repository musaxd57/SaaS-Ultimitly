import { execFileSync } from "node:child_process";
import { replyCallParams } from "@/lib/ai";
import { isReasoningModel } from "@/lib/ai/model-family";
import { semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import { embeddingModel } from "@/lib/ai/embeddings/model";

// ---------------------------------------------------------------------------
// KOŞU KİMLİĞİ — katman bazında model + düşünme ayarı (Aşama 1, kurucu 09-30: "gerçek değerlendirmelerde model ve reasoning
// ayarını kaydet; eski önbellek cevaplarını yeni Luna sonucu sayma").
//
// Her gerçek ölçüm raporu (markdown) ve yan dosyası (JSON) bu bloğu `writeSidecar` üzerinden OTOMATİK taşır: hangi katman hangi
// modelle ve hangi düşünme çabasıyla koştu, hangi commit, hangi ürün bayrakları. Değerler ÜRÜNÜN KENDİ çözücülerinden okunur
// (`OPENAI_MODEL` / `AI_SEMANTIC_MODEL` / gömme modeli) — ölçer ayrı bir kural uyduramaz. Düşünme çabası "gönderilmez" ise
// model kendi varsayılanıyla düşünür (gpt-6-luna varsayılanda düşünür, gpt-5.1 düşünmez) — raporda açıkça yazılır.
// ---------------------------------------------------------------------------

export interface LayerRuntime {
  model: string;
  /** Gönderilen çaba, ya da "gönderilmez (model varsayılanı)" / "yok (klasik model)". */
  reasoning: string;
}

export interface EvalRuntime {
  commit: string | null;
  layers: {
    /** Misafir cevabı (kanal / gelen kutusu / Ayarlar / QR / demo) — `suggestReply`. */
    reply: LayerRuntime;
    /** Anlama katmanı + konaklama bekçisi + yeniden sıralayıcı (aynı yapılandırma, `semantic/config.ts`). */
    semantic: LayerRuntime;
    /** Anlamsal getirme (gömme). */
    embedding: { model: string };
  };
  /** Ürün hattını değiştiren bayraklar — ham değer (boş = "(boş)"). */
  flags: Record<string, string>;
}

/** Hattı değiştiren bayraklar (yalnız okunur; değer yorumu ürünün işi). */
export const PIPELINE_FLAGS = [
  "KB_RETRIEVAL_MODE",
  "KB_SEMANTIC_RETRIEVAL",
  "KB_RERANK_ENABLED",
  "KB_RERANK_PER_QUESTION",
  "KB_RETRIEVAL_WIDE_BUDGET",
  "AI_UNDERSTANDING_ENABLED",
  "AI_STAY_GUARD_ENABLED",
  "AI_CONVERSATION_ITEMS_ENABLED",
  "AI_CONVERSATION_STATE_ENABLED",
  "AI_ACTION_CLAIMS_ENABLED",
  "AI_CODE_GREETING_ENABLED",
  "AI_HOUSE_RULES_SHADOW",
  "AI_KB_FEE_RULE_ENABLED",
  "AI_STAY_DEFERRAL_PLAIN_ENABLED",
  "AI_ACCESS_CODE_COMPLETE_ENABLED",
  "AI_HOST_DECISION_HOLD_ENABLED",
  "AI_COMPLAINT_FOLLOWUP_RULE_ENABLED",
] as const;

/** GÖNDERİLEN çabanın etiketi: klasik modele çaba hiç gitmez; reasoning modelinde ayarsız / tanınmayan değer = gönderilmez. */
export function reasoningLabel(model: string, effort: string | null | undefined): string {
  if (!isReasoningModel(model)) return "yok (klasik model)";
  return effort ?? "gönderilmez (model varsayılanı)";
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function evalRuntime(): EvalRuntime {
  // Cevap katmanı ÜRÜNÜN çağrı parametrelerinden (`replyCallParams` — `callOpenAI` ile aynı fonksiyon): ölçer ayrı kural uyduramaz.
  const reply = replyCallParams();
  const semantic = semanticModel();
  return {
    commit: gitCommit(),
    layers: {
      reply: { model: reply.model, reasoning: reasoningLabel(reply.model, reply.effort) },
      semantic: { model: semantic, reasoning: reasoningLabel(semantic, semanticReasoningEffort()) },
      embedding: { model: embeddingModel() },
    },
    flags: Object.fromEntries(PIPELINE_FLAGS.map((f) => [f, process.env[f]?.trim() || "(boş)"])),
  };
}

const STORED_UNKNOWN = "bilinmiyor (09-30 öncesi koşu)";

/**
 * Yeniden puanlanan ESKİ koşunun kimliği ("eski önbellek cevaplarını yeni Luna sonucu sayma"): yan dosya kimlik taşıyorsa
 * AYNEN; 09-30 öncesi yan dosyada yalnız cevap modeli (`meta.model`) bilinir, gerisi "bilinmiyor". Şu anki ortamın modeli
 * (ör. `OPENAI_MODEL=gpt-6-luna`) eski cevaplara ASLA yazılmaz — bu fonksiyon ortamı OKUMAZ.
 */
export function storedRunRuntime(side: { meta?: { model?: unknown; commit?: unknown } | null; runtime?: EvalRuntime | null }): EvalRuntime {
  if (side.runtime) return side.runtime;
  const meta = side.meta ?? {};
  return {
    commit: typeof meta.commit === "string" ? meta.commit : null,
    layers: {
      reply: { model: typeof meta.model === "string" ? meta.model : STORED_UNKNOWN, reasoning: STORED_UNKNOWN },
      semantic: { model: STORED_UNKNOWN, reasoning: STORED_UNKNOWN },
      embedding: { model: STORED_UNKNOWN },
    },
    flags: {},
  };
}

/** Raporun sonuna eklenen "Koşu kimliği" bölümü (markdown). */
export function evalRuntimeMarkdown(rt: EvalRuntime): string {
  const flagList = Object.entries(rt.flags);
  const flags = flagList.length > 0 ? flagList.map(([k, v]) => `\`${k}=${v}\``).join(" · ") : STORED_UNKNOWN;
  return [
    "",
    "## Koşu kimliği (katman bazında model + düşünme ayarı)",
    "",
    `Commit: \`${rt.commit ?? "?"}\``,
    "",
    "| Katman | Model | Düşünme çabası |",
    "|---|---|---|",
    `| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | \`${rt.layers.reply.model}\` | ${rt.layers.reply.reasoning} |`,
    `| Anlama katmanı + bekçi + yeniden sıralayıcı | \`${rt.layers.semantic.model}\` | ${rt.layers.semantic.reasoning} |`,
    `| Gömme (anlamsal getirme) | \`${rt.layers.embedding.model}\` | — |`,
    "",
    `Bayraklar: ${flags}`,
    "",
    "Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.",
    "",
  ].join("\n");
}
