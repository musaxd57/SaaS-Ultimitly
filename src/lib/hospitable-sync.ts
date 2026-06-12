import "server-only";

import { prisma } from "@/lib/db";
import {
  listProperties,
  listReservations,
  listMessages,
  HospitableError,
  type HospitableProperty,
  type HospitableReservation,
  type HospitableMessage,
} from "@/lib/hospitable";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { reportError } from "@/lib/report-error";
import { createReservationTasks } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Hospitable → Inbox synchronisation
//
// Pulls guest conversations from Hospitable into our inbox:
//   1. Link/create our Property records from Hospitable properties.
//   2. Per property, fetch reservations (Hospitable requires a properties[]
//      filter, so we query one property at a time and thus know the owner).
//   3. For reservations that have a message thread, fetch and import messages,
//      de-duplicated by the provider message id.
//
// Read-only against Hospitable — nothing is sent. Resilient: a failure on one
// property/reservation is logged and skipped so the rest still sync. Rate
// limits are absorbed by the client (Retry-After backoff).
// ---------------------------------------------------------------------------

export interface SyncResult {
  properties: number; // properties linked or created
  reservations: number; // reservations upserted (drives dashboard + welcome)
  conversations: number; // conversations created or updated
  messages: number; // new messages imported
  threads: number; // reservations that have a message thread (last_message_at)
  skipped: number; // unchanged threads skipped (no API call needed)
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function parseDate(value: unknown): Date | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Map a Hospitable platform string onto our Conversation.channel value. */
function toChannel(platform: unknown): string {
  const p = String(platform ?? "").toLowerCase();
  if (p.includes("airbnb")) return "airbnb";
  if (p.includes("booking")) return "booking";
  if (p.includes("homeaway") || p.includes("vrbo")) return "vrbo";
  if (p === "direct" || p === "manual" || p === "website") return "direct";
  return p || "other";
}

/** A guest message is inbound; host/owner/automated messages are outbound. */
function isGuestMessage(m: HospitableMessage): boolean {
  const role = `${m.sender_type ?? ""} ${m.sender_role ?? ""}`.toLowerCase();
  return role.includes("guest");
}

function senderFullName(m: HospitableMessage): string | null {
  const sender = m.sender as { full_name?: string; first_name?: string } | undefined;
  return str(sender?.full_name) ?? str(sender?.first_name);
}

/** Guest name from the (included) reservation.guest record, if present. */
function reservationGuestName(reservation: HospitableReservation): string | null {
  const g = reservation.guest;
  if (!g) return null;
  const full = str(g.full_name) ?? str(g.name);
  if (full) return full;
  const composed = [str(g.first_name), str(g.last_name)].filter(Boolean).join(" ").trim();
  return composed.length ? composed : null;
}

// ---------------------------------------------------------------------------

export async function syncHospitable(
  organizationId: string,
  options: { backDays?: number; forwardDays?: number } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    properties: 0,
    reservations: 0,
    conversations: 0,
    messages: 0,
    threads: 0,
    skipped: 0,
  };

  // Multi-tenant: use THIS org's own Hospitable token. If it has no connection
  // (and isn't the primary org falling back to env), there is nothing to pull —
  // return immediately so one customer can never sync another's Airbnb data.
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return result;

  // 1. Link/create properties.
  const hospitableProps = await listProperties(token);
  // Live Hospitable listing ids this run — used so linkProperty never re-points a
  // property that still belongs to a different LIVE same-named listing.
  const liveIds = new Set<string>(
    hospitableProps.map((p) => p.id).filter((id): id is string => Boolean(id)),
  );
  const propertyMap = new Map<string, string>(); // hospitableId → our propertyId
  for (const hp of hospitableProps) {
    if (!hp.id) continue;
    const ourId = await linkProperty(organizationId, hp, liveIds);
    propertyMap.set(hp.id, ourId);
    result.properties++;
  }

