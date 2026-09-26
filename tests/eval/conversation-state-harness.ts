import { writeFileSync } from "node:fs";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { autoReplyGateFailure, semanticClosingHolds, type AutoReplyGateContext } from "@/lib/automation";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { closableAfter, lexicalClosingOnly, type ClosingThreadMessage } from "@/lib/ai/closing-turn";
import {
  buildConversationState,
  conversationStateEnabled,
  type StateDecision,
  type StateMessage,
} from "@/lib/ai/conversation-state";
import { selectHistoryForPrompt } from "@/lib/ai/prompts";
import { historyAuthorOf } from "@/lib/message-author";
import type { StayChangeKind } from "@/lib/ai/semantic/stay-change";
import { addNights, stayEndedBefore, todayKey } from "@/modules/availability/core";
import { writeSidecar } from "./sidecar";
import { GREETING, isGenericClarification, promiseInReply, questionSentences } from "./reply-metrics";

// ---------------------------------------------------------------------------
// KONUŞMA ANLAMA DURUMU EVAL'İ — araç mantığı (test dosyası DEĞİL: ücretli koşu `conversation-state.eval.test.ts`,
// ücretsiz bağlantı testi `conversation-state-wiring.test.ts` bunu içe aktarır; test dosyası test dosyası içe aktarmaz).
//
// Bayrak `AI_CONVERSATION_STATE_ENABLED` iki şey ekler: cevap istemine "KONUŞMA KAYITLARI" bloğu (kalıcı kayıtlardan
// kodla kurulan özet) ve anlama katmanına gün hassasiyetli tarih satırı. Açma kararı EŞLEŞTİRİLMİŞ koşudur (MÇ v2 §2.2):
// AYNI senaryolar bayrak KAPALI ve AÇIK iki kolda, ürünün kanal yoluyla aynı yapı taşlarından geçer:
//   bitmiş konaklama çiti → kapanış kısayolu (sözcük) → bilgi seçimi + anlama katmanı (`retrieveKbForPrompt`) →
//   `suggestReply` → kapı (`autoReplyGateFailure`, anlama katmanının sinyalleriyle) → kapanışa sessizlik anlam yolu.
// Durum özeti ürünün SAF kurucusundan (`buildConversationState`): senaryo karar kayıtlarını kapalı-küme kodlarla verir,
// yükleyicinin veritabanı yaptığı iş yalnız bu okuma. Kapalı kolda özet VERİLMEZ (yükleyici bayrak kapalıyken koşmaz).
//
// Yapılandırma (canlıyla aynı, bir fark): anlama katmanı AÇIK · eylem beyanı KAPALI · anlamsal getirme KAPALI ·
// 🚨 BEKÇİ KOŞMAZ. Etkisi ölçülü: kapanış ölçüsü BİREBİR (üründe bekçi yalnız kapı geçtiğinde / müsaitlik tutuşunda
// çağrılır, kapanışın anlam yolu ise "blocked" gerekçesinde koşar); sızıntı ölçüsü TEMKİNLİ (bekçinin sıkılaştırması
// yok → ürün en fazla bu kadar sızdırır); iki modelin doğruladığı erteleme burada TUTULU kalır (otomatik oranı ürünün
// altında). Doğrulanmış erken giriş iş akışı (veritabanı + host kuralı) koşmaz: varsayılan kural kapalı olduğundan
// sonucu değiştirmez. Kollar arasındaki FARK iki kolda aynı yapılandırmayla ölçülür.
//
// Ölçüler (deterministik, LLM grader YOK — soru cümleleri ve cevaplar raporda aynen, insan okur): ↓`CUS_METRICS`.
// ---------------------------------------------------------------------------

export const CUS_CLASSES = [
  "tomorrow_early",
  "checkout_time",
  "travel_not_checkout",
  "closing",
  "closing_trap",
  "pending_followup",
  "resolvable",
  "ambiguous",
] as const;
export type CusClass = (typeof CUS_CLASSES)[number];

export const CUS_LANGS = ["tr", "en", "de", "fr", "es", "ru", "ar"] as const;

