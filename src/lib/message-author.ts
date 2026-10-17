// ---------------------------------------------------------------------------
// Message authorship — RELIABLE, typed classification (migration 28).
//
// `Message.authorType` is the CANONICAL signal for WHO authored a message and is
// the ONLY field any security/state decision may key off. `senderName` is a
// DISPLAY / AUDIT name only — a host-controlled string that must NEVER drive a
// decision (a host could set their name to a reserved marker). `systemEventType`
// names a closed system event when authorType = "system".
//
// The columns are nullable (additive migration on a populated table + old-code
// INSERT compat during a rolling deploy). New code DUAL-WRITES authorType on every
// insert; readers PREFER it and fall back to `deriveMessageAuthor` for any NULL row
// (transition-safe). The migration backfills every existing row from the same rule.
//
// ROLLING-DEPLOY OVERLAP (Faz-A ⇒ Faz-B): while the OLD deployment is briefly still
// live after the migration applied, it can INSERT new rows with authorType = NULL.
// This is safe by design:
//   • reads stay correct via the `deriveMessageAuthor` fallback (PERMANENT in Faz-A —
//     never removed here);
//   • HEALING is the migration's own backfill UPDATEs, which are guarded by
//     `authorType IS NULL` → idempotent and re-runnable as a one-off ops step; they
//     never scan on a hot 2-minute loop and never overwrite a value new code wrote.
// Faz-B (making authorType NOT NULL / dropping the fallback) is a SEPARATE, future
// migration and MUST NOT ship until production reconciliation
// (`SELECT count(*) FROM "Message" WHERE "authorType" IS NULL`) is 0 — the same
// gate the money migration used.
// ---------------------------------------------------------------------------