  // 2. Per property, pull reservations and their message threads.
  // Bound the reservation query to a recent→future window. Without it, every
  // listing pages through its ENTIRE booking history (up to 40 pages each),
  // which on a multi-listing account exhausts the API rate limit before any
  // messages are fetched — so new guest messages silently never import.
  //
  // The window is chosen by the CALLER so the cron can stay light. The expensive
  // part of every run is paging through the reservations in the window; the bulk
  // of those are far-FUTURE bookings, so the frequent cron uses a narrow window
  // (recent + near-term) while a wide catch-up runs only hourly, and the manual
  // button always goes wide. Safe full defaults apply to any direct call.
  const backDays = options.backDays ?? 90;
  const forwardDays = options.forwardDays ?? 540;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(new Date(Date.now() - backDays * 24 * 60 * 60 * 1000));
  const endDate = fmt(new Date(Date.now() + forwardDays * 24 * 60 * 60 * 1000));

  // A revoked/expired token makes EVERY Hospitable call 401/403. Surface that
  // ONCE per org (reportError → Sentry/alert email) so the host gets told to
  // reconnect — instead of the sync dying silently and new guest messages never
  // importing again. Non-auth per-record errors stay best-effort console logs.
  let authFailureReported = false;
  const noteHospitableError = (context: string, err: unknown) => {
    const status = err instanceof HospitableError ? err.status : undefined;
    if ((status === 401 || status === 403) && !authFailureReported) {
      authFailureReported = true;
      void reportError(`hospitable-auth org:${organizationId}`, err);
    } else {
      console.error(`[Hospitable sync] ${context}`, err);
    }
  };

  for (const [hospitableId, propertyId] of propertyMap) {
    let reservations: HospitableReservation[];
    try {
      reservations = await listReservations({ propertyIds: [hospitableId], startDate, endDate }, token);
    } catch (err) {
      noteHospitableError(`reservations failed for ${hospitableId}`, err);
      continue;
    }

    for (const reservation of reservations) {
      if (!reservation.id) continue;

      // Store the reservation (guest, dates, status) — drives the dashboard and
      // the welcome message. Guarded so one bad record can't abort the sync.
      // Capture its local id so the conversation can be linked to it below.
      let localReservationId: string | null = null;
      try {
        localReservationId = await upsertReservationCalendar(propertyId, reservation);
        if (localReservationId) {
          result.reservations++;
          // Auto-create check-in/cleaning tasks for this booking. Idempotent: skips
          // past stays AND reservations that already have tasks, so re-running every
          // sync is safe. Best-effort — a task failure must never break the sync.
          // This makes Hospitable bookings drop tasks automatically, like iCal does.
          await createReservationTasks(localReservationId).catch(() => {});
        }
      } catch (err) {
        console.error(`[Hospitable sync] reservation upsert failed for ${reservation.id}`, err);
      }

      // Message thread import — only for reservations that have a conversation.
      if (!reservation.last_message_at) continue;
      result.threads++;

      // Skip threads that are UNCHANGED since our last import: only spend a
      // Hospitable API request when the thread genuinely has a newer message.
      // This keeps the per-run request count low so busy accounts (many
      // listings) don't exhaust the rate limit before reaching new messages.
      const incomingLast = parseDate(reservation.last_message_at);
      if (incomingLast) {
        const existingConv = await prisma.conversation.findFirst({
          where: { propertyId, externalReservationId: String(reservation.id) },
          select: { id: true, lastMessageAt: true, reservationId: true },
        });
        if (existingConv?.lastMessageAt && existingConv.lastMessageAt >= incomingLast) {
          // Up to date — skip the message fetch (rate-limit saver). But still
          // backfill the reservation link if it's missing, so an already-imported
          // thread gets its correct guest/dates context (and the ended-booking
          // gate) without waiting for the next new message. One-time, never
          // overwrites an existing link.
          if (localReservationId && !existingConv.reservationId) {
            await prisma.conversation.update({
              where: { id: existingConv.id },
              data: { reservationId: localReservationId },
            });
          }
          result.skipped++;
          continue; // already up to date — no network call needed
        }
      }

      let messages: HospitableMessage[];
      try {
        messages = await listMessages(String(reservation.id), token);
      } catch (err) {
        noteHospitableError(`messages failed for ${reservation.id}`, err);
        continue;
      }
      if (messages.length === 0) continue;

      try {
        const imported = await importThread(propertyId, reservation, messages, localReservationId);
        result.conversations++;
        result.messages += imported;
      } catch (err) {
        console.error(`[Hospitable sync] thread import failed for ${reservation.id}`, err);
      }
    }
  }

  return result;
}