/** Bir mesajın yazıldığı an: koşu gününden kaç gün önce (0 = koşu günü), mülk diliminde "SS:DD". */
export interface CusWhen {
  daysAgo: number;
  time: string;
}

export interface CusMessage {
  direction: "inbound" | "outbound";
  /** Giden mesajın yazarı (varsayılan yapay zekâ). */
  author?: "ai" | "host";
  body: string;
  /**
   * Yazıldığı an (F14 — istemde yalnız bayrak açıkken görünür). Ya geçmişin HİÇBİR mesajına ya HEPSİNE verilir; yoksa
   * varsayılan: hepsi bugün, şimdiden geriye birkaç dakika arayla (↓`timesOf`).
   */
  at?: CusWhen;
  /**
   * Misafir mesajının KARAR KAYDI (kapalı-küme kodlar; kayıt bloğunun kaynağı). Yoksa o mesaj için kayıt yok =
   * "bilinmiyor" (blok o mesaj hakkında hiçbir şey söylemez).
   */
  decision?: {
    finalDecision: "auto_sent" | "human_review" | "no_reply";
    /** Örn. `early_checkin_verified`, `early_checkin_policy`. */
    reason?: string;
    /** Cevap modelinin beyanı "tür/duruş", örn. `early_checkin/defers` (`sc.d`). */
    stay?: string;
    /** Risk etiketi (`RiskEvent.riskType`, kapalı küme). */
    riskType?: string;
    /** Varsayılan kanal oto-yanıtı; QR devri `guest_chat`. */
    surface?: "auto_reply" | "guest_chat";
  };
}

export interface CusScenario {
  id: string;
  class: CusClass;
  lang: (typeof CUS_LANGS)[number];
  /** Rezervasyon: giriş bugünden kaç gün sonra (negatif = geçmişte), kaç gece; `null` = bağlı rezervasyon yok. */
  reservation: {
    arrivalInDays: number;
    nights: number;
    status?: "confirmed" | "pending";
    /** Misafirin daha önce yazdığı çıkış saati ("SS:DD") — düzeltme senaryoları. */
    guestCheckoutTime?: string;
  } | null;
  /** Mülk diliminde yerel saat "SS:DD" (varsayılan 14:00) — gece yarısından sonraki "yarın" senaryoları için. */
  localTime?: string;
  /** Gönderilmiş otomatik bilgilendirmeler. */
  lifecycleSent?: ("welcome" | "checkin" | "checkout")[];
  history?: CusMessage[];
  /** Cevaplanacak son misafir mesajı. */
  message: string;
  /**
   * Cevaplanacak mesajın yazıldığı an (varsayılan: bir dakika önce). Dün yazılıp bugün cevaplanan "yarın" senaryosu için
   * (gelen kutusu önerisi / yeniden değerlendirme). Verilirse geçmişin de tamamı zamanlı olmalı.
   */
  messageAt?: CusWhen;
  expect: {
    /** Kapanış: ürün HİÇBİR ŞEY göndermemeli (true) / gerçek soru-istek: susturulmamalı (false). */
    silent?: boolean;
    /** Beklenen konaklama isteği türü (`none` = istek yok). */
    stayKind?: StayChangeKind;
    /** Beklenen kayıtlı çıkış saati ("SS:DD") ya da `null` (kayıt olmamalı — yolculuk saati). */
    statedCheckoutTime?: string | null;
    /** `none` = bağlamla çözülür, soru sorulmamalı · `one` = gerçekten belirsiz, en olası anlamı öneren TEK soru. */
    clarify?: "none" | "one";
    autoSend?: "yes" | "no" | "any";
  };
}

export interface CusDataset {
  version: number;
  property: { name: string; checkInTime: string; checkOutTime: string; address?: string; city?: string };
  kb?: { category: string; title: string; content: string }[];
  scenarios: CusScenario[];
}

/** Senaryoların saat dilimi — sabit ofset (+03:00, 2016'dan beri yaz saati yok; pinli). */
export const CUS_TZ = "Europe/Istanbul";
const TZ_OFFSET = "+03:00";
export const DEFAULT_LOCAL_TIME = "14:00";
export const GUEST_NAME = "Alex Doe";
/** Kanal sınıflandırmasının sihirli yapay zekâ gönderici adı (CLAUDE.md "DOKUNMA"); yazarı `authorType` da taşır. */
const AI_SENDER = "GuestOps AI";

