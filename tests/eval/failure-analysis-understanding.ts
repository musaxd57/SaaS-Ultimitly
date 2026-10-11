import {
  buildUnderstandingUserContent,
  understandGuestMessages,
  understandingEnabled,
  understandingSystemPromptFor,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { callStructuredJson } from "@/lib/ai/semantic/structured-call";
import { semanticApiKey, semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import type { FailureCase, ModelExplanation } from "./failure-analysis";

// ---------------------------------------------------------------------------
// NEDEN ANALİZİ — ANLAMA KATMANI BAĞDAŞTIRICISI (`failure-analysis.ts` döngüsü). Yeniden koşturma = ürünün AYNI anlama çağrısı (önbellek
// sıfırlanır, aynı model / çaba ayarı); açıklama = aynı anlama talimatları + misafir mesajı + verdiği etiketler + testin beklentisi →
// yapılandırılmış beyan (etkileyen ifadeler, neden, şimdi ne verirdi, talimatta kural var mı, beklentiye katılıyor mu, bilgi eksik mi).
// Ücretli: yalnız ölçüm koşusunda (RUN_REAL_EVAL=1) çağrılır.
// ---------------------------------------------------------------------------

/**
 * Anlama katmanını aynı ayarla yeniden koştur → niyet listesi (sıralı) ya da null. 🚨 Katman KAPALIYSA fırlatır: ilk denemede bayrak
 * kapalıydı, katman model çağırmadan "kapalı" döndü ve araç bunu "0/0 başarısız" diye yeşil yazdı (kendini kandıran ölçer, 10-11).
 */
export async function rerunUnderstanding(text: string): Promise<string[] | null> {
  if (!understandingEnabled()) throw new Error("Anlama katmanı kapalı (AI_UNDERSTANDING_ENABLED) — neden analizi koşulamaz.");
  __resetUnderstandingCache();
  const o = await understandGuestMessages({ guestMessage: text, items: true });
  return o.status === "ok" ? o.value.requests.map((q) => q.intent).sort() : null;
}

const SCHEMA = {
  name: "explain_failure",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["influencedBy", "why", "wouldNow", "ruleCoverage", "expectationAgrees", "infoMissing"],
    properties: {
      influencedBy: { type: "array", items: { type: "string" }, description: "Etiketlerini belirleyen ifadeler — misafir mesajından AYNEN kopyala" },
      why: { type: "string", description: "Bu etiketleri neden verdin (kısa)" },
      wouldNow: { type: "string", description: "Şimdi tekrar baksan hangi etiketleri verirdin" },
      ruleCoverage: {
        type: "string",
        enum: ["covered", "not_covered", "unclear"],
        description: "Yukarıdaki talimatlarda bu durumu AÇIKÇA kapsayan bir kural var mıydı",
      },
      expectationAgrees: { type: "boolean", description: "Testin beklediği sonuç sence doğru mu" },
      infoMissing: { type: "boolean", description: "Doğru etiket için mesajda / bağlamda olmayan bir bilgi gerekiyor muydu" },
    },
  },
};

/** Açıklayıcı: `expected` testin beklentisini insan diliyle anlatır (ör. "ev sahibi şikâyeti / iade / insan talebi etiketlerinden biri"). */
export function understandingExplainer(expectedText: (c: FailureCase<string[]>) => string) {
  return async (c: FailureCase<string[]>): Promise<ModelExplanation | null> => {
    const user = [
      "Aşağıda, yukarıdaki anlama talimatlarınla daha önce etiketlediğin bir misafir mesajı, senin verdiğin niyet etiketleri ve testin",
      "beklentisi var. Etiketlerini açıkla: seni hangi ifadeler etkiledi (mesajdan AYNEN), neden bu etiketleri verdin, şimdi ne verirdin,",
      "talimatlarda bu durumu açıkça kapsayan bir kural var mıydı, testin beklentisine katılıyor musun, doğru etiket için eksik bir bilgi var mıydı.",
      "",
      "--- ANLAMA GİRDİSİ ---",
      buildUnderstandingUserContent({ guestMessage: c.text, items: true }),
      "--- VERDİĞİN ETİKETLER ---",
      JSON.stringify(c.observed),
      "--- TESTİN BEKLENTİSİ ---",
      expectedText(c),
    ].join("\n");
    const res = await callStructuredJson({
      apiKey: semanticApiKey() ?? process.env.OPENAI_API_KEY ?? "",
      model: semanticModel("understanding"),
      system: understandingSystemPromptFor({ items: true }),
      user,
      schema: SCHEMA,
      timeoutMs: 120_000,
      maxTokens: 700,
      maxCompletionTokens: 4_000,
      reasoningEffort: semanticReasoningEffort("understanding"),
    });
    if (!res.ok) return null;
    const d = res.data as ModelExplanation;
    return {
      influencedBy: Array.isArray(d.influencedBy) ? d.influencedBy.filter((x) => typeof x === "string").slice(0, 6) : [],
      why: String(d.why ?? ""),
      wouldNow: String(d.wouldNow ?? ""),
      ruleCoverage: d.ruleCoverage === "covered" || d.ruleCoverage === "not_covered" ? d.ruleCoverage : "unclear",
      expectationAgrees: d.expectationAgrees === true,
      infoMissing: d.infoMissing === true,
    };
  };
}
