// ---------------------------------------------------------------------------
// ANLAMA ÖLÇÜMÜ — İSTEK BAZLI PUANLAMA (kurucu 10-21; tasarım `docs/TASARIM-2026-10-21-anlama-olcumu.md`). Saf: DB / ağ / model yok.
//
// Ölçer (`understanding-e2e.eval.test.ts`) ürünün kanal akışını gerçek modelle koşturur; bu modül yalnız gözlemi beklentiyle kıyaslar:
//  · istek eşleme: modelin çıkardığı istek (niyet + mesaj numarası) ↔ senaryonun beklenen isteği; fazla / kaçan ayrı;
//  · ilişki: modelin işareti (`own_topic` / `fix_request` / `follow_up` / `unclear`) ↔ beklenen (bağımsız / bağlı / belirsiz);
//  · cevap anlamı (yazılmış bağlar): değer varlığıyla AYNI cümlecikte ve olumlu mu; komşu varlığın değeri bu varlığa bağlanmış mı;
//  · son sonuç: doğru · yanlış bilgi · gereksiz tutuldu (açık / sessiz düştü) · serbest kaldı · acil.
// Modelin kendi güven puanı hiçbir ölçüye girmez. Test dosyası DEĞİL (ücretli koşu başlatmasın diye ayrı modül).
// ---------------------------------------------------------------------------

import { factVerdict, type FactVerdict } from "./reply-scoring";

export const UX_INTENTS = [
  "checkin_time", "checkout_time", "early_checkin", "late_checkout", "extend_stay", "date_change", "availability", "luggage",
  "access_keys", "wifi", "parking", "directions_transport", "amenities", "appliance_help", "house_rules", "pets", "cleaning_linen",
  "trash", "local_recommendations", "payment_invoice", "cancellation_refund", "complaint_issue", "emergency", "human_request",
  "greeting_thanks", "other",
] as const;

export type UxRelation = "none" | "independent" | "dependent" | "ambiguous";
export type UxExpect = "answer" | "hold" | "emergency" | "none";

export interface UxKbItem {
  id: string;
  category: string;
  title: string;
  content: string;
}
export interface UxFact {
  about: string[];
  value: string;
}
export interface UxRequest {
  id: string;
  span: string;
  intents: string[];
  relation: UxRelation;
  expect: UxExpect;
  facts?: UxFact[];
  wrong?: UxFact[];
  why?: string;
}
export interface UxScenario {
  id: string;
  lang: string;
  tags?: string[];
  pair?: string;
  kb: string;
  kbExtra?: UxKbItem[];
  kbOmit?: string[];
  history?: { direction: "inbound" | "outbound"; body: string }[];
  message: string;
  requests: UxRequest[];
  forbidden?: string[];
}
export interface UxDataset {
  version: number;
  note?: string;
  property: { name: string; checkInTime: string; checkOutTime: string; address?: string; city?: string };
  kbSets: Record<string, UxKbItem[]>;
  scenarios: UxScenario[];
}

// ── Veri seti ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Senaryonun bilgi tabanı: küme − çıkarılanlar + ekler (ek aynı kimliği taşıyorsa kümedekinin YERİNE geçer). */
export function scenarioKb(data: Pick<UxDataset, "kbSets">, s: Pick<UxScenario, "kb" | "kbExtra" | "kbOmit">): UxKbItem[] {
  const base = data.kbSets[s.kb];
  if (!base) throw new Error(`bilgi tabanı kümesi yok: ${s.kb}`);
  const omit = new Set(s.kbOmit ?? []);
  const extra = s.kbExtra ?? [];
  const replaced = new Set(extra.map((k) => k.id));
  return [...base.filter((k) => !omit.has(k.id) && !replaced.has(k.id)), ...extra];
}

