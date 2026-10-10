import { execFileSync } from "node:child_process";
import { replyCallParams } from "@/lib/ai";
import { decisionWriterCallParams } from "@/lib/decisions/ai-text";
import { isReasoningModel, layerReasoningEffort } from "@/lib/ai/model-family";
import { semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import { embeddingModel } from "@/lib/ai/embeddings/model";
import { createHash } from "node:crypto";
import { replyRequestIdentity } from "@/lib/ai";
import { understandingEnglishQueryEnabled, understandingSystemPromptFor } from "@/lib/ai/semantic/understand";
import { conversationItemsEnabled } from "@/lib/conversation-items/flag";
import { houseRulesShadowEnabled } from "@/lib/house-rules/flag";
import { complaintFollowupRuleEnabled } from "@/lib/ai/complaint-followup";
import type { SuggestReplyInput } from "@/lib/ai/types";

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
    /**
     * Çeviri (`OPENAI_TRANSLATE_MODEL`) ve üslup özeti (`OPENAI_STYLE_MODEL`) — boşsa cevap modeline düşer. `reasoning` = GÖNDERİLEN
     * çaba (`OPENAI_TRANSLATE_REASONING_EFFORT` / `OPENAI_STYLE_REASONING_EFFORT`, ürünün kuralıyla); 10-02 öncesi yan dosyada YOK.
     */
    translate?: { model: string; reasoning?: string };
    style?: { model: string; reasoning?: string };
    /** Ev sahibi karar metni yazıcısı (`AI_DECISION_TEXT_MODEL` → cevap modeli); 10-09 öncesi yan dosyada YOK. */
    decision?: LayerRuntime;
    /** Anlamsal getirme (gömme). */
    embedding: { model: string };
  };
  /** Ürün hattını değiştiren bayraklar — ham değer (boş = "(boş)"). */
  flags: Record<string, string>;
  /**
   * İstem kimliği (10-01, kurucu: "her raporda istem kimliği"): modele giden sistem istemlerinin SHA-256 ilk 12 hanesi.
   * `understandingMode`: anlama isteminin hangi kiple kurulduğu (`understandingModeLabel`) — kimlik bu kipin istemidir.
   */
  prompts?: { reply: string; replyVariant?: string; understanding: string; understandingMode?: string };
}

/**
 * Anlama katmanının kipi (öğe / ev kuralı gölgesi / şikâyet takibi): istemi ve şemayı değiştirir. Ölçer kipi KENDİSİ veriyorsa
 * (konaklama eval'i `EVAL_UNDERSTANDING_*`) istem kimliği o kiple hesaplanır; vermiyorsa ürünün TEK karar noktasıyla
 * (`kb-retrieve.ts`) aynı bayraklardan.
 */
export interface UnderstandingMode {
  items?: boolean;
  rules?: boolean;
  complaintFollowup?: boolean;
  english?: boolean;
}

/**
 * Cevap isteminin ÇAĞRI BAŞINA katmanları (yabancı dil satırı, konuşma öğeleri bloğu ve öğe kipinin sistem katmanları) için SABİT
 * örnek — 10-02: aday kod (Sabah Kararları 53 + 47) ile bugünkü kodun cevap kimliği aynı görünüyordu, çünkü o katmanlar temel istemde
 * yok. Kimlik SİSTEM + KULLANICI istemidir; sabit an (`now`) sayesinde günden güne oynamaz. Metin sentetik (PII yok).
 */