/**
 * Upsert a Reservation row (guest, dates, status) from a Hospitable reservation.
 * Returns the local Reservation id so the caller can link the conversation to it
 * (correct guest/dates context), or null when nothing was written.
 */
async function upsertReservationCalendar(
  propertyId: string,
  reservation: HospitableReservation,
): Promise<string | null> {
  const srcRef = String(reservation.id);
  const arrivalDate = parseDate(reservation.arrival_date) ?? parseDate(reservation.check_in);
  const departureDate = parseDate(reservation.departure_date) ?? parseDate(reservation.check_out);
  if (!arrivalDate || !departureDate) return null;

  // FK safety: only write if the property genuinely exists.
  const propertyExists = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true },
  });
  if (!propertyExists) return null;

  const g = reservation.guest;
  const guestName =
    reservationGuestName(reservation) ??
    (str(reservation.code) ? `Rezervasyon ${reservation.code}` : "Misafir");
  const guestEmail = str(g?.email) ?? null;
  const guestPhone = str(g?.phone) ?? null;
  // Stable per-person guest id (links the same guest across stays). Airbnb masks
  // email/phone, but this id is present — it's the reliable returning-guest key.
  // Falsy guard (not just != null): an empty-string id must never become a shared
  // match key. Real Hospitable guest ids are non-empty UUIDs → always truthy.
  const guestExternalId = g?.id ? String(g.id) : null;
  const channel = toChannel(reservation.platform);

  // Look at both the top-level status and the nested reservation_status so a
  // cancelled booking is never treated as "confirmed" (and never welcomed).
  // Terminal "never happened" states (cancelled/declined/expired/not_possible/
  // denied) all map to "cancelled" so no lifecycle message reaches a dead request.
  const rawStatus =
    `${reservation.status ?? ""} ${reservation.reservation_status?.current?.category ?? ""}`.toLowerCase();
  const status =
    rawStatus.includes("cancel") ||
    rawStatus.includes("declin") ||
    rawStatus.includes("expired") ||
    rawStatus.includes("not_possible") ||
    rawStatus.includes("denied")
    ? "cancelled"
    : rawStatus.includes("pending") || rawStatus.includes("request")
      ? "pending"
      : rawStatus.includes("complete") ||
          rawStatus.includes("checked_out") ||
          rawStatus.includes("past")
        ? "completed"
        : "confirmed";

  const totalAmount =
    typeof reservation.total_price === "number" ? reservation.total_price : null;
  const currency = str(reservation.currency) ?? "EUR";

  const existing = await prisma.reservation.findFirst({
    where: { propertyId, sourceReference: srcRef },
    select: { id: true },
  });

  if (existing) {
    await prisma.reservation.update({
      where: { id: existing.id },
      data: {
        guestName,
        ...(guestEmail !== null ? { guestEmail } : {}),
        ...(guestPhone !== null ? { guestPhone } : {}),
        ...(guestExternalId !== null ? { guestExternalId } : {}),
        arrivalDate,
        departureDate,
        channel,
        status,
        ...(totalAmount !== null ? { totalAmount, currency } : {}),
      },
    });
    return existing.id;
  }

  const created = await prisma.reservation.create({
    data: {
      propertyId,
      guestName,
      guestEmail: guestEmail ?? undefined,
      guestPhone: guestPhone ?? undefined,
      guestExternalId: guestExternalId ?? undefined,
      arrivalDate,
      departureDate,
      channel,
      status,
      totalAmount: totalAmount ?? undefined,
      currency,
      sourceReference: srcRef,
    },
    select: { id: true },
  });
  return created.id;
}

