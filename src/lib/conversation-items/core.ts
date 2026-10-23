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
// (türetilir) ya da misafir vazgeçer; hassas öğe başka bir mesajın öğesiyle BİRLEŞMEZ (K9, 09-30). Acil öğe yalnız ev
// sahibiyle kapanır.
// ---------------------------------------------------------------------------

import { HIGH_STAKES_RISK_TYPE_LIST, NEVER_AUTO_REPLY_INTENT_LIST } from "@/lib/ai/gate-evidence";
import { normalizeForRetrieval } from "@/lib/ai/retrieval/text";
import { ALL_UNDERSTANDING_INTENTS, type UnderstandingIntent } from "@/lib/ai/semantic/understanding-schema";
import type { ItemsRelationGate } from "./relation";

export const ITEM_KINDS = ALL_UNDERSTANDING_INTENTS;
export type ItemKind = UnderstandingIntent;

export const ITEM_SENSITIVITIES = ["none", "sensitive", "emergency"] as const;
export type ItemSensitivity = (typeof ITEM_SENSITIVITIES)[number];

export const ITEM_SOURCES = ["lexical", "understanding", "reply_model", "fault_guard"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/**
 * Yaşam döngüsü:
 *  · open         — çıkarıldı, henüz karar yok (ya da cevap gitti ama bu öğeyi kapsamadı → ev sahibinde açık iş);
 *  · pending_host — tutuldu; misafire HİÇBİR ŞEY gitmedi, ev sahibinde açık (sessiz);
 *  · answered     — yapay zekâ (ya da kod) cevapladı — YALNIZ hassas olmayan öğe;
 *  · withdrawn    — misafir vazgeçti (acil öğe ASLA);
 *  · superseded   — aynı konuda daha yeni bir öğe yerini aldı — YALNIZ hassas olmayan öğe (K9, 09-30);
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
  about_assistant: "asistan / bilgi kaynağı sorusu",
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
  // Kurucu 10-23: kaynak / asistan sorusu ("Bunu nereden biliyorsun?") otomatik cevaplanmaz, panelde AÇIK kalır; aynı mesajdaki bağımsız sorular
  // cevaplanır. Bildirim e-postası YOK (acil değil — `NO_NOTIFY_KINDS`).
  about_assistant: "sensitive",
  // Kurucu 10-23 akşam 4.4 (seçenek A): evcil hayvan isteği ev sahibine kalır — Airbnb'de misafir ücret ödeyip hayvanı ekleyebilir, yardımcı
  // hayvan reddedilemez. TEK istisna: bilgi tabanı kodla okunduğunda açıkça "ücretsiz kabul" (`pet-policy.kbPetsFreeAllowed`, çağıran verir).
  pets: "sensitive",
};

/** Ev sahibinde açık kalan ama ACİL e-posta gerektirmeyen türler (kurucu 10-23: kaynak / asistan sorusu yalnız panelde). */
export const NO_NOTIFY_KINDS: ReadonlySet<string> = new Set<ItemKind>(["about_assistant"]);

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
  // Kurucu 10-23 akşam 4.4: yardımcı / hizmet / destek hayvanı — evcil hayvan isteğini tutar ("ayrışsın": ev sahibi ayrı etiketle görür).
  assistance_animal: ["pets", "house_rules"],
};

/**
 * Kurucu 10-23 akşam 4.3: kelime ağının kural ihlali etiketi YALNIZ evcil hayvan ailesinden geldiyse ("köpeğimizi getirebilir miyiz?") evcil
 * hayvan isteğine de bağlanır — bütün mesaj tutulmaz. Parti / fazla kişi / sigara / çıkışı reddetme bugünkü gibi (`LABEL_KIND_AFFINITY`).
 */
const PET_RULE_VIOLATION_KINDS: readonly UnderstandingIntent[] = ["pets", "house_rules"];

