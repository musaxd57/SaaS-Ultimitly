import "server-only";

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { qrEscalationEmail } from "@/lib/email-templates";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { reportError } from "@/lib/report-error";
import { rateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// QR concierge escalation e-mail (Codex #15 + hardening round).
//
// When the public QR chat escalates ("mesajınızı ev sahibine ilettim"), that
// promise is only real if the host actually finds out — this mails the host a
// MINIMAL alert: no guest text, no name, no codes — plain reason + panel link.
//
// Safety posture:
//   * ENV-GATED, default OFF (QR_ESCALATION_EMAIL_ENABLED=1) — no existing
//     customer gets a surprise e-mail from a deploy.
//   * DEDUPE IS BOUND TO THE EVENT (the triggering inbound Message id), not a
//     long window: the SAME event can never double-mail (retries/races lose
//     the conditional updateMany), while a genuinely NEW incident — e.g. a
//     safety emergency hours after a complaint — ALWAYS alerts. A short
//     anti-flood cooldown (minutes) is the only time component, so a hostile
//     guest can't turn the host's inbox into a mail bomb via message spam.
//   * TENANT-BOUND claim: the updateMany matches the reservation ONLY through
//     the caller's organizationId — a cross-tenant id mix-up claims nothing
//     and sends nothing.
//   * NEVER throws / never blocks the chat: ANY failure after the claim
//     (template, recipient lookup, transport — expected or not) releases the
//     claim under an exact (messageId + claimedAt) guard and goes to
//     reportError — visible, and the next escalation retries.
//   * Recipient is PER-TENANT and ROLE-EXPLICIT: the org's own alertEmail,
//     else the org's oldest OWNER account (never an arbitrary oldest user,
//     never the env ALERT_EMAIL — that's the operator's address).
// ---------------------------------------------------------------------------

/** Anti-flood cooldown between DISTINCT alerted events of one stay. Applies to
 *  NON-CRITICAL events only (Codex acceptance): a safety/emergency event
 *  bypasses the clock entirely — a complaint at 14:00 must never mute a fire
 *  at 14:02. The critical path is flood-guarded by IDENTITY instead: its event
 *  id is a normalized CONTENT FINGERPRINT (qrEscalationEventId), so re-sending
 *  the same "acil!" text never re-mails, while a genuinely different emergency
 *  always does. Residual (documented): a hostile BOUND guest varying critical
 *  wording per message could generate one mail each — now capped per stay per
 *  hour (↓`QR_CRITICAL_EMAILS_PER_HOUR`, kurucu kararı 10-11) on top of the
 *  device binding and the per-IP limiter. */
export const QR_ESCALATION_COOLDOWN_MS = 5 * 60 * 1000;

/** KRİTİK (acil) e-posta tavanı: aynı konaklamadan saatte en çok bu kadar (kurucu kararı 10-11, karar listesi 17). Yukarıdaki
 *  "kalan risk" tam olarak buydu: bağlı cihazdaki kötü niyetli misafir her mesajda acil ifadesini değiştirerek her seferinde e-posta
 *  ürettirebiliyordu ("yangın / acil 2 / acil 3"). Misafire giden cevap DEĞİŞMEZ; olaylar konuşmada ve karar kaydında kalır. */
export const QR_CRITICAL_EMAILS_PER_HOUR = 3;

/** İPTAL EDİLMİŞ konaklamada (kurucu 10-12) kaydedilen QR mesajı tavanı — saatte; kötü niyetli yazışma paneli dolduramasın. */
export const CANCELLED_STAY_MESSAGES_PER_HOUR = 10;
/** İptal edilmiş konaklama uyarısının en sık aralığı: aynı konaklamadan bu süre içinde ikinci e-posta yok (olay kimliği dilime bağlı). */
export const CANCELLED_STAY_ALERT_WINDOW_MS = 6 * 60 * 60 * 1000;

const criticalMailKey = (reservationId: string) => `qr-crit-mail:${reservationId}`;

/** Ayrılan acil e-posta hakkını GERİ VER (e-posta gitmedi: alıcı yok / sağlayıcı hatası / beklenmeyen hata). En iyi çaba. */
async function returnCriticalMailSlot(reservationId: string): Promise<void> {
  await prisma.rateLimitCounter
    .updateMany({ where: { key: criticalMailKey(reservationId), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
    .catch(() => {});
}

/** Max time the guest's HTTP response waits on the alert path. The send keeps
 *  running detached past this (its own claim/error handling completes either
 *  way) — a slow Resend/SMTP outage must not hold the guest's "ilettim" reply
 *  hostage for its 12-15s transport timeout (diff-review finding). */
export const QR_ALERT_RESPONSE_BUDGET_MS = 2500;

/**
 * The dedupe identity of an escalated exchange. Non-critical: the inbound
 * Message id (every distinct message may alert, cooldown throttles floods).
 * CRITICAL: a normalized content fingerprint — same emergency text repeated
 * (spam or retry) collapses to ONE identity, different emergencies stay
 * distinct and always alert.
 */
export function qrEscalationEventId(inboundMessageId: string, guestText: string, critical: boolean): string {
  if (!critical) return inboundMessageId;
  // Mark-stripping fold: JS lowercases Turkish "İ" to "i"+U+0307 (combining
  // dot), so a naive lowercase splits "ACİL" vs "acil" into two fingerprints.
  // NFKD + \p{M} removal folds that (and ş/ğ/ü accents), making the
  // fingerprint robust to case/diacritic/punctuation noise.
  const normalized = guestText
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return `crit:${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`;
}

// ⚠️ `daily_budget_qr` AYRI bir sebep (08-05): QR artık org bütçesinin yalnız
// REZERVE EDİLMİŞ payını tüketiyor. O pay dolduğunda org'un GENEL AI hakkı
// büyük ihtimalle HÂLÂ DOLU — eski `daily_budget` metnini kullanmak host'a
// yanlış beyan olurdu ("hakkınız doldu" derken dolmamış).
// `stay_message_cap` (kurucu kararı 10-11): konaklamanın saatlik mesaj tavanı aşıldı — fazlası kaydedilmedi; saatte tek uyarı.
// `emergency_number` (kurucu kararları 10-11): misafir acil servis numarası sordu, yapay zekâ YALNIZ numarayı gönderdi — "yanıtlamadı"
// demek yanlış beyan olurdu (Haiku 10-11).
export type QrEscalationReason =
  | "ai_escalated"
  | "daily_cap"
  | "daily_budget"
  | "daily_budget_qr"
  | "stay_message_cap"
  | "emergency_number"
  | "cancelled_stay";

export function qrEscalationEmailEnabled(): boolean {
  return process.env.QR_ESCALATION_EMAIL_ENABLED === "1";
}

/**
 * Send the host ONE e-mail per escalated QR-chat EVENT (identity = the inbound
 * Message id). Fire-safe: never throws, never affects the chat response.
 */
export async function maybeSendQrEscalationEmail(args: {
  organizationId: string;
  propertyName: string;
  reservationId: string;
  /** Dedupe identity of this escalation — build with qrEscalationEventId()
   *  (message id for normal events, content fingerprint for critical ones). */
  eventId: string;
  reason: QrEscalationReason;
  /** True for a deterministic safety/emergency verdict — bypasses the
   *  anti-flood cooldown (identity dedupe still applies). */
  critical?: boolean;
}): Promise<{ sent: boolean; deduped?: boolean; capped?: boolean }> {
  try {
    if (!qrEscalationEmailEnabled()) return { sent: false };
    if (!args.eventId) return { sent: false }; // no identity → no claim, no mail

    // ATOMIC claim, bound to (tenant, event): whoever flips the row owns the
    // send. Conditions: the reservation must belong to the caller's org, this
    // exact event must not have been alerted already, and the short anti-flood
    // cooldown must have passed. (Explicit null-branches: Prisma's `not`
    // filter on a nullable column would silently exclude NULL rows.)
    const claimedAt = new Date();
    const cooledBefore = new Date(claimedAt.getTime() - QR_ESCALATION_COOLDOWN_MS);
    const claimed = await prisma.reservation.updateMany({
      where: {
        id: args.reservationId,
        property: { organizationId: args.organizationId }, // tenant bind
        AND: [
          {
            OR: [
              { qrEscalationEmailMessageId: null },
              { qrEscalationEmailMessageId: { not: args.eventId } }, // same event never re-mails
            ],
          },
          // Anti-flood clock — SKIPPED for a critical (safety/emergency) event:
          // a distinct emergency must alert even seconds after a prior mail.
          ...(args.critical
            ? []
            : [{ OR: [{ qrEscalationEmailAt: null }, { qrEscalationEmailAt: { lt: cooledBefore } }] }]),
        ],
      },
      data: { qrEscalationEmailAt: claimedAt, qrEscalationEmailMessageId: args.eventId },
    });
    if (claimed.count !== 1) return { sent: false, deduped: true };

    // Release ONLY our own claim (exact event + exact timestamp guard) so a
    // newer claim can never be clobbered. Best-effort by design.
    const releaseClaim = () =>
      prisma.reservation
        .updateMany({
          where: {
            id: args.reservationId,
            qrEscalationEmailMessageId: args.eventId,
            qrEscalationEmailAt: claimedAt,
          },
          data: { qrEscalationEmailAt: null, qrEscalationEmailMessageId: null },
        })
        .catch(() => {});

    // EVERYTHING after the claim is guarded: an unexpected exception must not
    // leave the claim consumed with no mail sent (Codex hardening item 3).
    let slotHeld = false;
    const giveBack = () => (slotHeld ? returnCriticalMailSlot(args.reservationId) : Promise.resolve());
    try {
      // Kritik tavan (↑`QR_CRITICAL_EMAILS_PER_HOUR`): SAHİPLENMEDEN SONRA hak AYRILIR (aynı acil metnin tekrarı sahiplenmede elenir,
      // hak yemez). Ayırma atomik (eşzamanlı acil mesajlar tavanı aşamaz — Haiku incelemesi 10-11); e-posta GİTMEZSE hak geri verilir
      // (sağlayıcı hatası / alıcı yokluğu gerçek bir dördüncü acili susturmasın). Tavanda sahiplenme bırakılır — kayıt "gönderildi" demesin.
      if (args.critical) {
        const slot = await rateLimit(criticalMailKey(args.reservationId), QR_CRITICAL_EMAILS_PER_HOUR, 60 * 60_000);
        if (!slot.ok) {
          await releaseClaim();
          return { sent: false, capped: true };
        }
        slotHeld = true;
      }
      // Per-tenant recipient: org alertEmail → the org's oldest OWNER account.
      // Role-explicit (Codex item 2): "oldest user" could be a staff member.
      const org = await prisma.organization.findUnique({
        where: { id: args.organizationId },
        select: {
          alertEmail: true,
          users: {
            where: { role: "owner" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { email: true },
          },
        },
      });
      const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim();
      if (!to) {
        // No one to mail — release so a recipient configured later still gets
        // alerted about a NEW incident (not a stale suppressed claim).
        await giveBack();
        await releaseClaim();
        return { sent: false };
      }

      const html = qrEscalationEmail(args.propertyName, args.reason, `${appBaseUrl()}/guest-chats`);
      const result = await emailService.sendReporting(
        to,
        `⚠️ Misafir sohbetinde size devredilen mesaj — ${args.propertyName}`,
        html,
      );
      if (!result.ok) {
        // VISIBLE failure + claim release so the next escalation retries
        // instead of silently losing the alert.
        await giveBack();
        await releaseClaim();
        await reportError(
          `qr-escalation-email (org ${args.organizationId})`,
          new Error(result.error ?? "unknown email failure"),
        ).catch(() => {});
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      await giveBack();
      await releaseClaim();
      throw err; // outer catch reports it
    }
  } catch (err) {
    // The chat's delivery semantics must never depend on the alert path.
    await reportError(`qr-escalation-email (org ${args.organizationId})`, err).catch(() => {});
    return { sent: false };
  }
}

/**
 * Route-facing wrapper: same alert, but the caller's await is BOUNDED by
 * QR_ALERT_RESPONSE_BUDGET_MS. The underlying send continues detached (it
 * never throws and settles its own claim), so a slow e-mail provider delays
 * the guest's reply by at most the budget instead of the transport timeout.
 */
export function sendQrEscalationAlertBounded(
  args: Parameters<typeof maybeSendQrEscalationEmail>[0],
): Promise<void> {
  const pending = maybeSendQrEscalationEmail(args); // never rejects
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, QR_ALERT_RESPONSE_BUDGET_MS);
    void pending.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
