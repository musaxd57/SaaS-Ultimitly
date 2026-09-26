// ---------------------------------------------------------------------------
// KONUŞMA ANLAMA DURUMU v1 — dilim B (09-25; kurucu: "Conversation Understanding State"; tasarım
// `docs/MESAJLASMA-CEKIRDEGI-V2-2026-09-25.md` §2.2). Dilim A zaman/evreydi (`stay-timeline.ts`).
//
// Kalıcı kayıtlardan KODLA kurulan, PII'siz ve METİNSİZ bir özet: sohbette kaç mesaj gitti, ev sahibinin kendisi yazdı
// mı, önceki misafir mesajlarının KARAR KAYITLARINA (`RiskEvent`) göre hâlâ ev sahibinde bekleyen konular ve gönderilmiş
// otomatik bilgilendirmeler. Model geçmişi zaten görüyor; görmediği şey bir mesajın ev sahibine BIRAKILDIĞI, ev sahibinin
// henüz yazmadığı ya da bir isteğin kodla doğrulanıp onaylandığıdır.
//
// 🚨 KURALLAR:
//  · HİÇBİR KAPI bu modülü okumaz (mekanik pin `conversation-state-prompt.test.ts`): durum yalnız cevap modelinin
//    bağlamıdır. Yanlış bir durum kararı gevşetemez; en kötü hâli kötü bir taslaktır ve kapılar onu yine süzer.
//  · Konu adları önceki SINIFLANDIRMANIN etiketidir (karar kaydındaki kapalı-küme kodlar), olgu değildir; istem bunu
//    açıkça söyler. Yalnız MODEL kaynaklı etiketler kullanılır — kelime ağının uyarıları (`g.lx`) kesinliği düşük
//    olduğu için konu adı OLMAZ.
//  · Kayıt yoksa durum "bilinmiyor"dur, "istek yok" DEĞİL → blok o mesaj hakkında hiçbir şey söylemez.
//  · Bayrak `AI_CONVERSATION_STATE_ENABLED` (tam "1"; varsayılan KAPALI): kapalıyken yükleyici hiç koşmaz, istem bayt
//    bayt aynı. Açma = kör eval (`evals/conversation-state.json`) + kurucu onayı.
// Saf; DB yok (yükleyici `conversation-state-loader.ts`).
// ---------------------------------------------------------------------------

import { resolveMessageAuthor } from "@/lib/message-author";

export const STATE_TOPICS = [
  "early_checkin",
  "late_checkout",
  "extend",
  "date_change",
  "availability",
  "complaint",
  "emergency",
  "refund",
  "human",
  "other",
] as const;
export type StateTopic = (typeof STATE_TOPICS)[number];

/**
 * Açık konunun durumu:
 *  · pending_host      — ev sahibine bırakıldı (taslak); o mesajdan sonra misafire HİÇBİR mesaj gitmedi.
 *  · deferred_to_host  — misafire kararın ev sahibinde olduğu söylendi (erteleyen cevap / QR devri); ev sahibi henüz yazmadı.
 *  · host_replied      — konu açıldıktan SONRA ev sahibi kendisi yazdı (onun cevabı esastır).
 *  · code_approved     — kod doğrulayıp onay metnini gönderdi (doğrulanmış erken giriş).
 */
export const STATE_ITEM_STATUSES = ["pending_host", "deferred_to_host", "host_replied", "code_approved"] as const;
export type StateItemStatus = (typeof STATE_ITEM_STATUSES)[number];

export const LIFECYCLE_KINDS = ["welcome", "checkin", "checkout"] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

export interface StateMessage {
  id: string;
  direction: string;
  senderName: string;
  authorType?: string | null;
  systemEventType?: string | null;
  body: string;
}

export interface StateDecision {
  /** Kararı tetikleyen misafir mesajının kimliği. */
  triggerId: string;
  surface: string;
  finalDecision: string;
  reason: string | null;
  riskType: string | null;
  kbEvidenceJson: string | null;
}