/** Cevap modelinin TUR etiketinin ek atfı (4.3): modelin "kural ihlali"si evcil hayvan sorusunda tutulan evcil hayvan isteğine aittir. */
const MODEL_LABEL_EXTRA_KINDS: Readonly<Record<string, readonly UnderstandingIntent[]>> = { rule_violation: ["pets"] };

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
  /** Kısa konu etiketi (yalnız sıra kipinde; `topic-label.ts` kurar — misafir metni kopyası DEĞİL). */
  topic?: string;
}

/** Aynı mesajda aynı türden en çok kaç ayrı öğe (0…MAX_ORDINAL); fazlası sonuncuyla birleşir. */
export const MAX_ORDINAL = 4;

/** İsteklerin sırası (aynı türden kaçıncı): ["amenities","wifi","amenities"] → [0,0,1]. Tavanda kalır. Çıkarım ve öğe kurucu AYNI kural. */
export function requestOrdinals(intents: readonly string[]): number[] {
  const seen = new Map<string, number>();
  return intents.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return Math.min(n, MAX_ORDINAL);
  });
}

/** Aynı mesajın daha önce yazılmış bir öğesi (sıra eşlemesi için yalnız bu üçü). */
export interface ExistingOrdinal {
  kind: string;
  ordinal: number;
  topic: string | null;
}

/**
 * Etiketin KONU sözcükleri (Opus güvenlik 10-23 F9): fiil çekimi ("kullanılır", "çalışmıyor"), nitelik ("ücretli", "açılış", "saat") ve genel
 * baş ad ("makinesi", "odası") konu değildir — "sauna kullanılır" ile "havuz kullanılır", "çamaşır makinesi" ile "bulaşık makinesi" aynı
 * konu sayılıyordu (sıra kipinde yerine geçme başka tesisin isteğini kapatıyordu). Katlanmış biçimle sınanır, özgün sözcük döner.
 */
const NON_SUBJECT_ROOTS = [
  "ucret", "fiyat", "price", "cost", "fee", "bedava", "free", "paid", "acilis", "kapan", "opening", "closing", "saat", "zaman", "time", "hour",
  "kural", "rule", "sifre", "password", "adres", "konum", "mesafe", "numara", "temizl", "clean", "kullan", "usage", "kapasite",
  "makine", "makina", "cihaz", "alet", "machine", "device", "appliance", "tesis", "facility", "calis", "bozuk", "sorun", "problem", "ariza",
];
const NON_SUBJECT_EXACT = new Set(["oda", "odasi", "odada", "alan", "alani", "room", "area", "var", "yok", "mevcut", "mumkun", "kabul", "izin", "serbest", "yasak", "open", "closed"]);
function subjectWord(word: string): boolean {
  const f = normalizeForRetrieval(word).toLowerCase();
  if (f.length < 2 || NON_SUBJECT_EXACT.has(f) || NON_SUBJECT_ROOTS.some((r) => f.startsWith(r))) return false;
  // Türkçe fiil çekimi (çoğul ad "-lar / -ler" hariç).
  if (/l[ae]r$/.test(f)) return true;
  // Çıplak "-ır" sonu konu adı da olur ("çamaşır") → yalnız belirgin çekim ekleri.
  return !/(?:[iu]l[iu]r|[iu]n[iu]r|[ae]bil[iu]r|[iu]yor(?:uz|lar|sunuz)?|m[ae]kt[ae]d[iu]r|m[ae]k|m[ae]z)$/.test(f);
}
const topicWords = (t: string | null | undefined): string[] => (t ? t.split(/\s+/u).filter((w) => w && subjectWord(w)) : []);
/** Etiket sözcükleri aynı mı — çekim toleranslı ("havuz" ~ "havuzu", "sauna" ~ "saunada"): eşit ya da en az 4 harflik biri ötekinin başı. */
/** Kısa kökün çekim eki ("su" → "suyu", "çöp" → "çöpü", "kat" → "katta"; Haiku 10-23 gece-2: yeniden okumada yeni satır açılıyordu). */
const SHORT_INFLECTION = /^(?:[ynsş])?(?:[ıiuü]|[ae]|[dt][ae]|[dt][ae]n|l[ae]r|l[ae]r[ıi]|n[dt][ae]|n[dt][ae]n)$/u;
function topicWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;
  return short.length >= 2 && long.startsWith(short) && SHORT_INFLECTION.test(long.slice(short.length));
}
/** İki etiketin ortak (çekim toleranslı) sözcük sayısı. */
function topicOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const bw = topicWords(b);
  return topicWords(a).filter((w) => bw.some((x) => topicWordMatch(w, x))).length;
}
/**
 * İki etiket birbiriyle ÇELİŞMİYOR mu: biri yoksa çelişki bilinmiyor (true); ikisi de varsa ortak sözcük şart. Yalnız "çelişmez"
 * okumasıdır — KAPATAN kararlar (`store.ts` yerine geçme / vazgeçme) iki etiketi de AYRICA şart koşar (Opus 10-23: etiketsiz öğe "aynı
 * konu" sayılmaz; kurucu B: "ilişki belirsizse otomatik kapatma").
 */
