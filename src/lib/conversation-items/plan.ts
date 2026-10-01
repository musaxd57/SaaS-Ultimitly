// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — TUR PLANININ SAF KISMI (DB/ağ yok). Akış (`flow.ts`) kalıcı satırlarla, ölçüm düzeneği
// (`tests/eval/conversation-items.eval.test.ts`) kurulmuş öğelerle AYNI fonksiyonu çağırır — ürün ile ölçüm ayrışamaz.
// Cevaplanabilir = bu turun hassas OLMAYAN öğeleri (kimlik R1…Rn, mesaj sırasıyla); bırakılanlar = ev sahibinde açık hassas
// öğeler (bu tur + önceki turlar).
// ---------------------------------------------------------------------------

import { complaintDependent, type ItemKind, type ItemRiskFacts, type ItemSensitivity, type ItemsGateInput } from "./core";
import type { ReplyItemsInput } from "./reply-block";

type PlanItem = { messageId: string; kind: ItemKind; sensitivity: ItemSensitivity };

export interface ComposedItemsPlan<T extends PlanItem> {
  answerable: { ref: string; item: T }[];
  replyItems: ReplyItemsInput;
  gateItems: ItemsGateInput;
  /** Bu turun öğelerinin HEPSİ hassas → cevap modeline öğe bloğu verilmez. */
  allHeld: boolean;
}

/** İpucu anahtarı (mesaj + tür — bir mesajda her tür bir öğedir). */
export function hintKey(messageId: string, kind: ItemKind): string {
  return `${messageId}\u0000${kind}`;
}

export function composeItemsPlan<T extends PlanItem>(input: {
  /** Bu turun açık öğeleri, mesaj sırasıyla. */
  turnItems: readonly T[];
  /**
   * Ev sahibinde açık hassas öğeler (bu tur + önceki turlar). `earlier`: öğe ÖNCEKİ bir turun mesajında (K8, 09-30) — cevap
   * modeline ayrı bölümde gösterilir, modelin risk etiketi ona göre verilmez; kapı yine hepsini tutulan sayar.
   */
  held: readonly (ItemRiskFacts & { earlier?: boolean })[];
  /** Anlama katmanının kısa Türkçe sorguları (`hintKey`). */
  hints: ReadonlyMap<string, string>;
}): ComposedItemsPlan<T> {
  // Şikâyete bağlı istek (kurucu kararı 10-01, `core.complaintDependent`): bu turda tutulan şikâyet varken bağımsız bilgi türü
  // olmayan istek cevaplanabilir SAYILMAZ — cevap modeline bırakılan istek olarak gösterilir.
  const dependent = input.turnItems.filter((i) => i.sensitivity === "none" && complaintDependent(i.kind, input.held));
  const answerable = input.turnItems
    .filter((i) => i.sensitivity === "none" && !dependent.includes(i))
    .map((item, idx) => ({ ref: `R${idx + 1}`, item }));
  return {
    answerable,
    replyItems: {
      answerable: answerable.map(({ ref, item }) => ({ ref, kind: item.kind, hint: input.hints.get(hintKey(item.messageId, item.kind)) ?? "" })),
      held: [
        ...input.held.map((h) => (h.earlier ? { kind: h.kind, earlier: true } : { kind: h.kind })),
        ...dependent.map((d) => ({ kind: d.kind })),
      ],
    },
    gateItems: {
      held: input.held.map((h) => ({ kind: h.kind, sensitivity: h.sensitivity, riskType: h.riskType, ...(h.earlier ? { earlier: true } : {}) })),
      paymentHeld: input.held.some((h) => h.kind === "payment_invoice" || h.riskType === "platform_policy"),
      answerableKinds: answerable.map((a) => a.item.kind),
    },
    allHeld: answerable.length === 0,
  };
}
