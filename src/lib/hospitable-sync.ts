import "server-only";

import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { toAmountDec } from "@/lib/money";
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
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { recordSupplyRequestFromMessage } from "@/lib/supply";
import { billingEnforced, getEntitlement } from "@/lib/billing/subscription";
import { ANON_NAME, ANON_ID, retentionCutoff } from "@/lib/data-retention";

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
  propertiesCapped: number; // NEW Hospitable listings not onboarded — plan's property limit reached
}

/** Per-sync-run counter so linkProperty can refuse to CREATE past the plan's
 * property limit. Never blocks a property that's already linked/re-adopted —
 * only caps brand-new growth, so nothing existing is ever affected. */
type PropertyLimitState = { limit: number; current: number } | null;

async function resolvePropertyLimitState(organizationId: string): Promise<PropertyLimitState> {
  if (!billingEnforced()) return null; // dormant — matches canAddProperty's own gate
  const ent = await getEntitlement(organizationId);
  if (ent.propertyLimit == null) return null; // unlimited (grandfathered or no-cap plan)
  const current = await prisma.property.count({ where: { organizationId } });
  return { limit: ent.propertyLimit, current };
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
    propertiesCapped: 0,
  };

  // Multi-tenant: use THIS org's own Hospitable token. If it has no connection
  // (and isn't the primary org falling back to env), there is nothing to pull —
  // return immediately so one customer can never sync another's Airbnb data.
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return result;

  // 1. Link/create properties, capped at the org's PLAN property limit (only
  // while billing is enforced). This is the only place a host's chosen Lixus
  // tier can matter for Hospitable sync: an org whose real Hospitable account
  // has more listings than their plan allows gets the first N onboarded —
  // never a mid-run reshuffle of which N (stable Hospitable listing order),
  // and NEVER any already-linked property dropped or re-counted.
  const limitState = await resolvePropertyLimitState(organizationId);
  const hospitableProps = await listProperties(token);
  // Live Hospitable listing ids this run — used so linkProperty never re-points a
  // property that still belongs to a different LIVE same-named listing.
  const liveIds = new Set<string>(
    hospitableProps.map((p) => p.id).filter((id): id is string => Boolean(id)),
  );
  const propertyMap = new Map<string, string>(); // hospitableId → our propertyId
  for (const hp of hospitableProps) {
    if (!hp.id) continue;
    try {
      const ourId = await linkProperty(organizationId, hp, liveIds, limitState);
      if (!ourId) {
        result.propertiesCapped++;
        continue;
      }
      propertyMap.set(hp.id, ourId);
      result.properties++;
    } catch (err) {
      // A DB error on ONE listing must not abort the whole org's sync (mirrors the
      // reservation loop). Notably a P2002 on the GLOBAL-@unique hospitableId when
      // the same Airbnb account is linked under another org — log and move on.
      console.error(`[Hospitable sync] linkProperty failed for ${hp.id}`, err);
    }
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
      if (!reservation || !reservation.id) continue;

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
          // If the booking flipped to cancelled, remove its still-pending auto
          // tasks so the cleaning/check-in list isn't left with work for a guest
          // who isn't coming. No-op for active bookings. Best-effort.
          await removeAutoTasksForCancelledReservation(localReservationId).catch(() => {});
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
        try {
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
        } catch (err) {
          // A transient DB error on the skip-check must NOT abort the whole
          // property's remaining reservations — log and fall through to a normal
          // import (which is idempotent), losing only this cycle's skip savings.
          console.error(`[Hospitable sync] skip-check failed for ${reservation.id}`, err);
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
  // Resolve the real name separately from the placeholder fallback: on UPDATE we
  // only overwrite guestName when a real name is present, so a later sync where
  // the channel has masked the guest (Airbnb hides PII a while after checkout)
  // can't regress a previously-stored name to "Misafir" (mirrors email/phone).
  const resolvedGuestName = reservationGuestName(reservation) ?? null;
  const guestName =
    resolvedGuestName ?? (str(reservation.code) ? `Rezervasyon ${reservation.code}` : "Misafir");
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
    select: { id: true, guestName: true },
  });

  if (existing) {
    // KVKK resurrection guard: once the retention sweep has anonymized this row
    // (guestName === ANON_NAME), NEVER let a re-sync write the guest's PII back
    // from the channel — the deep look-back can reach past the retention cutoff,
    // and Booking/direct channels return the real name forever. Dates/status
    // (non-PII) still refresh so occupancy stays correct.
    const scrubbed = existing.guestName === ANON_NAME;
    await prisma.reservation.update({
      where: { id: existing.id },
      data: {
        ...(!scrubbed && resolvedGuestName !== null ? { guestName: resolvedGuestName } : {}),
        ...(!scrubbed && guestEmail !== null ? { guestEmail } : {}),
        ...(!scrubbed && guestPhone !== null ? { guestPhone } : {}),
        ...(!scrubbed && guestExternalId !== null ? { guestExternalId } : {}),
        arrivalDate,
        departureDate,
        channel,
        status,
        ...(totalAmount !== null ? { totalAmount, totalAmountDec: toAmountDec(totalAmount), currency } : {}),
      },
    });
    return existing.id;
  }

  try {
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
        totalAmountDec: toAmountDec(totalAmount) ?? undefined,
        currency,
        sourceReference: srcRef,
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // DEDUPE-HIT on @@unique([propertyId, sourceReference]) ONLY: a racing
    // sync created the canonical row between our lookup and this insert —
    // adopt it (field updates catch up on the next pass). Any other unique
    // violation is a real error and must surface.
    if (isUniqueViolation(err, ["propertyId", "sourceReference"])) {
      const raced = await prisma.reservation.findFirst({
        where: { propertyId, sourceReference: srcRef },
        select: { id: true },
      });
      if (raced) return raced.id;
    }
    throw err;
  }
}

