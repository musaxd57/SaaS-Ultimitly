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

import { HIGH_STAKES_RISK_TYPE_LIST, NEVER_AUTO_REPLY_INTENT_LIST } from "@/lib/ai/gate-evidence";
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

/** Türün Türkçe adı — cevap modelinin öğe bloğu ve ev sahibi görünümü TEK kaynaktan. */
export const ITEM_KIND_LABELS_TR: Readonly<Record<ItemKind, string>> = {
  checkin_time: "giriş saati",
  checkout_time: "çıkış saati",
  early_checkin: "erken giriş",
  late_checkout: "geç çıkış",
  extend_stay: "konaklamayı uzatma",
  date_change: "tarih değişikliği",
  availability: "müsaitlik",
  luggage: "bagaj",
  access_keys: "giriş / anahtar",
  wifi: "Wi-Fi",
  parking: "otopark",
  directions_transport: "ulaşım / yol tarifi",
  amenities: "olanaklar",
  appliance_help: "cihaz kullanımı",
  house_rules: "ev kuralları",
  pets: "evcil hayvan",
  cleaning_linen: "temizlik / çarşaf",
  trash: "çöp",
  local_recommendations: "çevre önerileri",
  payment_invoice: "ödeme / fatura",
  cancellation_refund: "iptal / iade",
  complaint_issue: "şikâyet / sorun",
  emergency: "acil durum",
  human_request: "ev sahibiyle görüşme isteği",
  greeting_thanks: "selam / teşekkür",
  other: "diğer",
};

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
  /** Anlama katmanının kısa Türkçe arama sorgusu (cevap istemindeki ipucu; kalıcı DEĞİL). */
  hint?: string;
}

export interface BuiltItem {
  requestIndex: number;
  kind: ItemKind;
  sensitivity: ItemSensitivity;
  riskType: string | null;
  sources: ItemSource[];
  /** Cevap istemindeki kısa ipucu (yalnız bu turda; saklanmaz). */
  hint?: string;
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
      ...(r.hint ? { hint: r.hint } : {}),
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

/** Kapı ve akış kararlarının öğeden okuduğu olgular (kalıcı satır da, kurulmuş öğe de taşır). */
export type ItemRiskFacts = Pick<BuiltItem, "kind" | "sensitivity" | "riskType">;

/**
 * Cevap modelinin TUR düzeyindeki yüksek riskli etiketi tutulan (hassas) bir öğeye ait mi. `true` → etiket o öğeyi
 * anlatıyor, güvenli kısmın cevabı bu yüzden tutulmaz. `false` → bugünkü gibi cevabın TAMAMI tutulur (güvenli yön):
 * etiketi taşıyan hassas öğe yok ya da etiket tur düzeyinde (enjeksiyon / acil).
 */
export function replyRiskAttributable(riskType: string | null | undefined, items: readonly ItemRiskFacts[]): boolean {
  if (!riskType) return true;
  if (TURN_LEVEL_LABELS.has(riskType)) return false;
  const affinity = LABEL_KIND_AFFINITY[riskType] ?? [];
  return items.some((it) => it.sensitivity !== "none" && (it.riskType === riskType || affinity.includes(it.kind)));
}

/** Öğe kipinin kapı girdisi (akış kurar, kapı okur — `automation.ts` `GateItemsContext`). */
export interface ItemsGateInput {
  /** Ev sahibinde tutulan hassas öğeler (bu tur + önceki turlar; acil yok — acil tur bugünkü yoldan gider). */
  held: readonly ItemRiskFacts[];
  /** Ödeme öğesi tutuluyor: cevapta ödeme yöntemi / yeri adı geçerse cevap GİTMEZ (anlam katmanının kelime yedeği). */
  paymentHeld: boolean;
  /** Bu turun cevaplanabilir isteklerinin türleri (konaklama değişikliği ertelemesi beklenir mi — `STAY_CHANGE_ITEM_KINDS`). */
  answerableKinds: readonly ItemKind[];
}

/**
 * Konaklama değişikliği türleri: cevabı tasarım gereği ertelemedir ("… ev sahibinizin kararıdır; talebiniz kaydedildi").
 * Öğe kipinde bu türden cevaplanabilir istek YOKSA cevaptaki "kaydedildi / ev sahibiniz görebilir" cümlesi ancak bırakılan
 * bir isteğe değinebilir → kapı tutar (kurucu 09-26: bırakılan istek için misafire otomatik "kaydedildi" GİTMEZ).
 */
export const STAY_CHANGE_ITEM_KINDS: ReadonlySet<ItemKind> = new Set([
  "early_checkin",
  "late_checkout",
  "extend_stay",
  "date_change",
  "availability",
]);

/** Cevap modelinin hassas niyetleri (kapının kümesi + insan talebi) ve yüksek riskli etiketleri — TEK kaynak kapı kanıtı. */
const MODEL_SENSITIVE_INTENTS: ReadonlySet<string> = new Set([...NEVER_AUTO_REPLY_INTENT_LIST, "human_request"]);
const MODEL_HIGH_STAKES: ReadonlySet<string> = new Set(HIGH_STAKES_RISK_TYPE_LIST);

/**
 * Cevap modelinin öğelere ATFEDİLEMEYEN hassas sinyalleri → modelin kendi öğeleri (birleşim: tutulan hiçbir öğeyle
 * açıklanamayan sinyal kaybolmaz; çağıran son mesaja yazar, öğe ev sahibinde tutulur). Tur düzeyi etiketler (acil /
 * enjeksiyon) buraya ait DEĞİLDİR — çağıran onları bugünkü acil yoldan geçirir. Yükseltilmiş risk düzeyi (orta/yüksek)
 * atfedilebilir bir etiket taşımıyorsa ve başka sinyal yoksa "diğer" türünde hassas öğe olur.
 */
export function unattributedModelItems(
  model: { intent: string; riskType: string | null | undefined; riskLevel: string },
  held: readonly ItemRiskFacts[],
): BuiltItem[] {
  const labels: string[] = [];
  if (MODEL_SENSITIVE_INTENTS.has(model.intent) && !replyRiskAttributable(model.intent, held)) labels.push(model.intent);
  const riskType = model.riskType ?? null;
  if (riskType && MODEL_HIGH_STAKES.has(riskType) && !TURN_LEVEL_LABELS.has(riskType) && !replyRiskAttributable(riskType, held)) {
    labels.push(riskType);
  }
  const items: BuiltItem[] = buildLexicalItems(labels).map((it) => ({ ...it, sources: ["reply_model"] }));
  const elevated = model.riskLevel !== "none" && model.riskLevel !== "low";
  if (items.length === 0 && elevated && !(riskType && replyRiskAttributable(riskType, held))) {
    items.push({ requestIndex: 0, kind: "other", sensitivity: "sensitive", riskType: null, sources: ["reply_model"] });
  }
  return items;
}

/** Tur içinde acil öğe var mı (bugünkü acil yol: konuşma ev sahibine geçer, yapay zekâ susar). */
export function hasEmergency(items: readonly ItemRiskFacts[]): boolean {
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
