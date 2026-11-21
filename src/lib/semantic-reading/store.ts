import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// ANLAM OKUMASI GÖLGE KAYDI — TEK YAZICI (migration 99; kurucu 11-18 akşam: "anlamı model güçlerine bırak … doğru anlandığına dair anlama
// şekli ve nedeni tutulsun"). Bir mesajı modelin NASIL okuduğu, kodun doğrulaması ve bugünkü kuralın kararıyla kıyas. Davranışı değiştirmez;
// ölçüm ve teşhis içindir. Katman ve sonuç KAPALI KÜMEDİR (serbest metin yazılmaz); ayrıntı JSON'u çağıran katmanın kapalı biçimidir.
// Mesaj + katman başına TEK satır: aynı mesaj yeniden okunmaz (yeniden deneme / iki eşzamanlı tur ikinci satır yazmaz).
// Gizlilik: satır konuşmayla birlikte, saklama süresinde ve misafir silme talebinde silinir (`data-retention.ts` (3), `erasure.ts`).
// ---------------------------------------------------------------------------

/** Okuma katmanları. Yeni katman buraya eklenir (şema değişmez). */
export const SEMANTIC_LAYERS = ["host_commitment", "reply_items", "reply_language"] as const;
export type SemanticLayerName = (typeof SEMANTIC_LAYERS)[number];

/**
 * Okumanın sonucu. `ok` = model okudu ve cevap doğrulandı. `budget` = günlük sınır doldu, model ÇAĞRILMADI (bugünkü kuralın kararı yine
 * yazılır). Kalanlar okuyucunun hata kodlarıdır (`structured-call.ts` + okuyucu): çağrı yapılamadı ya da cevap kullanılamadı.
 */
export const SEMANTIC_OUTCOMES = [
  "ok",
  "budget",
  // Aday seçildikten sonra okunacak girdi kalmadı (ör. açık istekler kapandı): model çağrılmadı, aday yeniden seçilmesin diye yazılır.
  "no_input",
  "no_key",
  "too_long",
  "timeout",
  "network",
  "http",
  "parse",
  "truncated",
  "refusal",
  "too_large",
  "bad_shape",
  "exception",
] as const;
export type SemanticOutcome = (typeof SEMANTIC_OUTCOMES)[number];

/** Bilinmeyen hata kodu kayda serbest metin olarak GİRMEZ: kapalı kümede değilse `exception`. Saf. */
export function semanticOutcomeOf(code: string): SemanticOutcome {
  return (SEMANTIC_OUTCOMES as readonly string[]).includes(code) ? (code as SemanticOutcome) : "exception";
}

/** Ayrıntı JSON'unun tavanı (karakter). Aşan ayrıntı yazılmaz (kırpılmış JSON okunamaz) — satırın geri kalanı yine yazılır. */
export const SEMANTIC_DETAIL_MAX = 8_000;

export interface SemanticReadingInput {
  organizationId: string;
  conversationId: string;
  messageId: string;
  layer: SemanticLayerName;
  outcome: SemanticOutcome;
  lexicalDecision?: string | null;
  modelDecision?: string | null;
  agreement?: string | null;
  /** JSON'a çevrilebilir, katmanın kapalı biçimi. `undefined` / `null` → ayrıntı yok. */
  detail?: unknown;
  model?: string | null;
  promptId?: string | null;
  latencyMs?: number | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Okumayı kaydet. Dönüş: BU çağrı satırı yazdı mı (aynı mesaj + katman için satır zaten varsa `false` — tekillik; hata değil).
 * Konuşma arada silindiyse (yabancı anahtar) fırlatır; çağıran en iyi çaba olarak yutar (gölge kaydı hiçbir akışı durdurmaz).
 */
export async function recordSemanticReading(db: Db, input: SemanticReadingInput): Promise<boolean> {
  let detailJson: string | null = null;
  if (input.detail !== undefined && input.detail !== null) {
    const json = JSON.stringify(input.detail);
    if (json.length <= SEMANTIC_DETAIL_MAX) detailJson = json;
  }
  const latency = typeof input.latencyMs === "number" && Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(input.latencyMs)) : null;
  const res = await db.semanticReading.createMany({
    data: [
      {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        layer: input.layer,
        outcome: input.outcome,
        lexicalDecision: input.lexicalDecision ?? null,
        modelDecision: input.modelDecision ?? null,
        agreement: input.agreement ?? null,
        detailJson,
        model: input.model ?? null,
        promptId: input.promptId ?? null,
        latencyMs: latency,
      },
    ],
    skipDuplicates: true,
  });
  return res.count === 1;
}
