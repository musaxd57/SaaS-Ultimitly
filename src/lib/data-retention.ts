import { subMonths, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// KVKK / data-retention + erasure.
//
//  * anonymizeOldGuestData — automatic retention sweep. OFF by default; only does
//    work when DATA_RETENTION_MONTHS is set (>0). Once a guest's stay is older than
//    that window, their PERSONAL data (name/phone/email + the guest's own message
//    bodies + the guest-identifier on the thread) is irreversibly scrubbed. We
//    ANONYMIZE rather than hard-delete so occupancy/report history stays intact
//    while the personal data is gone. Batched → the cron chips away, no long lock.
//
//  * deleteAccountData — full account erasure (the host's "delete my account" /
//    KVKK right-to-erasure). Deleting the Organization cascades to users,
//    properties → reservations/conversations/messages/tasks/KB/templates/calendar,
//    automation rules, audit logs, subscription, invoices (all onDelete: Cascade).
//    ChatUsage has no FK relation, so it's cleared explicitly first.
// ---------------------------------------------------------------------------

// Exported so the sync engine can DETECT an already-anonymized row and refuse to
// overwrite the sentinel with fresh channel PII (KVKK resurrection guard).
export const ANON_NAME = "Eski misafir";
export const ANON_ID = "Misafir";
const ANON_BODY = "[saklama süresi doldu — içerik silindi]";
const ANON_BODY_NAME = "[Misafir]"; // in-body name redaction — keeps the host's record, drops the name
const MIN_NAME_LEN = 3; // skip 2-char names ("Al"/"Su") — too collision-prone

/**
 * Redact a guest's known name(s) from an OUTBOUND body — the host's own record is
 * kept, only the identifying token is removed. Automated greetings use only the
 * FIRST name ("Merhaba Ahmet,"); manual host replies may use the full name, so
 * redact both (longest first). Boundaries are Unicode-aware (JS \b is ASCII-only
 * and breaks on Turkish ç/ğ/ı/ö/ş/ü). Insertion is literal; idempotent.
 */
function redactNameFromBody(body: string, names: string[]): string {
  const tokens = Array.from(
    new Set(names.flatMap((n) => { const full = n.trim(); return [full, full.split(/\s+/)[0] ?? ""]; })),
  )
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_NAME_LEN && t !== ANON_NAME && t !== ANON_ID)
    .sort((a, b) => b.length - a.length);
  let out = body;
  for (const t of tokens) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), ANON_BODY_NAME);
  }
  return out;
}

/** How many old reservations to scrub per call — bounds work / lock time. */
const RETENTION_BATCH = 300;

/**
 * Anonymize guest personal data for stays that ended before the retention window.
 * No-op unless DATA_RETENTION_MONTHS is a positive number. Returns how many
 * reservations were scrubbed (0 when disabled or nothing is due).
 */
