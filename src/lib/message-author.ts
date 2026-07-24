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

export const AUTHOR_TYPES = ["guest", "ai", "host", "system"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

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
