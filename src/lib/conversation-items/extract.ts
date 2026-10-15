// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — TUR ÇIKARIMI (saf; DB/ağ yok). Cevapsız her misafir mesajı → öğeler (anlama katmanının o mesaja
// atfettiği istekler + kelime ağının o mesajdaki TÜM etiketleri, `core.ts` birleşim kuralı).
//
// 🚨 EMİN OLUNMAYAN TUR ÖĞEYE BÖLÜNMEZ ("degraded" → çağıran BUGÜNKÜ konuşma düzeyi kapıyı koşar): anlama katmanı öğe
// kipinde sonuç vermediyse, bir cevapsız mesajı görmediyse / tamamını okumadıysa, bir isteği mesaja eşleyemediyse, bir
// mesaja hiç istek atfetmediyse ya da istek tavanına dayandıysa. Belirsizlik güvenli değildir — gevşetme yalnız her mesaj
// gerçekten okunup eşlendiğinde.
// ---------------------------------------------------------------------------

import { detectRiskTypes } from "@/lib/ai/fallback";
import {
  MAX_UNDERSTOOD_REQUESTS,
  NOT_FULLY_READ_MARGIN,
  UNDERSTANDING_MESSAGE_CAP,
  understandingWindow,
  type MessageUnderstanding,
  type UnderstandingHistoryEntry,
} from "@/lib/ai/semantic/understanding-schema";
import { buildItemsForMessage, type BuiltItem, type ItemKind } from "./core";
import {
  faultGuardEnabled,
  faultSignal,
  fixHazard,
  isGenericFollowup,
  moneyRequest,
  requestTopics,
  stricterRelation,
  type ItemRelationFacts,
} from "./relation";

export const ITEMS_DEGRADED_REASONS = [
  "understanding_unavailable",
  "window_overflow",
  "message_not_fully_read",
  "message_unidentified",
  "request_unattributed",
  "message_without_request",
  "request_cap",
] as const;
export type ItemsDegradedReason = (typeof ITEMS_DEGRADED_REASONS)[number];

/** Vazgeçilen istek: bu turdaki bir mesajın öğesi ya da daha önceki (cevaplanmış) konuşmadaki aynı türden öğeler. */
export type TurnWithdrawal = { kind: ItemKind; messageId: string } | { kind: ItemKind; earlier: true };

export type TurnItems =
  | {
      mode: "items";
      /**
       * Cevapsız mesajlar (kronolojik): öğeler + kelime ağının o mesajdaki TÜM etiketleri (tur düzeyi karar için) + ilişki kipinde öğe
       * türü başına ilişki olguları (aynı türden iki istek birleşir: en kısıtlayıcı işaret, konuların birleşimi).
       */
      messages: { messageId: string; items: BuiltItem[]; labels: string[]; relations?: Partial<Record<ItemKind, ItemRelationFacts>> }[];
      withdrawals: TurnWithdrawal[];
    }
  | { mode: "degraded"; reason: ItemsDegradedReason };