export function topicsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  return !a || !b || topicOverlap(a, b) > 0;
}

/**
 * Yeni etiket eskisinin BÜTÜN sözcüklerini (konu + yön / nitelik: "havuz AÇILIYOR") taşıyor mu — yerine geçme bir kapatmadır, ortak tek konu
 * sözcüğü yetmez (Opus dilim sonu 10-23 R14: "havuz ısıtmalı mı" sorusu "havuz kaçta açılıyor" sorusunu kapatıyordu; ilk soru hiç cevaplanmadan
 * panelden düşüyordu).
 */
export function labelCovers(newer: string | null | undefined, older: string | null | undefined): boolean {
  if (!newer || !older) return false;
  const nw = newer.split(/\s+/u).filter(Boolean);
  // Fiil çekimi farkı aynı sözcüktür ("açılıyor" ~ "açılır": ortak baş en az 5 harf, ikisi de en az 6).
  const verbVariant = (a: string, b: string) => {
    let cp = 0;
    while (cp < a.length && cp < b.length && a[cp] === b[cp]) cp++;
    return cp >= 5 && a.length >= 6 && b.length >= 6;
  };
  return older
    .split(/\s+/u)
    .filter(Boolean)
    .every((w) => nw.some((x) => topicWordMatch(w, x) || verbVariant(w, x)));
}

/**
 * Sıra kipinde YENİDEN İŞLENEN mesajın isteklerini mevcut satırlara eşler (migration 84, kurucu D: "tekrar işleme kayıt çoğaltmasın").
 * Anlama katmanı aynı mesajı ikinci okumada istekleri başka sırayla ya da başka sözcüklerle verebilir; salt sıra numarası o zaman havuz
 * cevabını sauna satırına bağlardı. Sıra: (1) aynı etiket, (2) ortak etiket sözcüğü (çekim toleranslı: "havuz" ~ "havuzu"; en çok ortak sözcük önce), (3) etiketi olmayan taraf
 * sırayla eşlenir (anahtar kapalı dönemin etiketsiz satırı / etiketi süzülmüş istek), (4) kalan istek boş ilk sıraya — etiketleri
 * birbirine HİÇ benzemeyen istek ile satır eşlenmez (ilişki belirsizse kapatma yok, kurucu B). Boş sıra kalmazsa tavandaki sırayla
 * birleşir. Mevcut satır yoksa `requestOrdinals` ile aynı sonuç. Saf.
 */