/**
 * Link a Hospitable property to an existing Property (by id, then name) or
 * create one — unless creating one would exceed the plan's property limit, in
 * which case returns null (nothing already onboarded is ever affected; only
 * a brand-new, never-before-linked listing can be refused this way).
 */
async function linkProperty(
  organizationId: string,
  hp: HospitableProperty,
  liveIds: Set<string>,
  limitState: PropertyLimitState,
): Promise<string | null> {
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

  // Only reaching here creates a genuinely NEW property row — the one point
  // where a plan's property-count entitlement can cap Hospitable sync.
  if (limitState && limitState.current >= limitState.limit) return null;

  const created = await prisma.property.create({
    data: { organizationId, name, hospitableId: hp.id },
    select: { id: true },
  });
  if (limitState) limitState.current++;
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

  // Guest display name. Keep the REAL resolved name separate from the placeholder
  // fallback (mirrors the reservation guestName/email logic): on UPDATE we only
  // ever write a real name, so a sync where the name is still unresolved can't
  // regress a stored name, and — crucially — a thread first created without a
  // name ("Misafir" placeholder) DOES adopt the real name once it arrives.
  const resolvedGuestName =
    reservationGuestName(reservation) ??
    senderFullName(ordered.find(isGuestMessage) ?? ({} as HospitableMessage)) ??
    null;
  const guestName =
    resolvedGuestName ?? (str(reservation.code) ? `Rezervasyon ${reservation.code}` : "Misafir");

  // Status reflects who spoke last: guest → awaiting a reply ("new"); host → "answered".
  const lastMessage = ordered[ordered.length - 1];
  const computedStatus = lastMessage && isGuestMessage(lastMessage) ? "new" : "answered";

  const existing = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: reservationId },
    select: { id: true, status: true, reservationId: true, guestIdentifier: true },
  });

  // Cursor idempotency: do NOT advance lastMessageAt to the provider's latest until
  // ALL messages below are written. If the message loop throws mid-way (caught by
  // the caller), an advanced cursor would make the NEXT sync see the thread as
  // "current" and skip it, dropping the unwritten tail. So create with a
  // conservative value (the earliest message time) / keep the old value on update,
  // then bump to `lastMessageAt` only after the loop completes.
  const createCursor = parseDate(ordered[0]?.created_at) ?? lastMessageAt;

  let conversationId: string;
  // Whether the linked stay has been anonymized by the retention sweep — set in
  // the existing-thread branch below and used by the message loop's era filter.
  let scrubbedThread = false;
  if (!existing) {
    const created = await prisma.conversation.create({
      data: {
        propertyId,
        channel,
        guestIdentifier: guestName,
        status: computedStatus,
        priority: "standard",
        lastMessageAt: createCursor, // bumped to the real latest after the loop
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
    // KVKK resurrection guard: don't rewrite the identifier once the retention
    // sweep anonymized the stay. Key this off the LINKED RESERVATION's DISTINCT
    // sentinel (guestName === ANON_NAME), NOT conversation.guestIdentifier ===
    // ANON_ID — ANON_ID ("Misafir") is ALSO the legitimate no-name placeholder,
    // so keying off it would freeze a placeholder thread at "Misafir" forever,
    // never adopting the real name once it arrives. For an orphan thread (no
    // linked reservation) fall back to the identifier sentinel (privacy-safe).
    let scrubbed: boolean;
    if (localReservationId) {
      const linked = await prisma.reservation.findUnique({
        where: { id: localReservationId },
        select: { guestName: true },
      });
      scrubbed = linked?.guestName === ANON_NAME;
    } else {
      scrubbed = existing.guestIdentifier === ANON_ID;
    }
    scrubbedThread = scrubbed;
    await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        // lastMessageAt is intentionally NOT advanced here — bumped after the loop.
        // Only ever write a REAL name (never the placeholder) and never onto a
        // scrubbed stay — so the placeholder is replaced when the name arrives,
        // but an anonymized identifier is never resurrected.
        ...(scrubbed || resolvedGuestName === null ? {} : { guestIdentifier: resolvedGuestName }),
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
  // KVKK era filter: on a retention-anonymized stay, never (re-)create messages
  // OLDER than the retention cutoff — that era is exactly what the sweep erased
  // (inbound bodies) or redacted (outbound names). The id-dedup can't protect the
  // redacted un-ID'd rows (their body no longer matches the provider's original),
  // so re-importing would BOTH duplicate them AND resurrect the guest's name.
  // Newer messages still import normally; a missing timestamp on a scrubbed
  // thread skips (fail-closed for privacy).
  const eraCutoff = scrubbedThread ? retentionCutoff() : null;
  let newMessages = 0;
  for (const m of ordered) {
    const externalId = m.id != null ? String(m.id) : null;
    const body = str(m.body);
    if (!externalId || !body) continue; // skip non-text / unidentifiable messages
    if (eraCutoff) {
      const msgAt = parseDate(m.created_at);
      if (!msgAt || msgAt < eraCutoff) continue;
    }

    const exists = await prisma.message.findFirst({
      where: { conversationId, externalId },
      select: { id: true },
    });
    if (exists) continue;

    const inbound = isGuestMessage(m);
    if (!inbound) {
      // Adopt-and-heal: a reply sent from the app is persisted locally at send
      // time, but when the provider returned no message id (or a POST id that
      // differs from this GET id) the local row's externalId stayed NULL — the
      // id-dedup above can't see it and the same reply would re-import as a
      // duplicate "Ev sahibi" row. If an un-ID'd local outbound row with the
      // exact same text exists, claim the OLDEST one as this provider message
      // (chronological pairing for repeated identical texts) and heal its id so
      // every future sync dedups normally. Inbound is never adopted, and a real
      // externalId is never overwritten.
      const orphan = await prisma.message.findFirst({
        where: { conversationId, direction: "outbound", externalId: null, body },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (orphan) {
        try {
          await prisma.message.update({ where: { id: orphan.id }, data: { externalId } });
        } catch (err) {
          // The canonical row with this externalId already exists (raced in) —
          // healing the orphan would duplicate the key. Leave the orphan; the
          // canonical import stands. Only THIS constraint is swallowed.
          if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
        }
        continue;
      }
    }
    let created: { id: string };
    try {
      created = await prisma.message.create({
        data: {
          conversationId,
          direction: inbound ? "inbound" : "outbound",
          senderName: senderFullName(m) ?? (inbound ? guestName : "Ev sahibi"),
          body,
          language,
          externalId,
          createdAt: parseDate(m.created_at) ?? undefined,
        },
        select: { id: true },
      });
    } catch (err) {
      // DEDUPE-HIT on @@unique([conversationId, externalId]) ONLY: another
      // pass imported this provider message first — the DB is the arbiter now.
      if (isUniqueViolation(err, ["conversationId", "externalId"])) continue;
      throw err;
    }
    newMessages++;
    // Pick up an explicit "extra towel/sheet" ask → adds +1 to the prep plan.
    // Best-effort, deduped by message id; must never break the sync.
    if (inbound) {
      await recordSupplyRequestFromMessage({
        propertyId,
        message: body,
        sourceMessageId: created.id,
        reservationId: localReservationId,
      }).catch(() => {});
    }
  }

  // All messages are now written — safe to advance the cursor to the provider's
  // latest. If the loop above threw, execution never reaches here (the caller
  // catches), so the cursor stays behind and the next sync re-fetches the tail.
  if (createCursor.getTime() !== lastMessageAt.getTime()) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt },
    });
  }

  return newMessages;
}
