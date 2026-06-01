import "server-only";

import { prisma } from "@/lib/db";
import {
  listProperties,
  listReservations,
  listMessages,
  type HospitableProperty,
  type HospitableReservation,
  type HospitableMessage,
} from "@/lib/hospitable";

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
  reservations: number; // reservations upserted (calendar)
  conversations: number; // conversations created or updated
  messages: number; // new messages imported
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

// ---------------------------------------------------------------------------

export async function syncHospitable(organizationId: string): Promise<SyncResult> {
  const result: SyncResult = { properties: 0, reservations: 0, conversations: 0, messages: 0 };

  // 1. Link/create properties.
  const hospitableProps = await listProperties();
  const propertyMap = new Map<string, string>(); // hospitableId → our propertyId
  for (const hp of hospitableProps) {
    if (!hp.id) continue;
    const ourId = await linkProperty(organizationId, hp);
    propertyMap.set(hp.id, ourId);
    result.properties++;
  }

  // 2. Per property, pull reservations and their message threads.
  for (const [hospitableId, propertyId] of propertyMap) {
    let reservations: HospitableReservation[];
    try {
      reservations = await listReservations({ propertyIds: [hospitableId] });
    } catch (err) {
      console.error(`[Hospitable sync] reservations failed for ${hospitableId}`, err);
      continue;
    }

    for (const reservation of reservations) {
      if (!reservation.id) continue;

      // Always upsert the Reservation record so the calendar stays up to date.
      // Guarded: a single bad reservation must never break the whole sync.
      try {
        const saved = await upsertReservationCalendar(propertyId, reservation);
        if (saved) result.reservations++;
      } catch (err) {
        console.error(`[Hospitable sync] reservation upsert failed for ${reservation.id}`, err);
      }

      // Message thread sync — only when there is a conversation.
      if (!reservation.last_message_at) continue;

      let messages: HospitableMessage[];
      try {
        messages = await listMessages(String(reservation.id));
      } catch (err) {
        console.error(`[Hospitable sync] messages failed for ${reservation.id}`, err);
        continue;
      }
      if (messages.length === 0) continue;

      try {
        const imported = await importThread(propertyId, reservation, messages);
        result.conversations++;
        result.messages += imported;
      } catch (err) {
        console.error(`[Hospitable sync] thread import failed for ${reservation.id}`, err);
      }
    }
  }

  return result;
}

/** Upsert a Reservation row so the calendar reflects Hospitable bookings. */
async function upsertReservationCalendar(
  propertyId: string,
  reservation: HospitableReservation,
): Promise<boolean> {
  const srcRef = String(reservation.id);
  const arrivalDate = parseDate(reservation.check_in);
  const departureDate = parseDate(reservation.check_out);
  if (!arrivalDate || !departureDate) return false;

  // Guard against a stale propertyId (FK safety): only write if the property
  // really exists. Prevents "Foreign key constraint violated" from aborting
  // the sync if the property map is out of date for any reason.
  const propertyExists = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true },
  });
  if (!propertyExists) return false;

  const g = reservation.guest;
  const guestName =
    str(g?.full_name) ??
    str(g?.name) ??
    (str(reservation.code) ? `Rezervasyon ${reservation.code}` : "Misafir");
  const guestEmail = str(g?.email) ?? null;
  const guestPhone = str(g?.phone) ?? null;

  const channel = toChannel(reservation.platform);

  const rawStatus = String(reservation.status ?? "confirmed").toLowerCase();
  const status =
    rawStatus === "cancelled"
      ? "cancelled"
      : rawStatus === "pending"
        ? "pending"
        : rawStatus === "completed" || rawStatus === "checked_out"
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
        arrivalDate,
        departureDate,
        channel,
        status,
        ...(totalAmount !== null ? { totalAmount, currency } : {}),
      },
    });
  } else {
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName,
        guestEmail: guestEmail ?? undefined,
        guestPhone: guestPhone ?? undefined,
        arrivalDate,
        departureDate,
        channel,
        status,
        totalAmount: totalAmount ?? undefined,
        currency,
        sourceReference: srcRef,
      },
    });
  }

  return true;
}

/** Link a Hospitable property to an existing Property (by id, then name) or create one. */
async function linkProperty(
  organizationId: string,
  hp: HospitableProperty,
): Promise<string> {
  const linked = await prisma.property.findFirst({
    where: { organizationId, hospitableId: hp.id },
    select: { id: true },
  });
  if (linked) return linked.id;

  const name = str(hp.name) ?? str(hp.public_name) ?? "Hospitable mülkü";

  // Adopt an existing, unlinked property with the same name (avoids duplicates).
  const byName = await prisma.property.findFirst({
    where: { organizationId, hospitableId: null, name },
    select: { id: true },
  });
  if (byName) {
    await prisma.property.update({
      where: { id: byName.id },
      data: { hospitableId: hp.id },
    });
    return byName.id;
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
): Promise<number> {
  const reservationId = String(reservation.id);
  const channel = toChannel(reservation.platform);
  const language = str(reservation.conversation_language) ?? "tr";
  const lastMessageAt = parseDate(reservation.last_message_at) ?? new Date();

  // Chronological order so the last element is the most recent message.
  const ordered = [...messages].sort(
    (a, b) => (parseDate(a.created_at)?.getTime() ?? 0) - (parseDate(b.created_at)?.getTime() ?? 0),
  );

  // Guest display name from a guest message, falling back to the booking code.
  const guestName =
    senderFullName(ordered.find(isGuestMessage) ?? ({} as HospitableMessage)) ??
    (str(reservation.code) ? `Rezervasyon ${reservation.code}` : "Misafir");

  // Status reflects who spoke last: guest → awaiting a reply ("new"); host → "answered".
  const lastMessage = ordered[ordered.length - 1];
  const computedStatus = lastMessage && isGuestMessage(lastMessage) ? "new" : "answered";

  const existing = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: reservationId },
    select: { id: true, status: true },
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