/** Son CEVAPLAYAN giden mesajdan sonraki misafir mesajları + güncel mesaj (ölçerin seed sırası: geçmiş, sonra güncel). */
export function unansweredMessages(s: Pick<UxScenario, "history" | "message">): string[] {
  const h = s.history ?? [];
  let last = -1;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].direction === "outbound") {
      last = i;
      break;
    }
  }
  return [...h.slice(last + 1).filter((m) => m.direction === "inbound").map((m) => m.body), s.message];
}

/** Dayanak parçasının geçtiği cevapsız mesajın numarası (1'den; anlama isteminin [n] numarası); yoksa null. */
export function spanMessageNumber(s: Pick<UxScenario, "history" | "message">, span: string): number | null {
  const msgs = unansweredMessages(s);
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].includes(span)) return i + 1;
  return null;
}

/** Veri seti doğrulaması (içerik BASMAZ — mühürlü set için de güvenli): yalnız senaryo kimliği + kural adı döner. */
export function validateUxDataset(data: UxDataset): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const pairs = new Map<string, number>();
  const intents = new Set<string>(UX_INTENTS);
  for (const s of data.scenarios) {
    if (ids.has(s.id)) errors.push(`${s.id}: kimlik tekrarı`);
    ids.add(s.id);
    if (s.pair) pairs.set(s.pair, (pairs.get(s.pair) ?? 0) + 1);
    let kb: UxKbItem[];
    try {
      kb = scenarioKb(data, s);
    } catch {
      errors.push(`${s.id}: bilgi tabanı kümesi yok`);
      continue;
    }
    const kbText = kb.map((k) => `${k.title}\n${k.content}`).join("\n");
    if (!s.message?.trim()) errors.push(`${s.id}: mesaj boş`);
    if (!Array.isArray(s.requests) || s.requests.length === 0) errors.push(`${s.id}: istek yok`);
    const rids = new Set<string>();
    for (const r of s.requests ?? []) {
      if (rids.has(r.id)) errors.push(`${s.id}/${r.id}: istek kimliği tekrarı`);
      rids.add(r.id);
      if (spanMessageNumber(s, r.span) === null) errors.push(`${s.id}/${r.id}: dayanak parçası cevapsız mesajlarda birebir yok`);
      if (!r.intents?.length || r.intents.some((i) => !intents.has(i))) errors.push(`${s.id}/${r.id}: niyet kümesi dışı`);
      if (!["none", "independent", "dependent", "ambiguous"].includes(r.relation)) errors.push(`${s.id}/${r.id}: ilişki değeri`);
      if (!["answer", "hold", "emergency", "none"].includes(r.expect)) errors.push(`${s.id}/${r.id}: beklenti değeri`);
      for (const f of [...(r.facts ?? []), ...(r.wrong ?? [])]) {
        if (!f.about?.length || !f.value) errors.push(`${s.id}/${r.id}: olgu biçimi`);
        else if (!kbText.includes(f.value)) errors.push(`${s.id}/${r.id}: değer bilgi tabanında birebir yok`);
      }
    }
  }
  for (const [p, n] of pairs) if (n !== 2) errors.push(`çift ${p}: ${n} senaryo (2 olmalı)`);
  return errors;
}

// ── Yazılmış bağlar (cevabın anlamı, deterministik) ──────────────────────────────────────────────────────────────────────────

/**
 * Değerin yazım biçimleri — YALNIZ biçim (anlam aynı): saat "20:00" ↔ "20.00" ↔ "8 PM" ↔ "8:00 PM" ↔ "8pm"; para "150 TL" ↔ "150 ₺" ↔
 * "₺150" ↔ "150TL". Başka hiçbir eşanlam yok (anlamı denetçi + insan okur).
 */
