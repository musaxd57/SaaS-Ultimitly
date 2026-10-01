// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — TUR PLANININ SAF KISMI (DB/ağ yok). Akış (`flow.ts`) kalıcı satırlarla, ölçüm düzeneği
// (`tests/eval/conversation-items.eval.test.ts`) kurulmuş öğelerle AYNI fonksiyonu çağırır — ürün ile ölçüm ayrışamaz.
// Cevaplanabilir = bu turun hassas OLMAYAN öğeleri (kimlik R1…Rn, mesaj sırasıyla); bırakılanlar = ev sahibinde açık hassas
// öğeler (bu tur + önceki turlar).
// ---------------------------------------------------------------------------

import { complaintDependent, type ItemKind, type ItemRiskFacts, type ItemSensitivity, type ItemsGateInput } from "./core";
import { RELATION_ANCHOR_KINDS, requestDependency, type AnchorFacts, type ItemRelationFacts, type RequestFacts } from "./relation";
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

/** Turun ilişki olguları (`hintKey` → olgu); ilişki kipinde değilse `null`. Ölçüm düzeneği de aynı fonksiyonu çağırır. */
export function relationFactsOf(
  messages: readonly { messageId: string; relations?: Partial<Record<ItemKind, ItemRelationFacts>> }[],
): Map<string, ItemRelationFacts> | null {
  if (!messages.some((m) => m.relations)) return null;
  const out = new Map<string, ItemRelationFacts>();
  for (const m of messages) {
    for (const [kind, f] of Object.entries(m.relations ?? {})) if (f) out.set(hintKey(m.messageId, kind as ItemKind), f);
  }
  return out;
}

export function composeItemsPlan<T extends PlanItem>(input: {
  /** Bu turun açık öğeleri, mesaj sırasıyla. */
  turnItems: readonly T[];
  /**
   * Ev sahibinde açık hassas öğeler (bu tur + önceki turlar). `earlier`: öğe ÖNCEKİ bir turun mesajında (K8, 09-30) — cevap
   * modeline ayrı bölümde gösterilir, modelin risk etiketi ona göre verilmez; kapı yine hepsini tutulan sayar. `messageId`: ilişki
   * kipinde talebin olgularını bulmak için.
   */
  held: readonly (ItemRiskFacts & { earlier?: boolean; messageId?: string })[];
  /** Anlama katmanının kısa Türkçe sorguları (`hintKey`). */
  hints: ReadonlyMap<string, string>;
  /**
   * İlişki kipi (`extract.ItemRelationFacts`, `hintKey` ile): anlama katmanı işaret verdiyse. Verilmezse bugünkü liste kuralı BİREBİR.
   * Tutulan öğeler için mesaj kimliği `held[].messageId`den okunur.
   */
  relations?: ReadonlyMap<string, ItemRelationFacts>;
}): ComposedItemsPlan<T> {
  const relations = input.relations;
  // İlişki kipi (kurucu kararı 10-01 sabah): olgular varsa karar `relation.requestDependency`, yoksa bugünkü liste kuralı BİREBİR.
  const relation = relations ? relationPlan(input.turnItems, input.held, relations) : null;
  // Şikâyete bağlı istek (kurucu kararı 10-01, `core.complaintDependent`): bu turda tutulan şikâyet varken bağımsız bilgi türü
  // olmayan istek cevaplanabilir SAYILMAZ — cevap modeline bırakılan istek olarak gösterilir.
  const dependent = relation
    ? relation.dependent
    : input.turnItems.filter((i) => i.sensitivity === "none" && complaintDependent(i.kind, input.held));
  const answerable = input.turnItems
    .filter((i) => i.sensitivity === "none" && !dependent.includes(i))
    .map((item, idx) => ({ ref: `R${idx + 1}`, item }));
  const relationGate: ItemsGateInput["relation"] = relation
    ? { requests: answerable.map(({ ref, item }) => ({ ...relation.factsOf(item), ref })), anchors: relation.anchors }
    : undefined;
  return {
    answerable,
    replyItems: {
      answerable: answerable.map(({ ref, item }) => ({
        ref,
        kind: item.kind,
        hint: input.hints.get(hintKey(item.messageId, item.kind)) ?? "",
        ...(relation?.fix.has(item) ? { fix: true } : {}),
      })),
      held: [
        ...input.held.map((h) => (h.earlier ? { kind: h.kind, earlier: true } : { kind: h.kind })),
        ...dependent.map((d) => ({ kind: d.kind })),
      ],
    },
    gateItems: {
      held: input.held.map((h) => ({ kind: h.kind, sensitivity: h.sensitivity, riskType: h.riskType, ...(h.earlier ? { earlier: true } : {}) })),
      paymentHeld: input.held.some((h) => h.kind === "payment_invoice" || h.riskType === "platform_policy"),
      answerableKinds: answerable.map((a) => a.item.kind),
      ...(relationGate ? { relation: relationGate } : {}),
    },
    allHeld: answerable.length === 0,
  };
}

/**
 * ÖNCE ANLAM İLİŞKİSİ (kurucu kararı 10-01 sabah, `relation.requestDependency`): bu turun tutulan şikâyeti / iadesi / ev sahibi talebi
 * yanındaki soru, modelin işaretine + kod korumasına göre bağımsız, arıza çözümü ya da bağlı. Bağlı → bırakılan istek. Olgusu bulunmayan
 * istek "belirsiz" sayılır (kurucu: "İlişki belirsizse ilgili soruyu tut").
 */
function relationPlan<T extends PlanItem>(
  turnItems: readonly T[],
  held: readonly (ItemRiskFacts & { earlier?: boolean; messageId?: string })[],
  relations: ReadonlyMap<string, ItemRelationFacts>,
): { dependent: T[]; fix: Set<T>; anchors: AnchorFacts[]; factsOf: (item: T) => RequestFacts } {
  const lookup = (messageId: string | undefined, kind: ItemKind) => (messageId ? relations.get(hintKey(messageId, kind)) : undefined);
  const anchors: AnchorFacts[] = held
    .filter((h) => !h.earlier && RELATION_ANCHOR_KINDS.has(h.kind))
    .map((h) => {
      const f = lookup(h.messageId, h.kind);
      return { kind: h.kind, topics: f?.topics ?? [], hazard: f?.hazard ?? false };
    });
  const factsOf = (i: T): RequestFacts => {
    const f = lookup(i.messageId, i.kind);
    return { kind: i.kind, relation: f?.relation ?? "unclear", topics: f?.topics ?? [], generic: f?.generic ?? false, hazard: f?.hazard ?? false };
  };
  const dependent: T[] = [];
  const fix = new Set<T>();
  for (const i of turnItems) {
    if (i.sensitivity !== "none") continue;
    const d = requestDependency(factsOf(i), anchors);
    if (d === "dependent") dependent.push(i);
    else if (d === "fix") fix.add(i);
  }
  return { dependent, fix, anchors, factsOf };
}