export interface LifecycleStamps {
  welcomeSentAt?: Date | null;
  checkinSentAt?: Date | null;
  checkoutSentAt?: Date | null;
}

export interface ConversationStateSummary {
  /** Misafire giden (sistem olayı ve gövdesiz satır hariç) mesaj sayısı — yazarı ne olursa olsun. */
  outbound: number;
  /** Bunların ev sahibinin KENDİSİNİN yazdığı kısmı (tek tıkla onaylanmış taslak dahil). */
  hostOutbound: number;
  /** Son giden mesajdan sonra misafirin yazdığı mesaj sayısı. */
  unansweredGuest: number;
  /** Açık konular (en yeni en sonda, en fazla `MAX_STATE_ITEMS`). */
  items: { topic: StateTopic; status: StateItemStatus }[];
  lifecycleSent: LifecycleKind[];
}

/** Karar kaydı taranan son misafir mesajı sayısı ve bloğa giren en fazla konu. */
export const STATE_DECISION_WINDOW = 10;
export const MAX_STATE_ITEMS = 5;

const STAY_TOPICS: Readonly<Record<string, StateTopic>> = {
  early_checkin: "early_checkin",
  late_checkout: "late_checkout",
  extend: "extend",
  date_change: "date_change",
  availability: "availability",
};
// Anlama katmanının risk niyeti (`ir.k`, `semantic/intent-risk.ts` INTENT_RISK_KINDS).
const INTENT_RISK_TOPICS: Readonly<Record<string, StateTopic>> = {
  emergency: "emergency",
  complaint_issue: "complaint",
  cancellation_refund: "refund",
  human_request: "human",
};
// Cevap modelinin kapatıcı niyeti (`g.mi`) ve risk etiketi (`g.mt` / `RiskEvent.riskType`).
const MODEL_INTENT_TOPICS: Readonly<Record<string, StateTopic>> = {
  complaint: "complaint",
  refund: "refund",
};
const RISK_TYPE_TOPICS: Readonly<Record<string, StateTopic>> = {
  complaint: "complaint",
  review_threat: "complaint",
  safety_emergency: "emergency",
  money_refund: "refund",
  cancellation: "refund",
  human_request: "human",
};

type Evidence = {
  sc?: { d?: unknown; ri?: unknown };
  ec?: unknown;
  ir?: { k?: unknown };
  g?: { mi?: unknown; mt?: unknown };
};

function parseEvidence(json: string | null): Evidence {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Evidence) : {};
  } catch {
    return {};
  }
}

/** "asked/stance" beyanı (`sc.d`); "absent" ya da bozuk → null. */
function declared(ev: Evidence): { asked: string; stance: string } | null {
  const d = ev.sc?.d;
  if (typeof d !== "string") return null;
  const m = /^([a-z_]+)\/([a-z_]+)$/.exec(d);
  return m ? { asked: m[1], stance: m[2] } : null;
}

const pick = (table: Readonly<Record<string, StateTopic>>, v: unknown): StateTopic | null =>
  typeof v === "string" && Object.hasOwn(table, v) ? table[v] : null;

/** Kararın konusu — YALNIZ model / kod kaynaklı kapalı-küme kodlardan (kelime ağı uyarısı konu adı olmaz). */
export function decisionTopic(d: StateDecision): StateTopic {
  const ev = parseEvidence(d.kbEvidenceJson);
  if (ev.ec && typeof ev.ec === "object") return "early_checkin";
  return (
    pick(STAY_TOPICS, declared(ev)?.asked) ??
    pick(STAY_TOPICS, ev.sc?.ri) ??
    pick(INTENT_RISK_TOPICS, ev.ir?.k) ??
    pick(MODEL_INTENT_TOPICS, ev.g?.mi) ??
    pick(RISK_TYPE_TOPICS, ev.g?.mt) ??
    pick(RISK_TYPE_TOPICS, d.riskType) ??
    "other"
  );
}

/** Aynı mesaja birden çok karar (tutuldu → sonra gönderildi): gönderim tutmayı, tutma sessizliği yener. */
const DECISION_RANK: Readonly<Record<string, number>> = { auto_sent: 3, human_review: 2, no_reply: 1 };