export async function anonymizeOldGuestData(now: Date = new Date()): Promise<{ anonymized: number }> {
  const months = Number(process.env.DATA_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return { anonymized: 0 }; // disabled by default
  const cutoff = subMonths(startOfDay(now), months);

  let anonymized = 0;

  // (1) Reservation-linked guest data. Reservations whose stay ended before the
  // cutoff and still carry real PII (guestName not yet anonymized). Bounded batch.
  const oldRes = await prisma.reservation.findMany({
    where: { departureDate: { lt: cutoff }, guestName: { not: ANON_NAME } },
    select: { id: true, guestName: true },
    take: RETENTION_BATCH,
  });
  if (oldRes.length > 0) {
    const resIds = oldRes.map((r) => r.id);
    const resNameById = new Map(oldRes.map((r) => [r.id, r.guestName]));
    const convs = await prisma.conversation.findMany({
      where: { reservationId: { in: resIds } },
      select: { id: true, reservationId: true, guestIdentifier: true },
    });
    const convIds = convs.map((c) => c.id);

    // Outbound (host/AI) bodies are the host's own record → KEPT, but the guest's
    // NAME is scrubbed out of them. Names are captured HERE, before the same
    // transaction overwrites reservation.guestName / conversation.guestIdentifier.
    const namesByConv = new Map<string, string[]>();
    for (const c of convs) {
      namesByConv.set(
        c.id,
        [c.reservationId ? resNameById.get(c.reservationId) ?? null : null, c.guestIdentifier].filter(
          (n): n is string => Boolean(n),
        ),
      );
    }
    const outbound = convIds.length
      ? await prisma.message.findMany({
          where: { conversationId: { in: convIds }, direction: "outbound" },
          select: { id: true, conversationId: true, body: true },
        })
      : [];
    const bodyRedactions: { id: string; body: string }[] = [];
    for (const m of outbound) {
      const red = redactNameFromBody(m.body, namesByConv.get(m.conversationId) ?? []);
      if (red !== m.body) bodyRedactions.push({ id: m.id, body: red });
    }

    await prisma.$transaction([
      // The guest's OWN messages (inbound) carry their words/PII — scrub the body.
      ...(convIds.length
        ? [
            prisma.message.updateMany({
              where: { conversationId: { in: convIds }, direction: "inbound", body: { not: ANON_BODY } },
              data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
            }),
            prisma.conversation.updateMany({
              where: { id: { in: convIds } },
              data: { guestIdentifier: ANON_ID },
            }),
          ]
        : []),
      // Outbound bodies: keep the host's record, remove only the guest's name.
      ...bodyRedactions.map((r) => prisma.message.update({ where: { id: r.id }, data: { body: r.body } })),
      prisma.reservation.updateMany({
        where: { id: { in: resIds } },
        data: {
          guestName: ANON_NAME,
          guestPhone: null,
          guestEmail: null,
          guestExternalId: null,
          guestCheckoutTime: null,
          notes: null,
        },
      }),
    ]);
    anonymized += resIds.length;
  }

  // (2) Orphaned conversations with NO reservation link. These never reach the
  // reservation-driven sweep above, so their guest PII would otherwise live
  // FOREVER: manual/unmatched threads, or — critically — threads whose reservation
  // the host deleted (Conversation.reservation is onDelete: SetNull). Age them by
  // their own lastMessageAt so the privacy promise ("veriler saklama süresi
  // sonunda anonimleştirilir") actually holds for every thread, not just linked ones.
  const orphanConvs = await prisma.conversation.findMany({
    where: {
      reservationId: null,
      lastMessageAt: { lt: cutoff },
      guestIdentifier: { not: ANON_ID },
    },
    select: { id: true, guestIdentifier: true },
    take: RETENTION_BATCH,
  });
  if (orphanConvs.length > 0) {
    const orphanIds = orphanConvs.map((c) => c.id);
    // Redact the guest name from OUTBOUND bodies too (host record kept). For an
    // orphan the guestIdentifier is the ONLY name source (no reservation row).
    const nameByConv = new Map(orphanConvs.map((c) => [c.id, c.guestIdentifier]));
    const outbound = await prisma.message.findMany({
      where: { conversationId: { in: orphanIds }, direction: "outbound" },
      select: { id: true, conversationId: true, body: true },
    });
    const bodyRedactions: { id: string; body: string }[] = [];
    for (const m of outbound) {
      const name = nameByConv.get(m.conversationId);
      const red = name ? redactNameFromBody(m.body, [name]) : m.body;
      if (red !== m.body) bodyRedactions.push({ id: m.id, body: red });
    }
    await prisma.$transaction([
      prisma.message.updateMany({
        where: { conversationId: { in: orphanIds }, direction: "inbound", body: { not: ANON_BODY } },
        data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
      }),
      prisma.conversation.updateMany({
        where: { id: { in: orphanIds } },
        data: { guestIdentifier: ANON_ID },
      }),
      ...bodyRedactions.map((r) => prisma.message.update({ where: { id: r.id }, data: { body: r.body } })),
    ]);
    anonymized += orphanIds.length;
  }

  return { anonymized };
}

/**
 * Delete marketing leads past the lead-retention window. Prospect PII (name /
 * email / phone / message) has no other lifecycle — Lead has no org link, so it is
 * NOT covered by account erasure or the guest-data sweep — and would otherwise be
 * kept indefinitely. Gated by its OWN env var (default OFF) so a host's active
 * sales pipeline is never silently purged: set LEAD_RETENTION_MONTHS to enable.
 */
export async function purgeOldLeads(now: Date = new Date()): Promise<{ purged: number }> {
  const months = Number(process.env.LEAD_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return { purged: 0 }; // disabled by default
  const cutoff = subMonths(startOfDay(now), months);
  const res = await prisma.lead.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { purged: res.count };
}

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/**
 * Rebuild a Paddle webhook payload keeping ONLY a minimal financial/reconciliation
 * skeleton (allowlist = fail-closed, so any future PII field Paddle adds is
 * dropped by default). Amount/currency are financial-record fields, NOT direct
 * PII, so they're kept for the books; customer email/name/address/card and the
 * rest of the raw body are dropped.
 */
function redactPaddlePayload(raw: string): string {
  let p: Record<string, unknown>;
  try {
    p = asObj(JSON.parse(raw));
  } catch {
    return JSON.stringify({ redactedAt: new Date().toISOString(), note: "kvkk-erasure", raw: "unparseable" });
  }
  const d = asObj(p.data);
  const totals = asObj(asObj(d.details).totals);
  const period = asObj(d.current_billing_period);
  const cd = asObj(d.custom_data);
  return JSON.stringify({
    event_id: p.event_id ?? null,
    event_type: p.event_type ?? null,
    occurred_at: p.occurred_at ?? null,
    data: {
      id: d.id ?? null,
      status: d.status ?? null,
      customer_id: d.customer_id ?? null, // provider id (reconciliation), not direct PII
      subscription_id: d.subscription_id ?? null,
      currency_code: d.currency_code ?? null,
      current_billing_period: { ends_at: period.ends_at ?? null },
      details: { totals: { grand_total: totals.grand_total ?? null } },
      custom_data: { organizationId: cd.organizationId ?? null },
    },
    redactedAt: new Date().toISOString(),
    note: "kvkk-erasure",
  });
}

/**
 * Minimize customer PII in Paddle WebhookEvent rows for a deleted org. WebhookEvent
 * has NO org FK (so it doesn't cascade — it's the surviving financial trail once
 * Invoice/Subscription cascade away). Linked only via payloadJson custom_data.
 * organizationId: pre-filter by substring (org id is a high-entropy cuid), then
 * parse-verify before touching. status:"processed" so a Paddle retry can't re-store
 * raw PII (the webhook route only reprocesses non-"processed" rows).
 */
async function redactPaddleWebhooksForOrg(organizationId: string): Promise<void> {
  const rows = await prisma.webhookEvent.findMany({
    where: { provider: "paddle", payloadJson: { contains: organizationId } },
    select: { id: true, payloadJson: true },
  });
  for (const r of rows) {
    let belongs = false;
    try {
      const parsed = JSON.parse(r.payloadJson) as { data?: { custom_data?: { organizationId?: unknown } } };
      belongs = parsed?.data?.custom_data?.organizationId === organizationId;
    } catch {
      belongs = false; // unparseable → not attributable to this org, skip
    }
    if (!belongs) continue;
    await prisma.webhookEvent.update({
      where: { id: r.id },
      data: { payloadJson: redactPaddlePayload(r.payloadJson), status: "processed", processedAt: new Date() },
    });
  }
}

/**
 * Full account erasure for one organization. Irreversible. The caller MUST have
 * already authorized this (owner re-authenticated). Returns silently on success.
 */
export async function deleteAccountData(organizationId: string): Promise<void> {
  // KVKK erasure: WebhookEvent has no org FK (won't cascade) and its Paddle
  // payload carries customer email/name/address. Keep the financial skeleton but
  // strip the PII BEFORE the org row is gone (so it's minimized even if the
  // delete below throws).
  await redactPaddleWebhooksForOrg(organizationId);

  // ChatUsage rows key on propertyId but have no FK relation → won't cascade.
  const props = await prisma.property.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const propIds = props.map((p) => p.id);
  if (propIds.length > 0) {
    await prisma.chatUsage.deleteMany({ where: { propertyId: { in: propIds } } });
  }
  // Everything else cascades from the organization row.
  await prisma.organization.delete({ where: { id: organizationId } });

  // KVKK: task photos live on local disk (public/uploads/{orgSlug}), NOT in the DB,
  // so the cascade above leaves them. Physically remove the org's upload folder.
  // Best-effort — a missing dir or FS error must never fail the erasure.
  try {
    const orgSlug = organizationId.replace(/[^a-zA-Z0-9-]/g, "");
    if (orgSlug) {
      const { rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await rm(join(process.cwd(), "public", "uploads", orgSlug), { recursive: true, force: true });
    }
  } catch {
    // ignore — files may already be gone / ephemeral storage
  }
}
