// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — SAF ÇEKİRDEK (09-26, kurucu kararları; tasarım `docs/TASARIM-2026-09-26-konusma-ogeleri.md`).
//
// Misafirin her cevapsız mesajı istek/soru ÖĞELERİNE bölünür. Hassas öğe (ödeme yöntemi, şikâyet, iade…) sessizce ev
// sahibinde açık kalır; güvenli öğe cevaplanır; acil durum konuşmayı bugünkü gibi durdurur. Bu modül DB'siz, ağsız:
// kapalı kümeler + öğe başına BİRLEŞİM kuralı + yaşam döngüsü. Metin TAŞIMAZ (öğe = kimlik + kapalı küme kodlar).
//
// 🚨 BİRLEŞİM DEĞİŞMEZİ ÖĞE KAPSAMINDA: bir öğedeki gerçek hassas İSTEK başka bir katmanın "istek yok"uyla silinmez —
// ama başka, ilgisiz bir öğeye de taşınmaz. Kelime ağı mesaj başına kesindir; etiketi mesajın içindeki UYGUN niyetli
// isteğe atfedilir, hiçbir isteğe atfedilemezse mesajın TAMAMI hassas sayılır (güvenli yön).
// 🚨 KAYBOLMAZ: hassas öğe yapay zekânın cevabıyla ASLA "cevaplandı" olmaz; yalnız ev sahibi kapatır, ev sahibi yazar
// (türetilir), misafir vazgeçer ya da aynı konuda en az onun kadar hassas yeni öğe yerini alır. Acil öğe yalnız ev
// sahibiyle kapanır.
// ---------------------------------------------------------------------------

import { UNDERSTANDING_INTENTS, type UnderstandingIntent } from "@/lib/ai/semantic/understanding-schema";

export const ITEM_KINDS = UNDERSTANDING_INTENTS;
export type ItemKind = UnderstandingIntent;

export const ITEM_SENSITIVITIES = ["none", "sensitive", "emergency"] as const;
export type ItemSensitivity = (typeof ITEM_SENSITIVITIES)[number];

