import { NO_NOTIFY_KINDS, STAY_CHANGE_ITEM_KINDS } from "@/lib/conversation-items/core";
import { QUOTE_MAX, templateSafe } from "./question-text";

// ---------------------------------------------------------------------------
// BİLDİRİM YÖNLENDİRİCİSİ — SAF (tasarım §3.1, §3.2, §7). Yeni bir tutma kararı YAZMAZ: bugün e-posta gönderen noktalar aynı kalır, bu modül
// yalnız "bu durum ev sahibine hangi tür soru olur" ve "hangi kanaldan" kararını verir. Sağlayıcı bilmez (V0).
//
//   · Tür A (`info`)     — tutulan tur / cevapsız güvenli öğe / konusuz yönlendirme / kalan açık ihtiyaç / öğesiz K10 tutuşu → bilgi sorusu.
//   · Tür B (`decision`) — açılan karar kartı → düğmeli karar sorusu (dilim 3).
//   · Tür C (`urgent`)   — hassas / acil öğe, tehlike + anlama yok → acil bildirim (dilim 4; cevap KURULMAZ).
//   · Konaklama değişikliği ve para / iade öğeleri ASLA bilgi sorusu olmaz (karar kartı ya da panel) → bugünkü e-posta.
//   · Yalnız sessiz türler (`NO_NOTIFY_KINDS`, "bunu nereden biliyorsun") → hiçbir bildirim.
// Kanal: anahtar + işletme listesi + DOĞRULANMIŞ numara + türün kendi anahtarı + işletme saatlik tavanı; biri eksikse bugünkü e-posta.
// ---------------------------------------------------------------------------

/** Bugünkü bildirim noktaları (automation.ts / flow.ts) — yönlendiriciye yalnız NEDEN gelir. */
export type HostAskTrigger =
  | "handoff_held"
  | "parts_unanswered"
  | "host_contact_notify"
  | "stale_open"
  | "k10_hold"
  | "decision_card"
  | "held_sensitive"
  | "hazard";

export type HostAskKind = "info" | "decision" | "urgent" | "email_only" | "silent";

/** Para / iade / ödeme yöntemi ve ev sahibi isteği, şikâyet, acil: cevap kurulmaz (Tür C ya da panel). */
const NOT_INFO_KINDS: ReadonlySet<string> = new Set(["payment_invoice", "cancellation_refund", "complaint_issue", "emergency", "human_request"]);

export function hostAskKindOf(trigger: HostAskTrigger, itemKinds: readonly string[] = []): HostAskKind {
  if (trigger === "decision_card") return "decision";
  if (trigger === "held_sensitive" || trigger === "hazard") return "urgent";
  const notifying = itemKinds.filter((k) => !NO_NOTIFY_KINDS.has(k));
  if (itemKinds.length > 0 && notifying.length === 0) return "silent";
  if (notifying.some((k) => STAY_CHANGE_ITEM_KINDS.has(k as never) || NOT_INFO_KINDS.has(k))) return "email_only";
  return "info";
}

export interface HostChannelFlags {
  channel: boolean;
  questions: boolean;
  decisions: boolean;
  alerts: boolean;
  /** `*` = bütün işletmeler; boş = hiçbiri (DURABLE_OUTBOX_ORG_IDS deseni). */
  orgIds: "*" | ReadonlySet<string>;
}

/** Bayraklar yalnız "1" ile açılır (`STRICT_ONE_FLAGS`); liste boşsa hiçbir işletme. */
export function hostChannelFlagsFromEnv(env: Record<string, string | undefined> = process.env): HostChannelFlags {
  const raw = (env.HOST_CHANNEL_ORG_IDS ?? "").trim();
  return {
    channel: env.HOST_CHANNEL_ENABLED === "1",
    questions: env.HOST_QUESTIONS_ENABLED === "1",
    decisions: env.HOST_QUESTION_DECISIONS_ENABLED === "1",
    alerts: env.HOST_QUESTION_ALERTS_ENABLED === "1",
    orgIds: raw === "*" ? "*" : new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)),
  };
}

/** İşletme başına saatte en çok bu kadar WhatsApp sorusu; aşılırsa e-postaya düşer (tasarım §3.2). */
export const ORG_HOURLY_QUESTION_CAP = 30;

export type HostBindingStatus = "verified" | "pending" | "revoked";

export function chooseHostChannel(input: {
  kind: HostAskKind;
  orgId: string;
  flags: HostChannelFlags;
  /** Ev sahibinin numara bağlantısı; yoksa `null`. */
  binding: HostBindingStatus | null;
  /** Bu işletmeye son bir saatte giden WhatsApp sorusu. */
  orgSentLastHour: number;
}): "whatsapp" | "email" | "none" {
  const { kind, flags } = input;
  if (kind === "silent") return "none";
  if (kind === "email_only") return "email";
  if (!flags.channel || input.binding !== "verified") return "email";
  if (flags.orgIds !== "*" && !flags.orgIds.has(input.orgId)) return "email";
  const kindOn = kind === "info" ? flags.questions : kind === "decision" ? flags.decisions : flags.alerts;
  if (!kindOn) return "email";
  if (input.orgSentLastHour >= ORG_HOURLY_QUESTION_CAP) return "email";
  return "whatsapp";
}

/**
 * Aynı turda birden çok açık soru → TEK mesaj, numaralı liste ("1) bebek yatağı var mı? 2) otopark?") — şablonun tek alıntı değişkenine sığar
 * (en çok `QUOTE_MAX`). Sığmayan soru sayıyla belirtilir ("+1 soru daha") — ev sahibi panelde hepsini görür. Alıntılar zaten maskeli gelir.
 */
export function combinedQuote(quotes: readonly string[]): string {
  const items = quotes.map((q) => templateSafe(q)).filter(Boolean);
  if (items.length <= 1) return items[0] ?? "";
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const left = items.length - i - 1;
    // Sonra eklenebilecek "+N soru daha" için yer AYRILIR: bir önceki adımda kabul edilen metin ona her zaman yer bırakır.
    const reserve = left > 0 ? ` +${left} soru daha`.length : 0;
    const piece = `${out ? " " : ""}${i + 1}) ${items[i]}`;
    if (out.length + piece.length + reserve <= QUOTE_MAX) {
      out += piece;
      continue;
    }
    if (out) return `${out} +${left + 1} soru daha`;
    // İlk soru tek başına sığmıyor: sözcük sınırında kısaltılır.
    const room = QUOTE_MAX - "1) ".length - reserve - 1;
    const cut = items[0].slice(0, room);
    const space = cut.lastIndexOf(" ");
    out = `1) ${(space > room / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return out;
}
