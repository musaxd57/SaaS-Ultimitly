// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — TUR PLANININ SAF KISMI (DB/ağ yok). Akış (`flow.ts`) kalıcı satırlarla, ölçüm düzeneği
// (`tests/eval/conversation-items.eval.test.ts`) kurulmuş öğelerle AYNI fonksiyonu çağırır — ürün ile ölçüm ayrışamaz.
// Cevaplanabilir = bu turun hassas OLMAYAN öğeleri (kimlik R1…Rn, mesaj sırasıyla); bırakılanlar = ev sahibinde açık hassas
// öğeler (bu tur + önceki turlar).
// ---------------------------------------------------------------------------

import { complaintDependent, type ItemKind, type ItemRiskFacts, type ItemSensitivity, type ItemsGateInput } from "./core";
import {
  RELATION_ANCHOR_KINDS,
  deviceTopicsOf,
  requestDependency,
  requestTopics,
  type AnchorFacts,
  type ItemRelationFacts,
  type RequestFacts,
} from "./relation";
import type { ReplyItemsInput } from "./reply-block";
import { needTerms, topicAbsenceEnabled } from "./topic-absence";
import { answerPartsEnabled } from "@/lib/ai/answer-parts";

type PlanItem = { messageId: string; kind: ItemKind; sensitivity: ItemSensitivity; ordinal?: number };

export interface ComposedItemsPlan<T extends PlanItem> {
  answerable: { ref: string; item: T }[];
  replyItems: ReplyItemsInput;
  gateItems: ItemsGateInput;
  /** Bu turun öğelerinin HEPSİ hassas → cevap modeline öğe bloğu verilmez. */
  allHeld: boolean;
}

/**
 * İpucu anahtarı (mesaj + tür; sıra kipinde aynı türden ikinci istek "tür#sıra" — `extract` olgu ve sorgu haritalarını AYNI biçimle
 * kurar). Sıra 0'da anahtar bugünkünün bayt bayt aynısı.
 */
export function hintKey(messageId: string, kind: ItemKind | string, ordinal = 0): string {
  return `${messageId}\u0000${kind}${ordinal > 0 ? `#${ordinal}` : ""}`;
}

/**
 * Turun CİHAZ ARIZASI istekleri (`hintKey`; anahtar `AI_FAULT_GUARD_ENABLED` — `extract` yalnız açıkken yazar). Boşsa `null` → plan bayt bayt
 * bugünkü. Ölçüm düzeneği de aynı fonksiyonu çağırır.
 */