/** Misafirin gördüğü giden mesajın yazarı (yapay zekâ / ev sahibi); sistem olayı ve gövdesiz satır mesaj DEĞİL → null. */
function replyAuthor(m: StateMessage): "ai" | "host" | null {
  if (m.direction !== "outbound" || m.systemEventType || m.body.trim() === "") return null;
  const a = resolveMessageAuthor(m).authorType; // eski satırlar: ad kuralı (eski QR "yeniden başlatıldı" işareti = sistem)
  return a === "ai" || a === "host" ? a : null;
}

/**
 * Kalıcı kayıtlardan durum özeti. `messages` kronolojik (`(createdAt, id)` artan) VE konuşmanın tamamı ya da
 * sonundan kesintisiz bir pencere olmalı: "sonra ev sahibi yazdı mı" bu sıradan okunur.
 */
export function buildConversationState(input: {
  messages: readonly StateMessage[];
  decisions: readonly StateDecision[];
  lifecycle?: LifecycleStamps | null;
}): ConversationStateSummary {
  const { messages } = input;
  const authors = messages.map(replyAuthor);
  let outbound = 0;
  let hostOutbound = 0;
  let lastOutboundIdx = -1;
  authors.forEach((a, i) => {
    if (a === null) return;
    outbound++;
    if (a === "host") hostOutbound++;
    lastOutboundIdx = i;
  });
  const unansweredGuest = messages.filter((m, i) => i > lastOutboundIdx && m.direction === "inbound").length;

  // Mesaj başına en güçlü karar.
  const best = new Map<string, StateDecision>();
  for (const d of input.decisions) {
    const cur = best.get(d.triggerId);
    if (!cur || (DECISION_RANK[d.finalDecision] ?? 0) > (DECISION_RANK[cur.finalDecision] ?? 0)) best.set(d.triggerId, d);
  }

  const guestIdx: number[] = [];
  messages.forEach((m, i) => {
    if (m.direction === "inbound") guestIdx.push(i);
  });
  // Konu başına EN YENİ durum. Cevaplanmış bir karar (durum yok) eski kaydı SİLMEZ: aynı konuda bir bilgi sorusunun
  // cevaplanması, daha önce ev sahibine bırakılmış isteği çözmez — onu yalnız ev sahibinin yazması ya da kodun onayı çözer.
  const byTopic = new Map<StateTopic, StateItemStatus>();
  for (const i of guestIdx.slice(-STATE_DECISION_WINDOW)) {
    const d = best.get(messages[i].id);
    if (!d) continue; // kayıt yok = bilinmiyor → hiçbir şey söylenmez
    const status = itemStatus(d, i, authors);
    if (status === null) continue;
    const topic = decisionTopic(d);
    byTopic.delete(topic); // en yeni sona (sıra = zaman)
    byTopic.set(topic, status);
  }
  const items = [...byTopic].map(([topic, status]) => ({ topic, status })).slice(-MAX_STATE_ITEMS);

  const lc = input.lifecycle;
  const lifecycleSent: LifecycleKind[] = [];
  if (lc?.welcomeSentAt) lifecycleSent.push("welcome");
  if (lc?.checkinSentAt) lifecycleSent.push("checkin");
  if (lc?.checkoutSentAt) lifecycleSent.push("checkout");

  return { outbound, hostOutbound, unansweredGuest, items, lifecycleSent };
}