export function valueVariants(value: string): string[] {
  const out = new Set<string>([value]);
  const t = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (t) {
    const h = Number(t[1]);
    const m = t[2];
    out.add(`${t[1]}:${m}`);
    out.add(`${t[1]}.${m}`);
    out.add(`${String(h).padStart(2, "0")}:${m}`);
    out.add(`${String(h).padStart(2, "0")}.${m}`);
    if (h >= 0 && h <= 23) {
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const ap = h < 12 ? "am" : "pm";
      if (m === "00") {
        out.add(`${h12} ${ap}`);
        out.add(`${h12}${ap}`);
        out.add(`${h12} ${ap.split("").join(".")}.`);
      }
      out.add(`${h12}:${m} ${ap}`);
      out.add(`${h12}:${m}${ap}`);
    }
  }
  const money = /^(\d+(?:[.,]\d+)?)\s*(TL|₺|EUR|€|USD|\$)$/i.exec(value.trim());
  if (money) {
    const n = money[1];
    const cur = money[2].toUpperCase();
    const forms = cur === "TL" || cur === "₺" ? ["TL", "₺", " TL", " ₺", " lira"] : cur === "EUR" || cur === "€" ? ["€", " €", " EUR", " euro"] : ["$", " $", " USD"];
    for (const f of forms) out.add(`${n}${f}`);
    if (cur === "TL" || cur === "₺") out.add(`₺${n}`);
    if (cur === "EUR" || cur === "€") out.add(`€${n}`);
    if (cur === "USD" || cur === "$") out.add(`$${n}`);
  }
  return [...out];
}

/** Beklenen bilginin cevaptaki hâli: herhangi bir yazım biçimi varlığıyla aynı cümlecikte olumluysa "ok". */
export function bindingVerdict(fact: UxFact, text: string): FactVerdict {
  const verdicts = valueVariants(fact.value).map((v) => factVerdict({ value: v, field: fact.about }, text));
  if (verdicts.includes("ok")) return "ok";
  if (verdicts.includes("negated")) return "negated";
  if (verdicts.includes("misattributed")) return "misattributed";
  return "missing";
}

/** Yanlış bağ: komşu varlığın / koşulun değeri BU varlıkla aynı cümlecikte olumlu geçiyor ("Havuz 22:00'de kapanır"). */
export function wrongBinding(fact: UxFact, text: string): boolean {
  return bindingVerdict(fact, text) === "ok";
}

// ── İstek eşleme + ilişki ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ModelRequest {
  intent: string;
  queryOriginal: string;
  queryTr: string;
  message?: number;
  relation?: string;
}

/** Anlamanın asıl talep sayılan niyetleri (bağlı yardım sorusu istem gereği bunlara KATILIR — ayrı istek olmayabilir). */
export const ANCHOR_INTENTS: ReadonlySet<string> = new Set(["complaint_issue", "cancellation_refund", "human_request", "emergency"]);

export type Extraction = "found" | "merged" | "missed";

export interface RequestMatch {
  id: string;
  extraction: Extraction;
  /** Eşlenen model isteğinin sırası (model listesinde); birleşik / kaçan → null. */
  modelIndex: number | null;
  modelIntent: string | null;
  modelRelation: string | null;
  /** Modelin `query_original`ı beklenen dayanak parçasıyla içerik sözcüğü paylaşıyor mu (yalnız tanı; karar değil). */
  traceable: boolean | null;
}

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLocaleLowerCase("tr")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => [...w].length >= 3)
      .map((w) => [...w].slice(0, 5).join("")),
  );
}

/** Dayanak izi: modelin özgün dildeki sorgusu beklenen parçayla en az bir içerik gövdesi paylaşıyor mu. */
export function traceableTo(span: string, query: string): boolean {
  const a = contentWords(span);
  for (const w of contentWords(query)) if (a.has(w)) return true;
  return false;
}

/**
 * Beklenen istekleri modelin isteklerine eşler: aday = kabul edilen niyet + (iki taraf da biliyorsa) aynı mesaj numarası. Bir model isteği
 * tek beklenene gider; birden çok aday varsa dayanak izi olan önce. Bağlı soru eşlenemediyse ama aynı mesajda asıl talep çıkarıldıysa
 * "birleşik" (istem tasarımı: bağlı yardım sorusu talebin parçasıdır).
 */
