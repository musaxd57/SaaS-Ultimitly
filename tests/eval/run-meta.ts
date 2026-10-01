import { execFileSync } from "node:child_process";
import { replyCallParams } from "@/lib/ai";
import { isReasoningModel } from "@/lib/ai/model-family";
import { semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import { embeddingModel } from "@/lib/ai/embeddings/model";
import { createHash } from "node:crypto";
import { replyRequestIdentity } from "@/lib/ai";
import { understandingSystemPromptFor } from "@/lib/ai/semantic/understand";
import { conversationItemsEnabled } from "@/lib/conversation-items/flag";
import { houseRulesShadowEnabled } from "@/lib/house-rules/flag";
import { complaintFollowupRuleEnabled } from "@/lib/ai/complaint-followup";

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
    /** Anlam katmanlarının ortak ayarı (`AI_SEMANTIC_*`, `semantic/config.ts`) — katman ayarı yoksa üçü de bunu kullanır. */
    semantic: LayerRuntime;
    /** Katman bazında GERÇEKTEN kullanılan (10-01: `AI_UNDERSTANDING_MODEL` / `AI_STAY_GUARD_MODEL` / `KB_RERANK_MODEL`). */
    understanding?: LayerRuntime;
    guard?: LayerRuntime;
    rerank?: LayerRuntime;
    /** Çeviri (`OPENAI_TRANSLATE_MODEL`) ve üslup özeti (`OPENAI_STYLE_MODEL`) — boşsa cevap modeline düşer. */
    translate?: { model: string };
    style?: { model: string };
    /** Anlamsal getirme (gömme). */
    embedding: { model: string };
  };
  /** Ürün hattını değiştiren bayraklar — ham değer (boş = "(boş)"). */
  flags: Record<string, string>;
  /** İstem kimliği (10-01, kurucu: "her raporda istem kimliği"): modele giden sistem istemlerinin SHA-256 ilk 12 hanesi. */
  prompts?: { reply: string; understanding: string };
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
  const layer = (l: "understanding" | "guard" | "rerank"): LayerRuntime => {
    const m = semanticModel(l);
    return { model: m, reasoning: reasoningLabel(m, semanticReasoningEffort(l)) };
  };
  const sha12 = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);
  const replySystem = replyRequestIdentity({
    guestMessage: "-",
    property: { name: "-", checkInTime: "15:00", checkOutTime: "11:00" },
    reservation: null,
    knowledgeBase: [],
    history: [],
    tone: "warm",
    language: "tr",
  }).system;
  const understandingSystem = understandingSystemPromptFor({
    items: conversationItemsEnabled(),
    rules: houseRulesShadowEnabled(),
    complaintFollowup: complaintFollowupRuleEnabled(),
  });
  return {
    commit: gitCommit(),
    layers: {
      reply: { model: reply.model, reasoning: reasoningLabel(reply.model, reply.effort) },
      semantic: { model: semantic, reasoning: reasoningLabel(semantic, semanticReasoningEffort()) },
      understanding: layer("understanding"),
      guard: layer("guard"),
      rerank: layer("rerank"),
      translate: { model: process.env.OPENAI_TRANSLATE_MODEL?.trim() || reply.model },
      style: { model: process.env.OPENAI_STYLE_MODEL?.trim() || reply.model },
      embedding: { model: embeddingModel() },
    },
    flags: Object.fromEntries(PIPELINE_FLAGS.map((f) => [f, process.env[f]?.trim() || "(boş)"])),
    prompts: { reply: sha12(replySystem), understanding: sha12(understandingSystem) },
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
    ...(rt.layers.understanding && rt.layers.guard && rt.layers.rerank
      ? [
          `| Anlama katmanı | \`${rt.layers.understanding.model}\` | ${rt.layers.understanding.reasoning} |`,
          `| Konaklama bekçisi | \`${rt.layers.guard.model}\` | ${rt.layers.guard.reasoning} |`,
          `| Yeniden sıralayıcı | \`${rt.layers.rerank.model}\` | ${rt.layers.rerank.reasoning} |`,
        ]
      : [`| Anlama katmanı + bekçi + yeniden sıralayıcı | \`${rt.layers.semantic.model}\` | ${rt.layers.semantic.reasoning} |`]),
    ...(rt.layers.translate ? [`| Çeviri | \`${rt.layers.translate.model}\` | — |`] : []),
    ...(rt.layers.style ? [`| Üslup özeti | \`${rt.layers.style.model}\` | — |`] : []),
    `| Gömme (anlamsal getirme) | \`${rt.layers.embedding.model}\` | — |`,
    "",
    `Bayraklar: ${flags}`,
    ...(rt.prompts ? ["", `İstem kimliği (SHA-256 ilk 12): cevap \`${rt.prompts.reply}\` · anlama \`${rt.prompts.understanding}\``] : []),
    "",
    "Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.",
    "",
  ].join("\n");
}