export function faultRequestsOf(messages: readonly { messageId: string; faultKinds?: readonly string[] }[]): Set<string> | null {
  const out = new Set<string>();
  // Anahtar "tür" ya da sıra kipinde "tür#sıra" (`extract.keyOf`) — `hintKey` aynı biçimi kurar.
  for (const m of messages) for (const k of m.faultKinds ?? []) out.add(hintKey(m.messageId, k as ItemKind));
  return out.size > 0 ? out : null;
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
  held: readonly (ItemRiskFacts & { earlier?: boolean; messageId?: string; ordinal?: number })[];
  /** Anlama katmanının kısa Türkçe sorguları (`hintKey`). */
  hints: ReadonlyMap<string, string>;
  /**
   * Tür başına isteğin BÜTÜN sorguları (Türkçe + özgün dil, `hintKey`; konu bazlı "bilgim yok" eşlemesi — kurucu 10-22 Soru 1). Verilmezse
   * yalnız ipucu sorgusu okunur. Yalnız `AI_TOPIC_ABSENCE_ENABLED` açıkken kapı girdisine girer.
   */
  needQueries?: ReadonlyMap<string, readonly string[]>;
  /**
   * İlişki kipi (`extract.ItemRelationFacts`, `hintKey` ile): anlama katmanı işaret verdiyse. Verilmezse bugünkü liste kuralı BİREBİR.
   * Tutulan öğeler için mesaj kimliği `held[].messageId`den okunur.
   */
  relations?: ReadonlyMap<string, ItemRelationFacts>;
  /**
   * İsteme giren bilgi tabanının TARİF kalemlerinin konuları (`relation.kbRecipeTopics`). Arıza çözümü yalnız konusu burada olan
   * isteğe sunulur; verilmezse hiçbir istek tarifli sayılmaz (bilinmiyor = tut).
   */
  kbRecipeTopics?: ReadonlySet<string>;
  /**
   * Cihaz arızası istekleri (`faultRequestsOf`; anahtar `AI_FAULT_GUARD_ENABLED`). LİSTE kipinde bunlar ev sahibine bırakılır (bağımsız tür
   * olsa da — Wi-Fi / otopark / anahtar arızası). İlişki kipinde karar `requestDependency`de (sentetik şikâyetin konusu = arızalı isteğin
   * konusu → örtüşme; tarif varsa çözüm). Verilmezse bugünkü kural BİREBİR.
   */
  faultRequests?: ReadonlySet<string>;
}): ComposedItemsPlan<T> {
  const relations = input.relations;
  // İlişki kipi (kurucu kararı 10-01 sabah): olgular varsa karar `relation.requestDependency`, yoksa bugünkü liste kuralı BİREBİR.
  const relation = relations ? relationPlan(input.turnItems, input.held, relations, input.kbRecipeTopics ?? new Set()) : null;
  // Şikâyete bağlı istek (kurucu kararı 10-01, `core.complaintDependent`): bu turda tutulan şikâyet varken bağımsız bilgi türü
  // olmayan istek cevaplanabilir SAYILMAZ — cevap modeline bırakılan istek olarak gösterilir.
  const faulty = (i: T) => input.faultRequests?.has(hintKey(i.messageId, i.kind, i.ordinal)) === true;
  // Arızalı istek, ilişki kipinde bile kendi konusu şikâyetle örtüşmediyse (konu çıkarılamadı) "bağımsız" kalmasın: yalnız tarifli
  // çözüm (`fix`) cevaplanabilir.
  const dependent = relation
    ? [...relation.dependent, ...input.turnItems.filter((i) => i.sensitivity === "none" && faulty(i) && !relation.dependent.includes(i) && !relation.fix.has(i))]
    : input.turnItems.filter((i) => i.sensitivity === "none" && (complaintDependent(i.kind, input.held) || faulty(i)));
  const answerable = input.turnItems
    .filter((i) => i.sensitivity === "none" && !dependent.includes(i))
    .map((item, idx) => ({ ref: `R${idx + 1}`, item }));
  const relationGate: ItemsGateInput["relation"] = relation
    ? { requests: answerable.map(({ ref, item }) => ({ ...relation.factsOf(item), ref })), anchors: relation.anchors }
    : undefined;
  // Ev sahibine bırakılan arızaların cihazları (kör set 5): bu turun tutulan öğeleri + bağlı istekler; cevaplanan isteklerin konuları
  // çıkarılır (arıza tarifi kendi cihazına değinir). İlişki kipinde olgulardan, yoksa anlama katmanının ipucu sorgusundan.
  const topicsOfItem = (item: { messageId?: string; kind: ItemKind; ordinal?: number }): readonly string[] => {
    const key = item.messageId ? hintKey(item.messageId, item.kind, item.ordinal) : null;
    const facts = key && relations ? relations.get(key) : undefined;
    return facts ? facts.topics : requestTopics((key && input.hints.get(key)) || "", "", item.kind);
  };
  const answeredTopics = new Set(answerable.flatMap(({ item }) => topicsOfItem(item)));
  const heldDeviceTopics = [
    ...new Set(deviceTopicsOf([...input.held.filter((h) => !h.earlier), ...dependent].flatMap((i) => topicsOfItem(i)))),
  ]
    .filter((t) => !answeredTopics.has(t))
    .sort();
  // Cevap parçaları kipi (kurucu 10-23 A): istek başına sözcük + konu doğrulayıcıya gider (istemde YOK); kapalıyken alan yok.
  const parts = answerPartsEnabled();
  const needOf = (item: T) => {
    const key = hintKey(item.messageId, item.kind, item.ordinal);
    const queries = input.needQueries?.get(key) ?? [input.hints.get(key) ?? ""];
    return { terms: needTerms(queries), topics: topicsOfItem(item) };
  };
  return {
    answerable,
    replyItems: {
      answerable: answerable.map(({ ref, item }) => ({
        ref,
        kind: item.kind,
        hint: input.hints.get(hintKey(item.messageId, item.kind, item.ordinal)) ?? "",
        ...(relation?.fix.has(item) ? { fix: true } : {}),
        ...(parts ? { need: needOf(item) } : {}),
      })),
      ...(parts ? { parts: true as const } : {}),
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
      ...(heldDeviceTopics.length > 0 ? { heldDeviceTopics } : {}),
      // Cevaplanan isteklerin hiçbiri cihaz değilse cevaptaki adsız "makine / cihaz" yalnız bırakılan cihaz olabilir (15 ajan A06).
      ...(heldDeviceTopics.length > 0 && deviceTopicsOf([...answeredTopics]).length === 0 ? { heldDeviceGenericRef: true } : {}),
      // Konu bazlı "bilgim yok" (H9, kurucu 10-16; anahtar kapalıyken alan yok).
      // Kurucu 10-22 Soru 1: konu ayrıca misafirin kendi soru sözcükleriyle (`terms`) — sabit konu sözlüğünde olmayan "sauna" da eşlenir.
      ...(topicAbsenceEnabled()
        ? {
            answerableTopics: answerable.map(({ ref, item }) => {
              const key = hintKey(item.messageId, item.kind, item.ordinal);
              const queries = input.needQueries?.get(key) ?? [input.hints.get(key) ?? ""];
              return { ref, topics: topicsOfItem(item), terms: needTerms(queries) };
            }),
          }
        : {}),
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
  held: readonly (ItemRiskFacts & { earlier?: boolean; messageId?: string; ordinal?: number })[],
  relations: ReadonlyMap<string, ItemRelationFacts>,
  recipeTopics: ReadonlySet<string>,
): { dependent: T[]; fix: Set<T>; anchors: AnchorFacts[]; factsOf: (item: T) => RequestFacts } {
  const lookup = (messageId: string | undefined, kind: ItemKind, ordinal = 0) =>
    messageId ? relations.get(hintKey(messageId, kind, ordinal)) : undefined;
  // Bağlayıcı talebin kendi olgusu yoksa (kelime ağının uyarı geçişinde açtığı şikâyet; anlama katmanı aynı mesajı başka türle — ör.
  // otopark — okudu) AYNI MESAJIN öteki isteklerinin konuları + tehlikesi: konusuz bağlayıcı "Otopark kapısı açılmıyor!" yanındaki
  // "Arabayla nasıl çıkarız?" sorusunu bağımsız bırakıyordu (15 ajan A06). Yalnız sıkılaştırır.
  const messageFacts = (messageId: string | undefined): { topics: string[]; hazard: boolean; access: boolean } | undefined => {
    if (!messageId) return undefined;
    const prefix = `${messageId}\u0000`;
    const same = [...relations.entries()].filter(([key]) => key.startsWith(prefix)).map(([, f]) => f);
    if (same.length === 0) return undefined;
    return { topics: [...new Set(same.flatMap((f) => f.topics))].sort(), hazard: same.some((f) => f.hazard), access: same.some((f) => f.access === true) };
  };
  const anchors: AnchorFacts[] = held
    .filter((h) => !h.earlier && RELATION_ANCHOR_KINDS.has(h.kind))
    .map((h) => {
      const f = lookup(h.messageId, h.kind, h.ordinal) ?? messageFacts(h.messageId);
      return { kind: h.kind, topics: f?.topics ?? [], hazard: f?.hazard ?? false, access: f?.access === true };
    });
  const factsOf = (i: T): RequestFacts => {
    const f = lookup(i.messageId, i.kind, i.ordinal);
    const topics = f?.topics ?? [];
    return {
      kind: i.kind,
      relation: f?.relation ?? "unclear",
      topics,
      generic: f?.generic ?? false,
      hazard: f?.hazard ?? false,
      // Kör set 7 k7-22 (10-02): ücret / fiyat / ödeme sorusu arıza çözümü olarak sunulmaz.
      money: f?.money === true,
      access: f?.access === true,
      // Karar 23 kör doğrulaması (10-01 öğlen): bilgi tabanında bu isteğin konusunda tarif kalemi var mı — kapı aynı olguyu okur.
      // İsteğin HER cihaz konusu tarifli olmalı (15 ajan A06: "klima ve TV çalışmıyor" isteğinde yalnız klima tarifi varken TV'ye de
      // çözüm sunuluyordu); cihaz konusu yoksa tarif yok.
      recipe: deviceTopicsOf(topics).length > 0 && deviceTopicsOf(topics).every((t) => recipeTopics.has(t)),
    };
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