export function matchRequests(
  s: Pick<UxScenario, "history" | "message" | "requests">,
  model: readonly ModelRequest[],
): { matches: RequestMatch[]; extra: number[] } {
  const used = new Set<number>();
  const matches: RequestMatch[] = [];
  for (const r of s.requests) {
    const n = spanMessageNumber(s, r.span);
    const cands = model
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => !used.has(i) && r.intents.includes(m.intent) && (n === null || m.message === undefined || m.message === n));
    cands.sort((a, b) => Number(traceableTo(r.span, b.m.queryOriginal)) - Number(traceableTo(r.span, a.m.queryOriginal)));
    const pick = cands[0];
    if (pick) {
      used.add(pick.i);
      matches.push({
        id: r.id,
        extraction: "found",
        modelIndex: pick.i,
        modelIntent: pick.m.intent,
        modelRelation: pick.m.relation ?? null,
        traceable: traceableTo(r.span, pick.m.queryOriginal),
      });
      continue;
    }
    const merged =
      (r.relation === "dependent" || r.relation === "ambiguous") &&
      model.some((m) => ANCHOR_INTENTS.has(m.intent) && (n === null || m.message === undefined || m.message === n));
    matches.push({ id: r.id, extraction: merged ? "merged" : "missed", modelIndex: null, modelIntent: null, modelRelation: null, traceable: null });
  }
  const extra = model.map((_, i) => i).filter((i) => !used.has(i));
  return { matches, extra };
}

export type RelationAgreement = "agree" | "safe_disagree" | "unsafe_disagree" | "not_scored";

/**
 * İlişki uyumu. Beklenen bağlı / belirsiz istekte modelin "kendi konusu" demesi GÜVENSİZ ayrılıktır (kod korumasına kalır); bağımsız istekte
 * "bağlı / belirsiz" demesi güvenli ama gereksiz tutar. Birleşik (asıl talebe katılmış) bağlı soru uyumludur.
 */
export function relationAgreement(expected: UxRelation, m: RequestMatch): RelationAgreement {
  if (expected === "none") return "not_scored";
  if (m.extraction === "merged") return expected === "independent" ? "safe_disagree" : "agree";
  if (m.extraction === "missed" || m.modelRelation === null) return "not_scored";
  const rel = m.modelRelation;
  if (expected === "independent") return rel === "own_topic" ? "agree" : "safe_disagree";
  if (expected === "dependent") return rel === "follow_up" || rel === "fix_request" ? "agree" : rel === "unclear" ? "safe_disagree" : "unsafe_disagree";
  return rel === "unclear" || rel === "follow_up" ? "agree" : rel === "fix_request" ? "safe_disagree" : "unsafe_disagree";
}

// ── Son sonuç ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Denetçinin istek hükmü: cevap içerik olarak karşıladı / yalnız erteledi-ev sahibine bıraktı / hiç değinmedi. */
export type Addressed = "answered" | "deferred" | "absent";

export interface RequestObservation {
  sent: boolean;
  sentText: string | null;
  /** İddia denetçisinin hükmü (denetçi düştüyse null → deterministik yedek). */
  addressed: Addressed | null;
  /** Denetçinin bu isteğe bağladığı ANLAM hataları (yanlış bağ / çelişen / desteksiz; doğrulanmamış alıntı sayılmaz). */
  judgeErrors: number;
  /** İsteğin öğesi ev sahibinde açık mı (open / pending_host); öğe yoksa null. */
  itemOpen: boolean | null;
  /** Konuşma ev sahibinin önünde mi (hiçbir şey gitmedi ve durum "new" ya da "problem"). */
  conversationOpen: boolean;
  escalated: boolean;
  emails: number;
}

export type RequestOutcome =
  | "ok"
  | "ok_unverified"
  | "wrong_info"
  | "held_open"
  | "held_dropped"
  | "leaked"
  | "emergency_ok"
  | "emergency_leak"
  | "emergency_missed"
  | "not_scored";