export const ITEM_SOURCES = ["lexical", "understanding", "reply_model"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/**
 * Yaşam döngüsü:
 *  · open         — çıkarıldı, henüz karar yok (ya da cevap gitti ama bu öğeyi kapsamadı → ev sahibinde açık iş);
 *  · pending_host — tutuldu; misafire HİÇBİR ŞEY gitmedi, ev sahibinde açık (sessiz);
 *  · answered     — yapay zekâ (ya da kod) cevapladı — YALNIZ hassas olmayan öğe;
 *  · withdrawn    — misafir vazgeçti (acil öğe ASLA);
 *  · superseded   — aynı konuda daha yeni, en az onun kadar hassas bir öğe yerini aldı (acil öğe ASLA);
 *  · done         — ev sahibi kapattı.
 * "Ev sahibi yazdı" SAKLANMAZ, okuma anında türetilir (`effectiveStatus`) — kaçan bir yazma yolu olamaz.
 */
export const ITEM_STATUSES = ["open", "pending_host", "answered", "withdrawn", "superseded", "done"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type EffectiveItemStatus = ItemStatus | "host_replied";

const TERMINAL: ReadonlySet<ItemStatus> = new Set(["answered", "withdrawn", "superseded", "done"]);

/** Anlama katmanı niyetinden öğenin kendi hassaslığı (kelime ağı ayrıca birleşir). */
const INTENT_SENSITIVITY: Readonly<Partial<Record<UnderstandingIntent, ItemSensitivity>>> = {
  emergency: "emergency",
  complaint_issue: "sensitive",
  cancellation_refund: "sensitive",
  human_request: "sensitive",
  // Kurucu kararı 09-26 ("Evet, hepsi size"): ödeme / fatura isteği (IBAN, havale, nakit, banka bilgisi, fatura) HER DİLDE
  // ev sahibinin — niyetten, kelime listesinden değil. Ölçüm: İngilizce/Almanca "IBAN", "cash" ve Türkçe "nakit ödeyebilir
  // miyim" kelime ağına takılmıyordu, istek "cevaplanabilir" sayılıyordu.
  payment_invoice: "sensitive",
};

/**
 * Kelime ağı etiketinin (`detectRiskType` + `classifyFallback` niyeti) ve cevap modelinin yüksek riskli etiketinin hangi
 * niyetli isteğe ait olabileceği. Listede olmayan etiket (ayrımcılık, enjeksiyon…) hiçbir isteğe atfedilmez → mesajın
 * TAMAMI hassas.
 */
const LABEL_KIND_AFFINITY: Readonly<Record<string, readonly UnderstandingIntent[]>> = {
  platform_policy: ["payment_invoice"],
  money_refund: ["cancellation_refund", "payment_invoice"],
  refund: ["cancellation_refund", "payment_invoice"],
  cancellation: ["cancellation_refund"],
  early_departure: ["cancellation_refund", "date_change"],
  review_threat: ["complaint_issue"],
  complaint: ["complaint_issue"],
  safety_emergency: ["emergency"],
  human_request: ["human_request"],
  access_security: ["access_keys"],
  rule_violation: ["house_rules"],
};

/** Acil sayılan etiketler (öğe hassaslığı `emergency`). */
const EMERGENCY_LABELS: ReadonlySet<string> = new Set(["safety_emergency"]);

/**
 * TUR düzeyinde kalan etiketler: öğeye BÖLÜNMEZ. Enjeksiyon yapay zekânın kendisine saldırıdır — metni isteme giren
 * turda hiçbir cevap gitmez; acil durum bugünkü acil yoldan gider.
 */
const TURN_LEVEL_LABELS: ReadonlySet<string> = new Set(["prompt_injection", "safety_emergency"]);

/** Ev sahibine iş çıkarmayan niyet: hassas değilse öğe OLUŞTURULMAZ (teşekkür "açık iş" görünmesin). */
const NO_WORK_KINDS: ReadonlySet<UnderstandingIntent> = new Set(["greeting_thanks"]);

export interface UnderstoodItemInput {
  intent: UnderstandingIntent;
}

export interface BuiltItem {
  requestIndex: number;
  kind: ItemKind;
  sensitivity: ItemSensitivity;
  riskType: string | null;
  sources: ItemSource[];
}

function rank(s: ItemSensitivity): number {
  return s === "emergency" ? 2 : s === "sensitive" ? 1 : 0;
}

function raise(item: BuiltItem, to: ItemSensitivity, riskType: string, source: ItemSource): void {
  if (rank(to) > rank(item.sensitivity)) item.sensitivity = to;
  if (!item.riskType) item.riskType = riskType;
  if (!item.sources.includes(source)) item.sources.push(source);
}

/** Anlama katmanı olmadan etiketten öğe türü: etiketin ilk yakın türü, eşlemesi yoksa "other". */
export function kindForLabel(label: string): ItemKind {
  return LABEL_KIND_AFFINITY[label]?.[0] ?? "other";
}

/**
 * Yalnız kelime ağından öğeler (senkron uyarı geçişi — orada model YOK; ya da anlama katmanı bu mesajda istek görmedi):
 * her etiket kendi türünde bir öğe, aynı türe düşen etiketler birleşir. Etiket yoksa öğe yok.
 */
export function buildLexicalItems(labels: readonly string[]): BuiltItem[] {
  const items: BuiltItem[] = [];
  for (const label of labels) {
    const kind = kindForLabel(label);
    let item = items.find((it) => it.kind === kind);
    if (!item) {
      item = { requestIndex: items.length, kind, sensitivity: "none", riskType: null, sources: [] };
      items.push(item);
    }
    raise(item, EMERGENCY_LABELS.has(label) ? "emergency" : "sensitive", label, "lexical");
  }
  return items;
}

/**
 * Bir mesajın öğeleri. `requests`: anlama katmanının BU mesaja atfettiği istekler (sırasıyla; boş = katman bu mesajda
 * istek görmedi → yalnız kelime ağının öğeleri). `lexicalLabels`: kelime ağının BU mesajdaki etiketleri (boş = yok).
 * Bir mesajda her tür BİR öğedir (tablonun tekilliği): aynı türden iki istek birleşir, ilk sıra kalır.
 */
export function buildItemsForMessage(input: {
  requests: readonly UnderstoodItemInput[];
  lexicalLabels: readonly string[];
}): BuiltItem[] {
  if (input.requests.length === 0) return buildLexicalItems(input.lexicalLabels);
  const items: BuiltItem[] = [];
  input.requests.forEach((r, i) => {
    if (items.some((it) => it.kind === r.intent)) return;
    items.push({
      requestIndex: i,
      kind: r.intent,
      sensitivity: INTENT_SENSITIVITY[r.intent] ?? "none",
      riskType: null,
      sources: ["understanding"],
    });
  });
  for (const label of input.lexicalLabels) {
    const to: ItemSensitivity = EMERGENCY_LABELS.has(label) ? "emergency" : "sensitive";
    const affinity = LABEL_KIND_AFFINITY[label] ?? [];
    const targets = items.filter((it) => affinity.includes(it.kind));
    // Atfedilemeyen etiket mesajın TAMAMINI hassas yapar (birleşim: "istek yok" gerçek isteği silemez).
    for (const it of targets.length > 0 ? targets : items) raise(it, to, label, "lexical");
  }
  return items.filter((it) => it.sensitivity !== "none" || !NO_WORK_KINDS.has(it.kind));
}

type ItemFacts = Pick<BuiltItem, "sensitivity" | "riskType" | "sources">;

/**
 * Kalıcı öğe + bu geçişte yeniden hesaplanan AYNI (mesaj, tür) öğesi: hassaslık yalnız YÜKSELİR, ilk gerekçe kalır,
 * kaynaklar birleşir. İki geçişin (senkron uyarısı: yalnız kelime ağı · cevap: anlama katmanı) sırası sonucu değiştirmez.
 */
export function mergeItemFacts(existing: ItemFacts, incoming: ItemFacts): ItemFacts {
  return {
    sensitivity: rank(incoming.sensitivity) > rank(existing.sensitivity) ? incoming.sensitivity : existing.sensitivity,
    riskType: existing.riskType ?? incoming.riskType,
    sources: [...existing.sources, ...incoming.sources.filter((s) => !existing.sources.includes(s))],
  };
}

/** Turun TAMAMINI tutan etiket var mı (enjeksiyon / acil — öğeye bölünmez). */
export function labelsHoldWholeTurn(labels: readonly string[]): boolean {
  return labels.some((l) => TURN_LEVEL_LABELS.has(l));
}

/**
 * Cevap modelinin TUR düzeyindeki yüksek riskli etiketi tutulan (hassas) bir öğeye ait mi. `true` → etiket o öğeyi
 * anlatıyor, güvenli kısmın cevabı bu yüzden tutulmaz. `false` → bugünkü gibi cevabın TAMAMI tutulur (güvenli yön):
 * etiketi taşıyan hassas öğe yok ya da etiket tur düzeyinde (enjeksiyon / acil).
 */
export function replyRiskAttributable(riskType: string | null | undefined, items: readonly BuiltItem[]): boolean {
  if (!riskType) return true;
  if (TURN_LEVEL_LABELS.has(riskType)) return false;
  const affinity = LABEL_KIND_AFFINITY[riskType] ?? [];
  return items.some((it) => it.sensitivity !== "none" && (it.riskType === riskType || affinity.includes(it.kind)));
}

/** Tur içinde acil öğe var mı (bugünkü acil yol: konuşma ev sahibine geçer, yapay zekâ susar). */
export function hasEmergency(items: readonly BuiltItem[]): boolean {
  return items.some((it) => it.sensitivity === "emergency");
}

export type ItemEvent = "held" | "answered" | "withdrawn" | "superseded" | "host_done";

/**
 * Geçiş kuralı. Kapanmış öğe yeniden açılmaz. Hassas öğe yapay zekânın cevabıyla KAPANMAZ (risk kaybolmasın); acil öğe
 * misafir vazgeçmesiyle ya da yeni öğeyle KAPANMAZ — yalnız ev sahibi kapatır. Geçersiz geçiş = durum aynen.
 */
export function nextStatus(current: ItemStatus, sensitivity: ItemSensitivity, event: ItemEvent): ItemStatus {
  if (TERMINAL.has(current)) return current;
  switch (event) {
    case "held":
      return "pending_host";
    case "answered":
      return sensitivity === "none" ? "answered" : current;
    case "withdrawn":
      return sensitivity === "emergency" ? current : "withdrawn";
    case "superseded":
      return sensitivity === "emergency" ? current : "superseded";
    case "host_done":
      return "done";
  }
}

/** Yeni öğe eskisinin yerini alabilir mi: aynı konu, eski acil değil, yeni en az onun kadar hassas (risk düşmesin). */
export function maySupersede(
  older: Pick<BuiltItem, "kind" | "sensitivity">,
  newer: Pick<BuiltItem, "kind" | "sensitivity">,
): boolean {
  return older.kind === newer.kind && older.sensitivity !== "emergency" && rank(newer.sensitivity) >= rank(older.sensitivity);
}

/**
 * Görünen durum: açık / ev sahibinde bekleyen öğe, öğenin mesajından SONRA ev sahibi yazdıysa "ev sahibi yazdı"dır
 * (kurucu kararı 09-26: tıklama gerekmez). Saklanmaz, her okumada türetilir.
 */
export function effectiveStatus(status: ItemStatus, hostRepliedAfter: boolean): EffectiveItemStatus {
  if ((status === "open" || status === "pending_host") && hostRepliedAfter) return "host_replied";
  return status;
}

/** Ev sahibinin listesinde "açık iş" sayılır mı. */
export function isOpenForHost(status: EffectiveItemStatus): boolean {
  return status === "open" || status === "pending_host";
}

export function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);
}

export function isItemSensitivity(v: unknown): v is ItemSensitivity {
  return typeof v === "string" && (ITEM_SENSITIVITIES as readonly string[]).includes(v);
}

export function isItemKind(v: unknown): v is ItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);
}