/** Link a Hospitable property to an existing Property (by id, then name) or create one. */
async function linkProperty(
  organizationId: string,
  hp: HospitableProperty,
  liveIds: Set<string>,
): Promise<string> {
  const linked = await prisma.property.findFirst({
    where: { organizationId, hospitableId: hp.id },
    select: { id: true },
  });
  if (linked) return linked.id;

  const name = str(hp.name) ?? str(hp.public_name) ?? "Hospitable mülkü";

  // Re-adopt a same-named property that LOST its link (hospitableId null) — the
  // unambiguous orphan/reconnect case.
  const unlinked = await prisma.property.findFirst({
    where: { organizationId, hospitableId: null, name },
    select: { id: true },
  });
  if (unlinked) {
    await prisma.property.update({ where: { id: unlinked.id }, data: { hospitableId: hp.id } });
    return unlinked.id;
  }

  // Else: a same-named property whose current hospitableId is STALE (no longer in
  // this account's live listings → the listing reconnected with a new id). Re-point
  // it. CRITICAL: NEVER steal a property still linked to a DIFFERENT LIVE listing
  // (two listings sharing an identical name) — that would file one apartment's
  // reservations/messages under the other. In that case create a fresh record.
  const sameName = await prisma.property.findFirst({
    where: { organizationId, name },
    orderBy: { createdAt: "asc" },
    select: { id: true, hospitableId: true },
  });
  if (sameName?.hospitableId && !liveIds.has(sameName.hospitableId)) {
    await prisma.property.update({ where: { id: sameName.id }, data: { hospitableId: hp.id } });
    return sameName.id;
  }

  const created = await prisma.property.create({
    data: { organizationId, name, hospitableId: hp.id },
    select: { id: true },
  });
  return created.id;
}

/** Create/update the conversation for a reservation and import its new messages. */
async function importThread(
  propertyId: string,
  reservation: HospitableReservation,
  messages: HospitableMessage[],
  localReservationId: string | null,
): Promise<number> {
  const reservationId = String(reservation.id);
  const channel = toChannel(reservation.platform);
  const language = str(reservation.conversation_language) ?? "tr";
  const lastMessageAt = parseDate(reservation.last_message_at) ?? new Date();

  // Chronological order so the last element is the most recent message.
  const ordered = [...messages].sort(
    (a, b) => (parseDate(a.created_at)?.getTime() ?? 0) - (parseDate(b.created_at)?.getTime() ?? 0),
  );

  // Guest display name: prefer the (included) reservation guest record, then a
  // guest message's sender, then the booking code as a last resort.
  const guestName =
    reservationGuestName(reservation) ??
    senderFullName(ordered.find(isGuestMessage) ?? ({} as HospitableMessage)) ??
    (str(reservation.code) ? `Rezervasyon ${reservation.code}` : "Misafir");

  // Status reflects who spoke last: guest → awaiting a reply ("new"); host → "answered".
  const lastMessage = ordered[ordered.length - 1];
  const computedStatus = lastMessage && isGuestMessage(lastMessage) ? "new" : "answered";

  const existing = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: reservationId },
    select: { id: true, status: true, reservationId: true },
  });

  let conversationId: string;
  if (!existing) {
    const created = await prisma.conversation.create({
      data: {
        propertyId,
        channel,
        guestIdentifier: guestName,
        status: computedStatus,
        priority: "standard",
        lastMessageAt,
        // Link to the local reservation row (same property + same Hospitable
        // reservation id) so the AI replies with the correct guest/dates and
        // skips finished/cancelled bookings. Null when no reservation matched.
        reservationId: localReservationId,
        externalReservationId: reservationId,
        externalConversationId: str(reservation.conversation_id),
      },
      select: { id: true },
    });
    conversationId = created.id;
  } else {
    // Preserve human/rule decisions; only refresh the automatic states.
    const preserve = ["problem", "closed", "waiting"].includes(existing.status);
    await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        lastMessageAt,
        guestIdentifier: guestName,
        ...(preserve ? {} : { status: computedStatus }),
        // Backfill the reservation link only when it's currently empty — never
        // overwrite an existing (possibly human-set) link.
        ...(localReservationId && !existing.reservationId
          ? { reservationId: localReservationId }
          : {}),
      },
    });
    conversationId = existing.id;
  }

  // Import messages in chronological order, skipping ones we already have.
  let newMessages = 0;
  for (const m of ordered) {
    const externalId = m.id != null ? String(m.id) : null;
    const body = str(m.body);
    if (!externalId || !body) continue; // skip non-text / unidentifiable messages

    const exists = await prisma.message.findFirst({
      where: { conversationId, externalId },
      select: { id: true },
    });
    if (exists) continue;

    const inbound = isGuestMessage(m);
    await prisma.message.create({
      data: {
        conversationId,
        direction: inbound ? "inbound" : "outbound",
        senderName: senderFullName(m) ?? (inbound ? guestName : "Ev sahibi"),
        body,
        language,
        externalId,
        createdAt: parseDate(m.created_at) ?? undefined,
      },
    });
    newMessages++;
  }

  return newMessages;
}