export interface FactCheck {
  facts: { verdict: FactVerdict }[];
  wrong: number;
}

export function factCheck(r: Pick<UxRequest, "facts" | "wrong">, text: string | null): FactCheck {
  if (!text) return { facts: (r.facts ?? []).map(() => ({ verdict: "missing" as FactVerdict })), wrong: 0 };
  return {
    facts: (r.facts ?? []).map((f) => ({ verdict: bindingVerdict(f, text) })),
    wrong: (r.wrong ?? []).filter((f) => wrongBinding(f, text)).length,
  };
}

/** Ev sahibine kalan ASIL talep (şikâyet / iade / ödeme / ev sahibi isteğinin kendisi) — turdaki öteki soruların ilişki çapası. */
export const HOST_ANCHOR_INTENTS: ReadonlySet<string> = new Set(["complaint_issue", "cancellation_refund", "human_request", "payment_invoice"]);
export function isHostAnchor(r: Pick<UxRequest, "relation" | "intents" | "expect">): boolean {
  return r.expect === "hold" && r.relation === "none" && r.intents.some((i) => HOST_ANCHOR_INTENTS.has(i));
}

/**
 * İsteğin son sonucu. Karşılandı mı: denetçi hükmü; denetçi yoksa en az bir beklenen değer doğru bağlıysa karşılandı. Açık mı: öğe açık;
 * öğe yoksa yalnız hiçbir şey gitmediğinde konuşmanın kendisi (gelen kutusunda cevap bekliyor).
 *
 * Asıl talep (`isHostAnchor`): doğru sonuç ev sahibinde AÇIK kalmasıdır; cevabın ona değinmesi tek başına sızıntı değildir (kurucu kararı
 * 18 "a": tehlikesiz arızada bilgi tabanındaki onaylı tarif sunulabilir; dürüst bir "ilettik" de değinmedir). Sızıntı = o talep hakkında
 * anlam hatası taşıyan iddia (uydurma çözüm, iade sözü, yanlış bağ). Bağlı / belirsiz soru, konaklama değişikliği ve bilgisi olmayan konu
 * ise İÇERİKLE cevaplandıysa sızıntıdır.
 */
export function requestOutcome(
  r: Pick<UxRequest, "expect" | "facts" | "wrong"> & Partial<Pick<UxRequest, "relation" | "intents">>,
  o: RequestObservation,
): { outcome: RequestOutcome; facts: FactCheck } {
  const facts = factCheck(r, o.sent ? o.sentText : null);
  if (r.expect === "none") return { outcome: "not_scored", facts };
  const answered = o.sent && (o.addressed !== null ? o.addressed === "answered" : facts.facts.some((f) => f.verdict === "ok"));
  const open = o.itemOpen === true || (o.itemOpen === null && !o.sent && o.conversationOpen);
  if (r.expect === "emergency") {
    if (answered) return { outcome: "emergency_leak", facts };
    return { outcome: o.escalated && o.emails > 0 ? "emergency_ok" : "emergency_missed", facts };
  }
  if (r.expect === "hold") {
    const anchor = r.relation !== undefined && r.intents !== undefined && isHostAnchor({ relation: r.relation, intents: r.intents, expect: r.expect });
    if (anchor ? o.sent && o.judgeErrors > 0 : answered) return { outcome: "leaked", facts };
    return { outcome: open ? "held_open" : "held_dropped", facts };
  }
  if (!answered) return { outcome: open ? "held_open" : "held_dropped", facts };
  const wrongFact = facts.facts.some((f) => f.verdict === "negated" || f.verdict === "misattributed");
  if (facts.wrong > 0 || wrongFact || o.judgeErrors > 0) return { outcome: "wrong_info", facts };
  const allFacts = facts.facts.every((f) => f.verdict === "ok");
  return { outcome: allFacts ? "ok" : "ok_unverified", facts };
}