export function alignOrdinals(
  requests: readonly { intent: string; topic?: string | null }[],
  existing: readonly ExistingOrdinal[],
): number[] {
  const base = requestOrdinals(requests.map((r) => r.intent));
  if (existing.length === 0) return base;
  const out = [...base];
  for (const kind of new Set(requests.map((r) => r.intent))) {
    const rows = existing.filter((e) => e.kind === kind).sort((a, b) => a.ordinal - b.ordinal);
    if (rows.length === 0) continue;
    const idx = requests.flatMap((r, i) => (r.intent === kind ? [i] : []));
    const done = new Map<number, number>();
    const usedRows = new Set<number>();
    const take = (i: number, ordinal: number) => {
      done.set(i, ordinal);
      usedRows.add(ordinal);
    };
    for (const i of idx) {
      const t = requests[i].topic ?? null;
      const row = t ? rows.find((r) => !usedRows.has(r.ordinal) && r.topic === t) : undefined;
      if (row) take(i, row.ordinal);
    }
    const pairs: { i: number; ordinal: number; score: number }[] = [];
    for (const i of idx) {
      if (done.has(i)) continue;
      for (const r of rows) {
        if (usedRows.has(r.ordinal)) continue;
        const score = topicOverlap(requests[i].topic, r.topic);
        if (score > 0) pairs.push({ i, ordinal: r.ordinal, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.ordinal - b.ordinal);
    for (const p of pairs) if (!done.has(p.i) && !usedRows.has(p.ordinal)) take(p.i, p.ordinal);
    // Etiketsiz taraf yalnız TEK aday varken eşlenir (Opus güvenlik 10-23 F10: etiketsiz istek ilk boş satıra gidiyordu — havuz cevabı
    // sauna satırını cevaplandı sayabilirdi).
    for (const i of idx) {
      if (done.has(i)) continue;
      const free = rows.filter((r) => !usedRows.has(r.ordinal));
      const cands = requests[i].topic ? free.filter((r) => !r.topic) : free;
      if (cands.length === 1) take(i, cands[0].ordinal);
    }
    // Aynı mesajın yeniden okunuşunda bu türün istek sayısı satır sayısına eşitse kalanlar SIRAYLA eşlenir — yalnız her çiftte bir taraf
    // etiketsizse (F10). İki etiket birbirine hiç benzemiyorsa ("bulaşık makinesi" ↔ "çamaşır makinesi") eşlenmez, yeni sıra açılır (Opus dilim
    // sonu 10-23 R14; kurucu B "ilişki belirsizse kapatma"): bedeli aynı soru için ikinci açık satır, karşılığı cevapsız sorunun cevaplandı sayılması.
    const restReq = idx.filter((i) => !done.has(i));
    const restRows = rows.filter((r) => !usedRows.has(r.ordinal));
    if (restReq.length > 0 && idx.length === rows.length && restReq.length === restRows.length && restReq.every((i, k) => topicWords(requests[i].topic).length === 0 || topicWords(restRows[k].topic).length === 0)) {
      restReq.forEach((i, k) => take(i, restRows[k].ordinal));
    }
    for (const i of idx) {
      if (done.has(i)) continue;
      let free = -1;
      for (let o = 0; o <= MAX_ORDINAL; o++) {
        if (!rows.some((r) => r.ordinal === o) && ![...done.values()].includes(o)) {
          free = o;
          break;
        }
      }
      done.set(i, free >= 0 ? free : MAX_ORDINAL);
    }
    for (const i of idx) out[i] = done.get(i) ?? out[i];
  }
  return out;
}

export interface BuiltItem {
  requestIndex: number;
  kind: ItemKind;
  /** Aynı mesajda aynı türden kaçıncı istek (sıra kipi; yoksa 0). */
  ordinal?: number;
  /** Kısa konu etiketi (sıra kipi; yoksa yok). */
  topic?: string;
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
  /**
   * Sıra kipi (`AI_ITEM_ORDINAL_ENABLED`, migration 84): istek başına sıra (`requestOrdinals` / `alignOrdinals`) — aynı türden ikinci istek
   * AYRI öğe; aynı (tür, sıra) birleşir, ilki kalır. Verilmezse bugünkü kural: aynı türden istekler birleşir, ilk sıra kalır.
   */
  ordinals?: readonly number[];
  /** Kural ihlali etiketi yalnız evcil hayvan ailesinden (`fallback.ruleViolationIsPetsOnly`) — 4.3. */
  petRuleOnly?: boolean;
  /**
   * Bilgi tabanı kodla okunduğunda evcil hayvanı açıkça ÜCRETSİZ ve KOŞULSUZ kabul ediyor (`pet-policy.kbPetsFreeAllowed`) ve misafir yardımcı
   * hayvandan söz etmiyor — 4.4: evcil hayvan isteği cevaplanabilir (ve yalnız evcil hayvan ailesinden kural ihlali etiketi onu tutmaz).
   */
  petsFreeAllowed?: boolean;
}): BuiltItem[] {
  if (input.requests.length === 0) return buildLexicalItems(input.lexicalLabels);
  const items: BuiltItem[] = [];
  const ords = input.ordinals ?? null;
  input.requests.forEach((r, i) => {
    const ordinal = ords ? (ords[i] ?? 0) : 0;
    if (items.some((it) => it.kind === r.intent && (it.ordinal ?? 0) === ordinal)) return;
    items.push({
      requestIndex: i,
      kind: r.intent,
      ...(ordinal > 0 ? { ordinal } : {}),
      sensitivity: r.intent === "pets" && input.petsFreeAllowed === true ? "none" : (INTENT_SENSITIVITY[r.intent] ?? "none"),
      riskType: null,
      sources: ["understanding"],
      ...(r.hint ? { hint: r.hint } : {}),
      ...(ords && r.topic ? { topic: r.topic } : {}),
    });
  });
  for (const label of input.lexicalLabels) {
    const to: ItemSensitivity = EMERGENCY_LABELS.has(label) ? "emergency" : "sensitive";
    const petRule = label === "rule_violation" && input.petRuleOnly === true;
    // Evcil hayvan sorusu bilgi tabanında doğrulanmış "ücretsiz kabul"se o sorunun kendi kelime etiketi onu tutmaz (evcil hayvan isteği varsa).
    if (petRule && input.petsFreeAllowed === true && items.some((it) => it.kind === "pets")) continue;
    const affinity = petRule ? PET_RULE_VIOLATION_KINDS : (LABEL_KIND_AFFINITY[label] ?? []);
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
  const affinity = [...(LABEL_KIND_AFFINITY[riskType] ?? []), ...(MODEL_LABEL_EXTRA_KINDS[riskType] ?? [])];
  return items.some((it) => it.sensitivity !== "none" && (it.riskType === riskType || affinity.includes(it.kind)));
}

/**
 * ŞİKÂYETE BAĞLI İSTEK (kurucu kararı 10-01; Luna kör kabul bulgusu): "Gürültü yüzünden uyuyamadık, yine olursa ne yapacağız?" TEK
 * şikâyet + ona bağlı yardım talebidir. Anlama katmanı ikiye bölünce "ne yapacağız?" cevaplanabilir sayılıyor, misafire şikâyetçiye
 * yöneltilmiş kural hatırlatması + 112 önerisi gidiyordu. Bu turda TUTULAN bir şikâyet varken, bağımsız bilgi türü OLMAYAN istek
 * şikâyete bağlıdır: planda cevaplanabilir sayılmaz ve doğrudan kapıya gelse de tutulur (kapıda ikinci kemer — model / anlama katmanı
 * aynı hatayı tekrar yaparsa kod korur). Bağımsız bilgi ("Wi-Fi ağı hangisi?", otopark, giriş / çıkış saati, bagaj, ulaşım, çevre
 * önerisi, giriş / anahtar) sır kuralları uygunsa cevaplanır. Önceki turun şikâyeti bugünkü isteği bağlamaz (K8).
 * 🚨 10-01 sabah (kurucu kararı, Sabah Kararları 17): bu liste YALNIZ ilişki işareti yokken (öğe kipi açık, şikâyet takibi anahtarı
 * kapalı — bugünkü canlı yol) karar verir. İşaret varken karar `relation.ts`te: önce anlam ilişkisi, sonra kod koruması.
 */
export const COMPLAINT_INDEPENDENT_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>([
  "wifi",
  "parking",
  "checkin_time",
  "checkout_time",
  "luggage",
  "directions_transport",
  "local_recommendations",
  "access_keys",
]);

/** Bu turda tutulan şikâyet varken `kind` şikâyete bağlı mı (↑COMPLAINT_INDEPENDENT_KINDS)? */
export function complaintDependent(kind: ItemKind, held: readonly { kind: ItemKind; earlier?: boolean }[]): boolean {
  return !COMPLAINT_INDEPENDENT_KINDS.has(kind) && held.some((h) => !h.earlier && h.kind === "complaint_issue");
}

/** Kapının ikinci kemeri: cevaplanabilir sayılmış bir istek bu turun tutulan şikâyetine bağlıysa cevap GİTMEZ. */
export function complaintDependentHold(items: Pick<ItemsGateInput, "held" | "answerableKinds">): boolean {
  return items.answerableKinds.some((k) => complaintDependent(k, items.held));
}

/** Öğe kipinin kapı girdisi (akış kurar, kapı okur — `automation.ts` `GateItemsContext`). */
export interface ItemsGateInput {
  /**
   * Ev sahibinde tutulan hassas öğeler (bu tur + önceki turlar; acil yok — acil tur bugünkü yoldan gider). `earlier`: öğe ÖNCEKİ bir
   * turun mesajında (K8) — şikâyete bağlılık kuralı yalnız bu turun şikâyetine bakar.
   */
  held: readonly (ItemRiskFacts & { earlier?: boolean })[];
  /** Ödeme öğesi tutuluyor: cevapta ödeme yöntemi / yeri adı geçerse cevap GİTMEZ (anlam katmanının kelime yedeği). */
  paymentHeld: boolean;
  /** Bu turun cevaplanabilir isteklerinin türleri (konaklama değişikliği ertelemesi beklenir mi — `STAY_CHANGE_ITEM_KINDS`). */
  answerableKinds: readonly ItemKind[];
  /**
   * İlişki kipi (anlama katmanı işaret verdi): cevaplanabilir isteklerin + bu turun bağlayıcı taleplerinin olguları. Varken kapının ikinci
   * kemeri `relation.relationGateHold` (liste DEĞİL); yokken bugünkü `complaintDependentHold`.
   */
  relation?: ItemsRelationGate;
  /**
   * Bu turda ev sahibine BIRAKILAN arızaların cihaz kavramları (bağlayıcı talep + bağlı istek; cevaplanan isteklerin konuları çıkarılmış).
   * Cevap bunlardan birine değinirse GİTMEZ (`relation.touchesHeldDevice`, kör set 5). Boşsa alan yok.
   */
  heldDeviceTopics?: readonly string[];
  /**
   * Cevaplanabilir isteklerin konuları (konu bazlı "bilgim yok", `topic-absence.ts`; yalnız `AI_TOPIC_ABSENCE_ENABLED` açıkken — kapalıyken
   * alan yok, kapı girdisi bayt bayt bugünkü).
   */
  answerableTopics?: readonly { ref: string; topics: readonly string[]; terms?: readonly string[] }[];
  /**
   * Cevaplanan isteklerin hiçbiri cihaz / tesis kavramı taşımıyor: cevaptaki adı verilmeyen "makine / cihaz / the device" yalnız bırakılan
   * cihaz olabilir (`relation.touchesHeldDevice` `genericRef`, 15 ajan A06). Yalnız `heldDeviceTopics` doluyken.
   */
  heldDeviceGenericRef?: true;
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

/**
 * Yeni öğe eskisinin yerini alabilir mi: aynı konu ve eski öğe HASSAS DEĞİL (tekrar sorulan Wi-Fi sorusu). 🚨 K9 (kurucu kararı
 * 09-30): hassas / acil öğe başka bir mesajın öğesiyle BİRLEŞMEZ — "Klima çalışmıyor" ile ertesi günün "Komşular çok gürültülü"sü
 * ayrı açık işlerdir, yeni şikâyet ayrıca bildirilir (mesaj başına acil e-posta). Aynı mesajın yeniden içe aktarımı aynı öğedir
 * (mesaj + tür tekil) — ikinci iş / e-posta doğmaz.
 */
export function maySupersede(
  older: Pick<BuiltItem, "kind" | "sensitivity">,
  newer: Pick<BuiltItem, "kind" | "sensitivity">,
): boolean {
  return older.kind === newer.kind && older.sensitivity === "none";
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