export const REPLY_VARIANT_INPUT: SuggestReplyInput = {
  guestMessage: "Hello! Could you send me your IBAN for the payment? And what is the Wi-Fi password, please?",
  property: { name: "-", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "tr",
  now: new Date(Date.UTC(2026, 8, 30, 9)),
  conversationItems: { answerable: [{ ref: "r1", kind: "wifi", hint: "wifi" }], held: [{ kind: "payment_invoice" }] },
};

/** Kip etiketi — ölçerlerin "anlama kipi" satırıyla aynı söz dizimi (`items+rules+cfu+en`; hiçbiri yoksa `temel`). */
export function understandingModeLabel(m: UnderstandingMode): string {
  return (
    [m.items === true ? "items" : "", m.rules === true ? "rules" : "", m.complaintFollowup === true ? "cfu" : "", m.english === true ? "en" : ""]
      .filter(Boolean)
      .join("+") || "temel"
  );
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
  "AI_COURTESY_RULE_ENABLED",
  // Doğrulanmış müsaitlik misafire giden metni değiştirir (tek kural: her AI_* bayrağı koşu kimliğinde).
  "AI_VERIFIED_AVAILABILITY_ENABLED",
  "AI_VERIFIED_EXTENSION_ENABLED",
  "AI_VERIFIED_QR_ENABLED",
  // Tarih okuması cevap istemini değiştirir (10-10, karar #10).
  "AI_DATE_RESOLUTION_ENABLED",
  // İngilizce köprü sorgusu anlama istemini ve getirmeyi değiştirir (10-10, karar #13).
  "AI_UNDERSTANDING_EN_QUERY_ENABLED",
] as const;

/** GÖNDERİLEN çabanın etiketi: klasik modele çaba hiç gitmez; reasoning modelinde ayarsız / tanınmayan değer = gönderilmez. */
export function reasoningLabel(model: string, effort: string | null | undefined): string {
  if (!isReasoningModel(model)) return "yok (klasik model)";
  return effort ?? "gönderilmez (model varsayılanı)";
}

/** Çeviri / üslup katmanı: model + GÖNDERİLEN çaba (ürünün `layerReasoningEffort` + `isReasoningModel` kuralı). */
function auxLayer(model: string, rawEffort: string | undefined): { model: string; reasoning: string } {
  return { model, reasoning: reasoningLabel(model, layerReasoningEffort(rawEffort)) };
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

export function evalRuntime(opts: { understanding?: UnderstandingMode } = {}): EvalRuntime {
  // Cevap katmanı ÜRÜNÜN çağrı parametrelerinden (`replyCallParams` — `callOpenAI` ile aynı fonksiyon): ölçer ayrı kural uyduramaz.
  const reply = replyCallParams();
  const decision = decisionWriterCallParams();
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
  // Anlama kipi (10-01 bulgusu): konaklama eval'i kipi KENDİ ortam değişkeniyle verir, kimlik ürün bayraklarından hesaplanınca
  // raporlar gerçekte koşan öğe + kural + şikâyet takibi istemi yerine yalnız şikâyet takibi isteminin kimliğini yazdı.
  const given = opts.understanding;
  // Kipi kendisi veren ölçer anlama katmanını da kendisi çağırır (ürün bayrağı oraya ulaşmaz) → yalnız verdiği kip sayılır.
  const mode: UnderstandingMode = given
    ? {
        items: given.items === true,
        rules: given.rules === true,
        complaintFollowup: given.complaintFollowup === true,
        english: given.english === true,
      }
    : {
        items: conversationItemsEnabled(),
        rules: houseRulesShadowEnabled(),
        complaintFollowup: complaintFollowupRuleEnabled(),
        english: understandingEnglishQueryEnabled(),
      };
  const understandingSystem = understandingSystemPromptFor(mode);
  const variant = replyRequestIdentity(REPLY_VARIANT_INPUT);
  return {
    commit: gitCommit(),
    layers: {
      reply: { model: reply.model, reasoning: reasoningLabel(reply.model, reply.effort) },
      semantic: { model: semantic, reasoning: reasoningLabel(semantic, semanticReasoningEffort()) },
      understanding: layer("understanding"),
      guard: layer("guard"),
      rerank: layer("rerank"),
      // Çeviri / üslup: ürün çabayı yalnız reasoning modelinde ve yalnız kapalı kümeden gönderir (`translate.ts`, `index.ts`
      // `isReasoningModel(model) && layerReasoningEffort(...)`) — etiket AYNI iki fonksiyondan (10-02: tablo hep "—" yazıyordu).
      translate: auxLayer(process.env.OPENAI_TRANSLATE_MODEL?.trim() || reply.model, process.env.OPENAI_TRANSLATE_REASONING_EFFORT),
      style: auxLayer(process.env.OPENAI_STYLE_MODEL?.trim() || reply.model, process.env.OPENAI_STYLE_REASONING_EFFORT),
      decision: { model: decision.model, reasoning: reasoningLabel(decision.model, decision.effort) },
      embedding: { model: embeddingModel() },
    },
    flags: Object.fromEntries(PIPELINE_FLAGS.map((f) => [f, process.env[f]?.trim() || "(boş)"])),
    prompts: {
      reply: sha12(replySystem),
      replyVariant: sha12(`${variant.system}\n${variant.user}`),
      understanding: sha12(understandingSystem),
      understandingMode: understandingModeLabel(mode),
    },
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
    ...(rt.layers.translate ? [`| Çeviri | \`${rt.layers.translate.model}\` | ${rt.layers.translate.reasoning ?? "—"} |`] : []),
    ...(rt.layers.style ? [`| Üslup özeti | \`${rt.layers.style.model}\` | ${rt.layers.style.reasoning ?? "—"} |`] : []),
    ...(rt.layers.decision ? [`| Karar metni yazıcısı | \`${rt.layers.decision.model}\` | ${rt.layers.decision.reasoning} |`] : []),
    `| Gömme (anlamsal getirme) | \`${rt.layers.embedding.model}\` | — |`,
    "",
    `Bayraklar: ${flags}`,
    ...(rt.prompts
      ? [
          "",
          `İstem kimliği (SHA-256 ilk 12): cevap \`${rt.prompts.reply}\`` +
            (rt.prompts.replyVariant ? ` (öğe + yabancı dil örneği \`${rt.prompts.replyVariant}\`)` : "") +
            ` · anlama \`${rt.prompts.understanding}\`` +
            (rt.prompts.understandingMode ? ` (kip: ${rt.prompts.understandingMode})` : ""),
        ]
      : []),
    "",
    "Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.",
    "",
  ].join("\n");
}