export type Arm = "off" | "on";

/** Mülk diliminde `key` gününün `hhmm` duvar saati. */
export function localInstant(key: string, hhmm: string): Date {
  return new Date(`${key}T${hhmm}:00${TZ_OFFSET}`);
}

/** Rezervasyon tarihleri YALNIZ-TARİH çapası (00:00Z — kanal içe aktarımının yazdığı biçim; `calendarDateOf`). */
export function reservationOf(s: CusScenario, today: string) {
  if (!s.reservation) return null;
  const arrival = addNights(today, s.reservation.arrivalInDays);
  return {
    guestName: GUEST_NAME,
    arrivalDate: new Date(`${arrival}T00:00:00.000Z`),
    departureDate: new Date(`${addNights(arrival, s.reservation.nights)}T00:00:00.000Z`),
    status: s.reservation.status ?? "confirmed",
    guestCheckoutTime: s.reservation.guestCheckoutTime ?? null,
  };
}

export type ThreadMessage = StateMessage & ClosingThreadMessage;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Konuşmanın (geçmiş + cevaplanacak mesaj) yazılma anları, `threadOf` sırasıyla. Zaman ya hiç verilmez (varsayılan: geçmiş
 * şimdiden geriye 2'şer dakika, cevaplanacak mesaj bir dakika önce — hepsi bugün) ya da geçmişin TAMAMINA verilir. Anlar
 * kronolojik olmalı ve şimdiden sonra olamaz; aksi hâlde veri seti HATALIDIR (fırlatır — sessizce düzeltilmez).
 */
export function timesOf(s: CusScenario, runDay: string, now: Date): Date[] {
  const hist = s.history ?? [];
  const given = hist.filter((m) => m.at !== undefined).length;
  if (given !== 0 && given !== hist.length) throw new Error(`${s.id}: geçmiş zamanı ya hiçbir mesaja ya hepsine verilir`);
  if (s.messageAt && given !== hist.length) throw new Error(`${s.id}: messageAt verilince geçmişin tamamı zamanlı olmalı`);
  const at = (w: CusWhen) => {
    if (!Number.isInteger(w.daysAgo) || w.daysAgo < 0 || !HHMM_RE.test(w.time)) {
      throw new Error(`${s.id}: geçersiz zaman ${JSON.stringify(w)}`);
    }
    return localInstant(addNights(runDay, -w.daysAgo), w.time);
  };
  const n = hist.length + 1;
  const times = hist.map((m, i) => (m.at ? at(m.at) : new Date(now.getTime() - (n - i) * 120_000)));
  times.push(s.messageAt ? at(s.messageAt) : new Date(now.getTime() - 60_000));
  for (let i = 1; i < times.length; i++) {
    if (times[i].getTime() < times[i - 1].getTime()) throw new Error(`${s.id}: zamanlar kronolojik değil`);
  }
  if (times[times.length - 1].getTime() > now.getTime()) throw new Error(`${s.id}: cevaplanacak mesaj şimdiden sonra`);
  return times;
}

/** Senaryonun konuşması ürünün mesaj biçiminde (kronolojik; SON satır cevaplanacak misafir mesajı). */
export function threadOf(s: CusScenario): ThreadMessage[] {
  const rows: ThreadMessage[] = (s.history ?? []).map((m, i) => ({
    id: `${s.id}-m${i}`,
    direction: m.direction,
    senderName: m.direction === "inbound" ? "Misafir" : m.author === "host" ? "Ev sahibi" : AI_SENDER,
    authorType: m.direction === "inbound" ? "guest" : (m.author ?? "ai"),
    systemEventType: null,
    body: m.body,
  }));
  rows.push({ id: `${s.id}-last`, direction: "inbound", senderName: "Misafir", authorType: "guest", systemEventType: null, body: s.message });
  return rows;
}

/** Senaryonun karar kayıtları ürünün `StateDecision` biçiminde (kanıt yalnız kapalı-küme `sc.d`). */
export function decisionsOf(s: CusScenario, thread: readonly ThreadMessage[]): StateDecision[] {
  const out: StateDecision[] = [];
  (s.history ?? []).forEach((m, i) => {
    if (m.direction !== "inbound" || !m.decision) return;
    const d = m.decision;
    out.push({
      triggerId: thread[i].id,
      surface: d.surface ?? "auto_reply",
      finalDecision: d.finalDecision,
      reason: d.reason ?? null,
      riskType: d.riskType ?? null,
      kbEvidenceJson: d.stay ? JSON.stringify({ sc: { d: d.stay } }) : null,
    });
  });
  return out;
}

/** Selam kuralı (`PRIOR_OPERATOR_REPLY_WHERE`): giden + sistem olayı değil + gövdesi boş değil. */
export function isFirstOperatorReply(thread: readonly ThreadMessage[]): boolean {
  return !thread.some((m) => m.direction === "outbound" && !m.systemEventType && m.body !== "");
}

/** Son giden mesajdan sonraki misafir mesajları (sonuncusu cevaplanan mesaj) — kanal yoluyla aynı dilim. */
export function unansweredOf(thread: readonly ThreadMessage[]): string[] {
  const lastOut = thread.map((m) => m.direction).lastIndexOf("outbound");
  return thread.slice(lastOut + 1).filter((m) => m.direction === "inbound").map((m) => m.body);
}

/**
 * Model çağrısından ÖNCEKİ kanal kararları (ürün sırası): bitmiş konaklamaya cevap yok, sonra kapanışa sessizlik sözcük
 * yolu. Nezaket cevabı (host seçimi, varsayılan kapalı) ölçülmez.
 */
export function preModelSilence(
  s: CusScenario,
  thread: readonly ThreadMessage[],
  now: Date,
): "reservation_ended" | "lexical" | null {
  const r = reservationOf(s, todayKey(now, CUS_TZ));
  if (r && stayEndedBefore(r.departureDate, now, CUS_TZ)) return "reservation_ended";
  if (closableAfter(thread) && lexicalClosingOnly(unansweredOf(thread))) return "lexical";
  return null;
}

export interface CusRow {
  id: string;
  cls: CusClass;
  lang: string;
  arm: Arm;
  expect: CusScenario["expect"];
  ok: boolean;
  error?: string;
  source?: string;
  retried?: boolean;
  /** Ürün hiçbir şey göndermedi: bitmiş konaklama, kapanış sözcük yolu ya da anlam yolu. */
  silent: "reservation_ended" | "lexical" | "semantic" | null;
  /** Model çağrıldı mı (sözcük yolu / bitmiş konaklamada çağrılmaz). */
  modelRan: boolean;
  auto?: boolean;
  gate?: string | null;
  reply?: string;
  questions?: string[];
  generic?: boolean;
  promise?: boolean;
  asked?: string | null;
  stance?: string | null;
  /** Anlama katmanının konaklama türü (`none` = istek yok); katman koşmadıysa null. */
  uKind?: string | null;
  uStatus?: string;
  stated?: string | null;
  greet?: boolean | null;
  /** Açık kolda isteme giren durum kalemi sayısı. */
  records?: number;
  ms?: number;
  pt?: number;
  ct?: number;
  cpt?: number;
}

/** Yanıt türev alanları (ücretsiz yeniden puanlama da bunu kullanır). */
export function scoreReply(row: CusRow, reply: string, priorReply: boolean): CusRow {
  const questions = questionSentences(reply);
  return {
    ...row,
    reply,
    questions,
    generic: questions.some(isGenericClarification),
    promise: promiseInReply(reply),
    greet: priorReply ? GREETING.test(reply) : null,
  };
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export function normHhmm(v: string | null | undefined): string | null {
  const m = typeof v === "string" ? HHMM.exec(v.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export interface RunOptions {
  /** Cevap modeli çağrısından önce (istek tavanı); verilmezse beklemez. */
  throttle?: () => Promise<void>;
  /** Yedeğe düşüşte yeniden deneme beklemesi (ms). Varsayılan 20 sn (model kıyasıyla aynı kural). */
  retryDelayMs?: number;
}

/**
 * Bir senaryo, bir kol — ürünün kanal yolunun yapı taşları, ürünün sırasıyla. 🚨 Kol ile bayrak UYUŞMALI: tarih satırı
 * bayrağı çağrı anında okur (`retrieveKbForPrompt`), özet ise kola göre verilir; uyuşmazlık sessiz karışık ölçüm olurdu.
 */
export async function runScenario(data: CusDataset, s: CusScenario, arm: Arm, runDay: string, opts: RunOptions = {}): Promise<CusRow> {
  if ((arm === "on") !== conversationStateEnabled()) {
    throw new Error(`kol "${arm}" ile AI_CONVERSATION_STATE_ENABLED uyuşmuyor`);
  }
  const base: CusRow = { id: s.id, cls: s.class, lang: s.lang, arm, expect: s.expect, ok: false, silent: null, modelRan: false };
  const t0 = Date.now();
  try {
    const now = localInstant(runDay, s.localTime ?? DEFAULT_LOCAL_TIME);
    const thread = threadOf(s);
    const pre = preModelSilence(s, thread, now);
    if (pre) return { ...base, ok: true, silent: pre, ms: Date.now() - t0 };

    const reservation = reservationOf(s, runDay);
    // Kanal yoluyla aynı: geçmiş cevaplanan mesajı da taşır (`messages.map`, son satır = `last`) — istem ayıklamaz. Yazar +
    // yazıldığı an (F14) da kanal yoluyla aynı alanlardan; istemde yalnız açık kolda görünür (kapalıda bayt bayt eskisi).
    const times = timesOf(s, runDay, now);
    const history = thread.map((m, i) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
      author: historyAuthorOf(m),
      at: times[i],
    }));
    const unanswered = unansweredOf(thread);
    const pending = unanswered.slice(0, -1);
    const stayTimes = { checkIn: data.property.checkInTime, checkOut: data.property.checkOutTime };
    const kbSel = await retrieveKbForPrompt({
      items: (data.kb ?? []).map((k, i) => ({ id: `kb-${i}`, ...k, updatedAt: new Date("2026-09-01T00:00:00Z") })) as never,
      guestMessage: s.message,
      history,
      stayTimes,
      redactNames: [GUEST_NAME],
      dateContext: { now, timeZone: CUS_TZ, reservation },
    });
    const lc = new Set(s.lifecycleSent ?? []);
    // Açık kol = yükleyicinin döndürdüğü özet; kapalı kolda yükleyici hiç koşmaz (alan yok → istem bayt bayt eskisi).
    const records =
      arm === "on"
        ? buildConversationState({
            messages: thread,
            decisions: decisionsOf(s, thread),
            lifecycle: {
              welcomeSentAt: lc.has("welcome") ? now : null,
              checkinSentAt: lc.has("checkin") ? now : null,
              checkoutSentAt: lc.has("checkout") ? now : null,
            },
          })
        : undefined;
    const input: SuggestReplyInput = {
      guestMessage: s.message,
      property: { ...data.property },
      reservation,
      timeZone: CUS_TZ,
      now,
      knowledgeBase: kbSel.items,
      knowledgeBaseDropped: kbSel.droppedItems,
      knowledgeBaseSelection: kbSel.selection,
      knowledgeBaseNotes: kbSel.notes,
      history,
      guestMessageAt: times[times.length - 1],
      conversationState: { isFirstOperatorReply: isFirstOperatorReply(thread), records },
      tone: "warm",
      language: "tr",
    };
    await opts.throttle?.();
    const t1 = Date.now();
    let result = await suggestReply(input);
    let retried = false;
    if (result.source !== "openai") {
      retried = true;
      await new Promise((res) => setTimeout(res, opts.retryDelayMs ?? 20_000));
      await opts.throttle?.();
      result = await suggestReply(input);
    }
    const understood = await kbSel.understanding;
    const uStatus = await kbSel.understandingStatus;
    const ctx: AutoReplyGateContext = {
      history: [...selectHistoryForPrompt(history).map((m) => m.body), GUEST_NAME],
      guestName: GUEST_NAME,
      pendingGuestMessages: pending,
      stayTimes,
      understanding: understood?.stay ?? null,
      understandingFailed: uStatus === "failed",
      understandingRisk: understandingRiskOf(understood),
      hostOfferText: null,
    };
    const gate = autoReplyGateFailure(result, s.message, ctx);
    const semantic = gate === "blocked" && semanticClosingHolds(result, s.message, ctx, understood, unanswered, closableAfter(thread));
    const row: CusRow = {
      ...base,
      ok: result.source === "openai",
      source: result.source,
      retried,
      modelRan: true,
      silent: semantic ? "semantic" : null,
      auto: !semantic && gate === null,
      gate,
      asked: result.stayChange?.asked ?? null,
      stance: result.stayChange?.stance ?? null,
      uKind: understood ? (understood.stay.requested ? understood.stay.kind : "none") : null,
      uStatus,
      stated: normHhmm(result.statedCheckoutTime ?? null),
      records: records?.items.length,
      ms: retried ? Date.now() - t0 : Date.now() - t1,
      pt: result.llmUsage?.pt,
      ct: result.llmUsage?.ct,
      cpt: result.llmUsage?.cpt,
    };
    return scoreReply(row, result.reply ?? "", !isFirstOperatorReply(thread));
  } catch (err) {
    return { ...base, error: String((err as Error)?.message ?? err).slice(0, 200), ms: Date.now() - t0 };
  }
}

// ─── Ölçüler ve rapor ────────────────────────────────────────────────────────────────────────────────────────────

interface Metric {
  label: string;
  target?: string;
  den: (r: CusRow) => boolean;
  num: (r: CusRow) => boolean;
}

export const muted = (r: CusRow): boolean => r.silent === "lexical" || r.silent === "semantic";

/** Ölçü tanımları — iki kol AYNI tanımla sayılır. Payda yalnız cevap modeli geçerli satırlar (düşüş ayrı satırda). */
export const CUS_METRICS: readonly Metric[] = [
  { label: "🚨 SIZINTI (beklenti 'gitmez' iken otomatik gitti)", target: "0", den: (r) => r.expect.autoSend === "no", num: (r) => r.auto === true },
  { label: "🚨 YANLIŞ SUSTURMA (gerçek soru/istek susturuldu)", target: "0", den: (r) => r.expect.silent !== true, num: muted },
  { label: "kapanış: sessiz kaldı", den: (r) => r.expect.silent === true, num: muted },
  { label: "kapanış: gereksiz OTOMATİK cevap", den: (r) => r.expect.silent === true, num: (r) => r.auto === true },
  { label: "kapanış: gereksiz taslak (ev sahibine)", den: (r) => r.expect.silent === true, num: (r) => r.silent === null && r.auto === false },
  { label: "🚨 BEKLEME SÖZÜ misafire giden", target: "0", den: (r) => r.auto === true, num: (r) => r.promise === true },
  { label: "bekleme sözü model üretti (kapı tuttu)", den: (r) => r.modelRan, num: (r) => r.promise === true },
  { label: "netleştirme: çözülebilir mesajda soru soruldu", target: "≈0", den: (r) => r.modelRan && r.expect.clarify === "none", num: (r) => (r.questions?.length ?? 0) > 0 },
  { label: "🚨 GENEL netleştirme (tüm cevaplar)", target: "0", den: (r) => r.modelRan, num: (r) => r.generic === true },
  { label: "belirsiz mesajda TEK hedefli soru", den: (r) => r.modelRan && r.expect.clarify === "one", num: (r) => r.questions?.length === 1 && r.generic !== true },
  { label: "konaklama türü: cevap modelinin beyanı doğru", den: (r) => r.modelRan && r.expect.stayKind !== undefined, num: (r) => r.asked === r.expect.stayKind },
  { label: "konaklama türü: anlama katmanı doğru", den: (r) => r.modelRan && r.expect.stayKind !== undefined && r.uKind != null, num: (r) => r.uKind === r.expect.stayKind },
  { label: "🚨 çıkış saati: yolculuk saati çıkış diye kaydedildi", target: "0", den: (r) => r.modelRan && r.expect.statedCheckoutTime === null, num: (r) => r.stated != null },
  { label: "çıkış saati: doğru kayıt (düzeltme dahil)", den: (r) => r.modelRan && typeof r.expect.statedCheckoutTime === "string", num: (r) => r.stated === normHhmm(r.expect.statedCheckoutTime) },
  { label: "ev sahibindeki konu: karar/izin/söz YOK", den: (r) => r.modelRan && r.cls === "pending_followup", num: (r) => r.promise !== true && r.stance !== "grants" },
  { label: "selam tekrarı (önceki cevaptan sonra)", target: "0", den: (r) => r.modelRan && r.greet != null, num: (r) => r.greet === true },
  { label: "anlama katmanı düştü (satır geçersiz sayılır)", target: "0", den: (r) => r.modelRan, num: (r) => r.uStatus === "failed" },
];

/**
 * Satır ölçüme GEÇERSİZ mi: cevap modeli yedeğe düştü / hata, ya da anlama katmanı düştü (açık kolun tarih satırı
 * etkisi o satırda ölçülemez — sessizce "kapalı" gibi okunmasın).
 */
export const invalidRow = (r: CusRow): boolean => !r.ok || r.uStatus === "failed";

function ratio(n: number, d: number): string {
  return d === 0 ? "—" : `${n}/${d} (${Math.round((100 * n) / d)}%)`;
}

/** Bir kolun ölçüsü (yalnız cevap modeli geçerli satırlar; anlama düşüşü kendi satırında sayılır). */
export function metricValue(m: Metric, rows: readonly CusRow[]): string {
  const den = rows.filter((r) => r.ok).filter(m.den);
  return ratio(den.filter(m.num).length, den.length);
}

/** Eşleştirilmiş özet tablosu (kollar yan yana). */
export function pairedSummary(rows: readonly CusRow[]): string[] {
  const off = rows.filter((r) => r.arm === "off");
  const on = rows.filter((r) => r.arm === "on");
  const lines = ["| ölçü | hedef | bayrak KAPALI | bayrak AÇIK |", "|---|---|---|---|"];
  for (const m of CUS_METRICS) lines.push(`| ${m.label} | ${m.target ?? ""} | ${metricValue(m, off)} | ${metricValue(m, on)} |`);
  const failed = (xs: readonly CusRow[]) => ratio(xs.filter((r) => !r.ok).length, xs.length);
  lines.push(`| cevap modeli yedeğe düştü / hata | 0 | ${failed(off)} | ${failed(on)} |`);
  return lines;
}

/** Kollar arasında davranışı değişen senaryolar (kapanış, gönderim, tür, saat, soru sayısı, söz, selam). */
export function armDiffs(rows: readonly CusRow[]): string[] {
  const byId = new Map<string, Partial<Record<Arm, CusRow>>>();
  for (const r of rows) byId.set(r.id, { ...byId.get(r.id), [r.arm]: r });
  const key = (r?: CusRow) =>
    r
      ? [r.silent ?? "-", r.auto ?? "-", r.asked ?? "-", r.uKind ?? "-", r.stated ?? "-", r.questions?.length ?? "-", r.promise ?? "-", r.greet ?? "-"].join("|")
      : "yok";
  const out: string[] = [];
  for (const [id, p] of byId) {
    if (key(p.off) === key(p.on)) continue;
    out.push(`- \`${id}\` (${p.off?.cls ?? p.on?.cls}) KAPALI [${key(p.off)}] → AÇIK [${key(p.on)}]`);
  }
  return out;
}

export interface ReportMeta {
  model: string;
  commit: string;
  runDay: string;
  /** Örnek sınırı (kısmi koşu); yoksa tam koşu. */
  limit?: number | null;
}

/**
 * Satırın TÜREV alanlarını ham cevaptan ve GÜNCEL veri setinden yeniden hesaplar (puanlama düzeltmesi ücretli koşuyu
 * tekrarlatmasın). Ham alanlar (cevap, kapı, beyan, anlama türü, kayıtlı saat, sessizlik) DEĞİŞMEZ.
 */
export function rescoreRow(row: CusRow, scenario: CusScenario | undefined): CusRow {
  if (!scenario) return row;
  const withExpect = { ...row, expect: scenario.expect };
  if (!row.modelRan || row.reply === undefined) return withExpect;
  return scoreReply(withExpect, row.reply, !isFirstOperatorReply(threadOf(scenario)));
}

export function writeReport(data: CusDataset, rows: CusRow[], meta: ReportMeta, dir: string, name: string, note?: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const failed = rows.filter(invalidRow).length;
  const status =
    failed > rows.length * 0.02 ? `GEÇERSİZ — ${failed} satır düştü (cevap modeli ya da anlama katmanı)` : failed > 0 ? `GEÇERLİ (${failed} düşüş raporda)` : "GEÇERLİ";
  const questions = rows.filter((r) => (r.questions?.length ?? 0) > 0);
  const lines = [
    `# Konuşma Anlama Durumu eval'i — ${meta.model} (${stamp})`,
    "",
    `Durum: **${status}** · commit \`${meta.commit}\` · veri sürümü ${data.version} · senaryo ${new Set(rows.map((r) => r.id)).size} × 2 kol` +
      (meta.limit ? ` · örnek sınırı ${meta.limit}` : ""),
    `Yapılandırma: anlama katmanı AÇIK · bekçi KOŞMAZ (kapanış birebir, sızıntı temkinli — \`conversation-state-harness.ts\` başı) · ` +
      `eylem beyanı KAPALI · gün ${meta.runDay} (${CUS_TZ}, varsayılan yerel saat ${DEFAULT_LOCAL_TIME})`,
    ...(note ? ["", note] : []),
    "",
    ...pairedSummary(rows),
    "",
    "Sınıf bazında (otomatik gönderim · sessiz):",
    "",
    "| sınıf | KAPALI otomatik | KAPALI sessiz | AÇIK otomatik | AÇIK sessiz |",
    "|---|---|---|---|---|",
    ...CUS_CLASSES.filter((c) => rows.some((r) => r.cls === c)).map((c) => {
      const cell = (arm: Arm) => {
        const rs = rows.filter((r) => r.ok && r.cls === c && r.arm === arm);
        return `${ratio(rs.filter((r) => r.auto).length, rs.length)} | ${ratio(rs.filter(muted).length, rs.length)}`;
      };
      return `| ${c} | ${cell("off")} | ${cell("on")} |`;
    }),
    "",
    "## Kollar arasında değişen senaryolar",
    "",
    "Alanlar: sessiz | otomatik | beyan | anlama türü | kayıtlı çıkış | soru sayısı | söz | selam",
    "",
    ...(armDiffs(rows).length > 0 ? armDiffs(rows) : ["(yok)"]),
    "",
    "## Soru soran cevaplar (insan okur)",
    "",
    ...questions.map(
      (r) => `- \`${r.id}\` [${r.arm}] (${r.cls}${r.expect.clarify ? `, beklenen ${r.expect.clarify}` : ""})${r.generic ? " GENEL" : ""}: ${JSON.stringify(r.questions)}`,
    ),
    "",
    "## Bekleme sözü, yanlış susturma, sızıntı (satır satır)",
    "",
    ...rows
      .filter((r) => r.ok && (r.promise || (muted(r) && r.expect.silent !== true) || (r.expect.autoSend === "no" && r.auto)))
      .map((r) => `- \`${r.id}\` [${r.arm}] (${r.cls}) sessiz=${r.silent} otomatik=${r.auto} söz=${r.promise} — ${JSON.stringify(r.reply?.slice(0, 240) ?? null)}`),
    "",
    "## Düşen satırlar",
    "",
    ...rows.filter(invalidRow).map((r) => `- \`${r.id}\` [${r.arm}] source=${r.source ?? "-"} anlama=${r.uStatus ?? "-"} ${r.error ?? ""}`),
  ];
  writeFileSync(path.join(dir, name), lines.join("\n"), "utf8");
  writeSidecar(dir, name, { suite: "conversation-state", version: data.version, meta: { ...meta, status, note: note ?? null }, rows });
}
