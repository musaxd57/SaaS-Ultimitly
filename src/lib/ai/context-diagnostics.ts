import { isAnsweringOutbound } from "@/lib/message-author";

// ---------------------------------------------------------------------------
// BAĞLAM KURUCU TANISI (kurucu talimatı 2026-09-07, "Conversation Context Contract" madde 11: "A context builder must return structured
// diagnostics: included message ids, omitted count, oldest included timestamp, total characters/tokens, pending-message count and whether
// older memory was used. These diagnostics must contain no raw guest PII in logs."). SAF ve yaprak: seçicinin (`selectHistoryForPrompt`)
// girdisi + çıktısından hesaplanır, seçimi DEĞİŞTİRMEZ. Metin TAŞIMAZ — yalnız kimlik / sayı / zaman. Yazıldığı yer: yapay zekâ üretim izi
// (`AiGeneration.contextDiagnosticsJson`, anahtar `AI_GENERATION_TRACE_ENABLED`).
// ---------------------------------------------------------------------------

export interface ContextDiagnostics {
  v: 1;
  /** İsteme giren mesajların kimlikleri (kronolojik; kimlik biçimi dışındaki değer yazılmaz). */
  includedIds: string[];
  includedCount: number;
  /** Konuşmada olup isteme GİRMEYEN mesaj sayısı (tavan / bütçe). */
  omittedCount: number;
  /** İsteme giren en eski mesajın zamanı (ISO) — yoksa null. */
  oldestIncludedAt: string | null;
  /** İsteme giren gövdelerin toplam karakteri. */
  totalChars: number;
  /** Son operatif cevaptan SONRA gelen cevapsız misafir mesajı sayısı (güvenlik penceresi — konuşmanın TAMAMINDAN). */
  pendingCount: number;
  /** Bunlardan isteme girenler (güvenlik penceresi tavana takıldıysa < pendingCount). */
  pendingIncludedCount: number;
  /** Pencere dışı eski hafıza (özet / açık konu notu) kullanıldı mı — kanal yolunda yok. */
  olderMemoryUsed: boolean;
}

const ID_SHAPE = /^[A-Za-z0-9_-]{6,64}$/;

export function contextDiagnostics<
  T extends { id?: string | null; direction: "inbound" | "outbound"; body: string; author?: string; createdAt?: Date | null },
>(history: readonly T[], selected: readonly T[], opts: { olderMemoryUsed?: boolean } = {}): ContextDiagnostics {
  const included = new Set<T>(selected);
  let lastAnswer = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (isAnsweringOutbound(history[i])) {
      lastAnswer = i;
      break;
    }
  }
  let pendingCount = 0;
  let pendingIncludedCount = 0;
  for (let i = lastAnswer + 1; i < history.length; i++) {
    if (history[i].direction !== "inbound") continue;
    pendingCount++;
    if (included.has(history[i])) pendingIncludedCount++;
  }
  let oldest: Date | null = null;
  for (const m of selected) if (m.createdAt instanceof Date && (oldest === null || m.createdAt < oldest)) oldest = m.createdAt;
  return {
    v: 1,
    includedIds: selected.map((m) => m.id).filter((id): id is string => typeof id === "string" && ID_SHAPE.test(id)).slice(0, 50),
    includedCount: selected.length,
    omittedCount: Math.max(0, history.length - selected.length),
    oldestIncludedAt: oldest ? oldest.toISOString() : null,
    totalChars: selected.reduce((n, m) => n + m.body.length, 0),
    pendingCount,
    pendingIncludedCount,
    olderMemoryUsed: opts.olderMemoryUsed === true,
  };
}