export function extractTurnItems(input: {
  /** Anlama katmanına giden AYNI kronolojik geçmiş (mesaj kimlikleriyle). */
  history: readonly UnderstandingHistoryEntry[];
  guestMessage: string;
  /** Öğe kipindeki anlama sonucu; yoksa / öğe kipinde değilse tur bölünmez. */
  understanding: MessageUnderstanding | null | undefined;
  /** Kelime ağı (test kancası); varsayılan her tutan ağın etiketi. */
  labelsOf?: (body: string) => string[];
}): TurnItems {
  const u = input.understanding;
  // `withdrawn` yalnız öğe kipinin çözücüsünde vardır: öğe kipinde üretilmemiş sonuç mesaj eşlemesi taşımaz.
  if (!u || !Array.isArray(u.withdrawn)) return { mode: "degraded", reason: "understanding_unavailable" };
  const win = understandingWindow(input.history, input.guestMessage);
  if (win.unseen > 0) return { mode: "degraded", reason: "window_overflow" };
  if (win.unanswered.some((m) => m.body.length > UNDERSTANDING_MESSAGE_CAP - NOT_FULLY_READ_MARGIN)) {
    return { mode: "degraded", reason: "message_not_fully_read" };
  }
  if (win.unanswered.some((m) => !m.id)) return { mode: "degraded", reason: "message_unidentified" };
  // Katman istemde "en fazla 5" der ve çözücü 5'te keser: tavandaki sonuçta görülmemiş istek olabilir.
  if (u.requests.length >= MAX_UNDERSTOOD_REQUESTS) return { mode: "degraded", reason: "request_cap" };
  const n = win.unanswered.length;
  if (u.requests.some((r) => r.message === undefined || r.message > n)) return { mode: "degraded", reason: "request_unattributed" };
  for (let i = 1; i <= n; i++) {
    if (!u.requests.some((r) => r.message === i)) return { mode: "degraded", reason: "message_without_request" };
  }
  const labelsOf = input.labelsOf ?? detectRiskTypes;
  // İlişki kipi: anlama katmanı istek başına işaret verdiyse (öğe kipi + şikâyet takibi anahtarı). Yoksa olgu kurulmaz → plan bugünkü
  // liste kuralını koşar.
  const relationMode = u.requests.some((r) => r.relation !== undefined);
  const faultGuard = faultGuardEnabled();
  const messages = win.unanswered.map((m, i) => {
    const labels = labelsOf(m.body);
    const requests = u.requests.filter((r) => r.message === i + 1);
    let relations: Partial<Record<ItemKind, ItemRelationFacts>> | undefined;
    if (relationMode) {
      relations = {};
      const bodyHazard = fixHazard(m.body);
      for (const r of requests) {
        const prev = relations[r.intent];
        const facts: ItemRelationFacts = {
          relation: r.relation ?? "unclear",
          topics: requestTopics(r.queryTr, r.queryOriginal, r.intent),
          generic: isGenericFollowup(r.queryTr, r.queryOriginal),
          hazard: bodyHazard || fixHazard(r.queryTr) || fixHazard(r.queryOriginal),
          money: moneyRequest(r.queryTr, r.queryOriginal),
          ...(faultGuard && faultSignal(r.queryTr, r.queryOriginal) ? { fault: true } : {}),
        };
        relations[r.intent] = prev
          ? {
              relation: stricterRelation(prev.relation, facts.relation) ?? "unclear",
              topics: [...new Set([...prev.topics, ...facts.topics])].sort(),
              generic: prev.generic && facts.generic,
              hazard: prev.hazard || facts.hazard,
              money: prev.money === true || facts.money === true,
              ...(prev.fault === true || facts.fault === true ? { fault: true } : {}),
            }
          : facts;
      }
    }
    const items = buildItemsForMessage({
      requests: requests.map((r) => ({ intent: r.intent, hint: r.queryTr })),
      lexicalLabels: labels,
    });
    // ARIZA EV SAHİBİNE KALIR (anahtar `AI_FAULT_GUARD_ENABLED`): mesajda cihaz arızası isteği var ama şikâyet / acil öğesi yoksa kod bir
    // şikâyet öğesi EKLER (kaynak `fault_guard`) — ev sahibi bildirimi ve tutulan istek kuralları bu öğe üzerinden koşar. Öğenin kendi
    // ilişki olgusu yalnız ARIZALI isteklerin konularını taşır: aynı mesajdaki bağımsız soru ("Çöpleri nereye atıyoruz?") bağlı sayılmaz.
    // Kelime ağı ETİKETİ olarak eklenmez: atfedilemeyen etiket mesajın TAMAMINI hassas yapardı (`core.buildItemsForMessage`).
    if (faultGuard) {
      const faulty = requests.filter((r) => faultSignal(r.queryTr, r.queryOriginal));
      if (faulty.length > 0 && !items.some((it) => it.kind === "complaint_issue" || it.sensitivity === "emergency")) {
        items.push({
          requestIndex: requests.indexOf(faulty[0]),
          kind: "complaint_issue",
          sensitivity: "sensitive",
          riskType: "complaint",
          sources: ["fault_guard"],
          hint: faulty.map((r) => r.queryTr).join(" · "),
        });
        if (relations) {
          relations.complaint_issue = {
            relation: "own_topic",
            topics: [...new Set(faulty.flatMap((r) => requestTopics(r.queryTr, r.queryOriginal, r.intent)))].sort(),
            generic: false,
            hazard: faulty.some((r) => fixHazard(r.queryTr) || fixHazard(r.queryOriginal)) || fixHazard(m.body),
            money: false,
            fault: true,
          };
        }
      }
    }
    return {
      messageId: m.id as string,
      items,
      labels,
      ...(relations ? { relations } : {}),
    };
  });
  const withdrawals: TurnWithdrawal[] = [];
  for (const w of u.withdrawn) {
    if (w.message === 0) withdrawals.push({ kind: w.intent, earlier: true });
    else if (w.message <= n) withdrawals.push({ kind: w.intent, messageId: win.unanswered[w.message - 1].id as string });
    // Pencere dışını gösteren numara düşer (güvenli yön: emin olunmayan vazgeçme bir öğeyi kapatmaz).
  }
  return { mode: "items", messages, withdrawals };
}