function itemStatus(d: StateDecision, idx: number, authors: readonly (string | null)[]): StateItemStatus | null {
  const after = authors.slice(idx + 1);
  const hostAfter = after.includes("host");
  const anyAfter = after.some((a) => a !== null);
  if (d.finalDecision === "auto_sent") {
    if (d.reason === "early_checkin_verified") return hostAfter ? "host_replied" : "code_approved";
    // Bilgi sorusuna koddan politika metni gitti (istek YOKTU — iki model de "istek yok" dedi): açık konu değil.
    if (d.reason === "early_checkin_policy") return null;
    if (declared(parseEvidence(d.kbEvidenceJson))?.stance === "defers") return hostAfter ? "host_replied" : "deferred_to_host";
    return null; // cevaplandı
  }
  if (d.finalDecision !== "human_review") return null; // kapanışa sessizlik (no_reply) açık konu değildir
  if (hostAfter) return "host_replied";
  // QR devrinde misafire devir metni ("kaydedildi; ev sahibiniz görebilir") hemen gider → karar ev sahibinde.
  if (d.surface === "guest_chat") return "deferred_to_host";
  // Kanal: tutulan mesajdan sonra yapay zekâ bir cevap gönderdiyse o geçiş bu mesajı da kapsadı (cevapsız mesajların
  // tamamı kapıdan geçer) → konunun durumu O kararın kaydındadır.
  return anyAfter ? null : "pending_host";
}

const TOPIC_TR: Readonly<Record<StateTopic, string>> = {
  early_checkin: "erken giriş",
  late_checkout: "geç çıkış",
  extend: "konaklama uzatma",
  date_change: "tarih değişikliği",
  availability: "müsaitlik",
  complaint: "sorun bildirimi / şikâyet",
  emergency: "acil durum",
  refund: "iptal / iade",
  human: "ev sahibiyle görüşme isteği",
  other: "etiketsiz bir önceki mesaj",
};

const STATUS_TR: Readonly<Record<StateItemStatus, string>> = {
  pending_host: "ev sahibine bırakıldı; o mesajdan sonra misafire hiçbir mesaj gitmedi",
  deferred_to_host: "misafire kararın ev sahibinde olduğu söylendi; ev sahibi henüz yazmadı",
  host_replied: "bu konu açıldıktan sonra ev sahibi kendisi yazdı (onun cevabı esastır)",
  code_approved: "kod doğrulayıp onayladı; onay mesajı misafire gitti",
};

const LIFECYCLE_TR: Readonly<Record<LifecycleKind, string>> = {
  welcome: "karşılama",
  checkin: "giriş bilgileri",
  checkout: "çıkış bilgileri",
};

/**
 * İstem bloğu (Türkçe). Söylenecek bir şey yoksa boş dize: ilk temas + açık konu yok + otomatik mesaj yok →
 * mevcut "KONUŞMA DURUMU" satırı yeter.
 */
export function conversationStateBlock(s: ConversationStateSummary | null | undefined): string {
  if (!s || (s.items.length === 0 && s.lifecycleSent.length === 0 && s.outbound === 0)) return "";
  const lines = [
    "KONUŞMA KAYITLARI (kodda, kalıcı kayıtlardan kuruldu):",
    `- Bu sohbette misafire giden mesaj: ${s.outbound} (ev sahibinin kendisinin yazdığı: ${s.hostOutbound}). Son giden mesajdan sonra misafirin yazdığı mesaj: ${s.unansweredGuest}.`,
  ];
  if (s.lifecycleSent.length > 0) {
    lines.push(`- Otomatik gönderilmiş bilgilendirme: ${s.lifecycleSent.map((k) => LIFECYCLE_TR[k]).join(", ")}.`);
  }
  if (s.items.length > 0) {
    lines.push(
      "- Önceki konular (konu adları eski sınıflandırmanın ETİKETİDİR, olgu değil — esas olan misafirin kendi mesajlarıdır):",
      ...s.items.map((it) => `  · ${TOPIC_TR[it.topic]}: ${STATUS_TR[it.status]}.`),
      "- Kararı ev sahibinde olan konuda karar VERME, söz VERME, sonuç UYDURMA; misafir yeniden sorarsa yalnız isteğin kayıtlı olduğunu ve ev sahibinin görebildiğini söyle. Ev sahibinin kendi yazdığı cevapla ÇELİŞME.",
    );
  }
  return `\n\n${lines.join("\n")}`;
}

/** Tam "1" açar (diğer anlam katmanı bayraklarıyla aynı kural). */
export function conversationStateEnabled(): boolean {
  return process.env.AI_CONVERSATION_STATE_ENABLED === "1";
}