export const AUTHOR_TYPES = ["guest", "ai", "host", "system", "automation"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

// ---------------------------------------------------------------------------
// OTOMATİK ŞABLON MESAJI (K7, migration 58, kurucu onayı 09-30): karşılama / giriş / çıkış mesajlarımız senkronla geri
// gelince `authorType: "automation"` yazılır (`automated-sends.ts` izinden). Misafire GİTTİ ama bir CEVAP DEĞİLDİR:
// konuşmayı "cevaplandı" yapmaz, cevapsız misafir penceresini (güvenlik penceresi dâhil) sıfırlamaz, tutulan öğeyi
// kapatmaz, ardından gelen "Teşekkürler"i kapanış yapmaz; ev sahibinin sesi / üslubu da sayılmaz. İstem geçmişinde
// "[OTOMATİK MESAJ]" satırıdır. "Cevap mı" sorusu TEK kuraldan: `isAnsweringOutbound` (bellekte) ve
// `notAutomationMessageWhere()` (sorguda). Selam kuralı (`countPriorOperatorReplies`) bilerek SAYAR: misafir o selamı gördü.
// ---------------------------------------------------------------------------
export const AUTOMATION_AUTHOR = "automation" as const;

/** Bizim otomatik şablon mesajımız mı (karşılama / giriş / çıkış). */
export function isAutomationMessage(m: { authorType?: string | null; author?: string | null }): boolean {
  return m.authorType === AUTOMATION_AUTHOR || m.author === AUTOMATION_AUTHOR;
}

/**
 * Konuşmayı YANITLAYAN giden mesaj mı: giden VE otomatik şablon mesajı değil. "Son cevaptan sonraki misafir mesajları",
 * "cevaplandı mı", kapanış ve rapor cevap oranı bununla. Girdi yazar alanı (`authorType`) ya da istem geçmişinin `author`ı
 * taşıyabilir; ikisi de yoksa eski davranış (her giden mesaj cevaptır).
 */
export function isAnsweringOutbound(m: { direction: string; authorType?: string | null; author?: string | null }): boolean {
  return m.direction !== "inbound" && !isAutomationMessage(m);
}

/** Prisma: otomatik şablon mesajı OLMAYAN satırlar — NULL yazarlı eski satırlar DAHİL (`{ not: … }` NULL'u dışlardı). */
export function notAutomationMessageWhere(): { OR: ({ authorType: null } | { authorType: { not: string } })[] } {
  return { OR: [{ authorType: null }, { authorType: { not: AUTOMATION_AUTHOR } }] };
}

// ---------------------------------------------------------------------------
// KANALIN BİLDİRDİĞİ GÖNDEREN ROLÜ (L5, migration 71, kurucu 10-17: "sağlayıcı otomasyonu ile ev sahibinin mesajını ayır; Airbnb Direct'te
// rol kanal katmanında"). `Message.channelSenderRole` kapalı kümesi. 1. FAZ: yalnız ÖĞRENME / ÜSLUP / ÖNERİ girdisi — kanalın kendi otomatik
// mesajı (sağlayıcı şablonu, zamanlanmış mesaj, sağlayıcı yapay zekâsı) "ev sahibinin sesi / bilgisi" sayılmaz. "Cevap mı" (`isAnsweringOutbound`,
// `notAutomationMessageWhere`) ve her güvenlik kararı BUNDAN TÜREMEZ — 2. faz kurucu kararı (Q2) bekliyor, pinli.
// YALNIZ KESİN OTOMASYON ayrılır: `unknown` (alan var, değer tanınmadı) bugünkü gibi ev sahibi sayılır — sağlayıcı alanları canlı hesapta
// doğrulanmadı; tanınmayan bir insan rolü ("user" gibi) "şüphede düş" kuralıyla bütün ev sahibi cevaplarını sessizce öğrenmeden ve üslup
// profilinden çıkarırdı (en değerli veri). Yanlış "unknown"ın bedeli bugünkü davranış; yanlış düşürmenin bedeli sessiz kayıp.
// ---------------------------------------------------------------------------
export const CHANNEL_SENDER_ROLES = ["guest", "host", "automation", "unknown"] as const;
export type ChannelSenderRole = (typeof CHANNEL_SENDER_ROLES)[number];
export const CHANNEL_AUTOMATION_ROLE = "automation" as const;

/**
 * Çekirdeğin yazdığı rol: kapalı küme dışı → "unknown"; YÖNLE çelişen rol (misafir mesajı ama rol ev sahibi / otomasyon, ya da giden mesaj
 * ama rol misafir) → "unknown" (tutarsız sağlayıcı satırı otomasyon diye ayrılmaz, misafir diye de okunmaz). Rol yoksa NULL.
 */
export function canonicalChannelSenderRole(direction: "inbound" | "outbound", role: unknown): ChannelSenderRole | null {
  if (role === null || role === undefined) return null;
  if (typeof role !== "string" || !(CHANNEL_SENDER_ROLES as readonly string[]).includes(role)) return "unknown";
  const r = role as ChannelSenderRole;
  if (direction === "inbound") return r === "guest" ? "guest" : "unknown";
  return r === "guest" ? "unknown" : r;
}

/** Kanalın KENDİ otomatik mesajı mı (sağlayıcı şablonu / zamanlanmış / sağlayıcı yapay zekâsı). Ev sahibi kanıtı DEĞİLDİR (1. faz). */
export function isChannelAutomation(m: { channelSenderRole?: string | null }): boolean {
  return m.channelSenderRole === CHANNEL_AUTOMATION_ROLE;
}

/** Prisma: kanal otomasyonu OLMAYAN satırlar — NULL rollü satırlar DAHİL (`{ not: … }` NULL'u dışlardı). */
export function notChannelAutomationWhere(): { OR: ({ channelSenderRole: null } | { channelSenderRole: { not: string } })[] } {
  return { OR: [{ channelSenderRole: null }, { channelSenderRole: { not: CHANNEL_AUTOMATION_ROLE } }] };
}

/** Closed set of system-event names (authorType = "system"). */
export const SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED = "guest_chat_ai_resumed";
export const SYSTEM_EVENT_TYPES = [SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED] as const;

// Legacy display senderNames that classified AI-sent messages BEFORE authorType.
// "GuestOps AI" is the Airbnb-channel classifier string (do NOT change at storage);
// "Lixus AI" is the QR bot's display name. Used for backfill + transitional fallback.
export const LEGACY_AI_SENDER_NAMES: readonly string[] = ["GuestOps AI", "Lixus AI"];

// Legacy QR resume-marker senderName (the pre-authorType representation). Recognized
// for backfill + transitional fallback ONLY; new resume events use authorType=system.
export const LEGACY_AI_RESUME_SENDER = "__lixus_ai_resumed__";

type AuthorInfo = { authorType: AuthorType; systemEventType: string | null };

/**
 * Derive the canonical author from the reliable EXISTING signals (direction +
 * senderName). Used to (a) backfill legacy rows in the migration and (b) fall back
 * for any row an older deployment wrote without authorType during the transition.
 * Deterministic; the migration SQL mirrors this exact rule.
 */
export function deriveMessageAuthor(m: { direction: string; senderName: string }): AuthorInfo {
  if (m.direction === "inbound") return { authorType: "guest", systemEventType: null };
  if (m.senderName === LEGACY_AI_RESUME_SENDER)
    return { authorType: "system", systemEventType: SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED };
  if (LEGACY_AI_SENDER_NAMES.includes(m.senderName)) return { authorType: "ai", systemEventType: null };
  return { authorType: "host", systemEventType: null };
}

type ClassifiableMessage = {
  direction: string;
  senderName: string;
  authorType?: string | null;
  systemEventType?: string | null;
};

/** authorType if present (preferred), else the legacy derivation (transition-safe). */
export function resolveMessageAuthor(m: ClassifiableMessage): AuthorInfo {
  if (m.authorType) return { authorType: m.authorType as AuthorType, systemEventType: m.systemEventType ?? null };
  return deriveMessageAuthor(m);
}

/**
 * Modele giden geçmiş satırının YAZARI (F14, 09-26): güvenilir yazar alanından (görünen ad DEĞİL). Sistem olayı geçmişe
 * yazar olarak girmez → undefined (satır yön etiketine düşer). QR penceresi sistem olayını sorguda dışarıda bırakır; kanal ve gelen
 * kutusu geçmişinde (nadir) sistem satırı yazarsız kalır ve `isAnsweringOutbound` için giden mesaj sayılır (Haiku 10-12: eski yorum
 * "pencereler dışarıda bırakır" diyordu, yalnız QR için doğruydu).
 */
export function historyAuthorOf(m: ClassifiableMessage): "guest" | "host" | "ai" | "automation" | undefined {
  const { authorType } = resolveMessageAuthor(m);
  return authorType === "guest" || authorType === "host" || authorType === "ai" || authorType === AUTOMATION_AUTHOR
    ? authorType
    : undefined;
}

/**
 * Guest-chat display role for one message. Keys off the RELIABLE author, never the
 * message text: guest / ai / host bubbles, or a "resume" system separator (the AI
 * being re-enabled). A technical system marker is NEVER a normal chat bubble.
 */
export function guestChatDisplayRole(m: ClassifiableMessage): "guest" | "ai" | "host" | "resume" {
  const { authorType, systemEventType } = resolveMessageAuthor(m);
  if (authorType === "guest") return "guest";
  if (authorType === "ai") return "ai";
  if (authorType === "system")
    return systemEventType === SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED ? "resume" : "ai";
  return "host";
}
