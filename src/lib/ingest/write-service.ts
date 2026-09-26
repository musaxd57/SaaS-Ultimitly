import "server-only";

import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";
import { toAmountDec } from "@/lib/money";
import { ANON_NAME, ANON_ID, retentionCutoff } from "@/lib/data-retention";
import type { ErasureDb } from "@/lib/erasure";
import { followReservationDates } from "@/lib/tasks/follow-reservation";
import type { recordSupplyRequestFromMessage } from "@/lib/supply";
import type { CanonicalMessage, CanonicalReservation } from "@/lib/channels/ingest";
import { recordIngestEvent as emit, INGEST_EVENT_SCHEMA_VERSION } from "./events";
import type { IngestContext } from "./events";

// Event sözleşmesi `./events`'te (V1 ürün akışı: iCal/elle dosya/QR da aynı sözleşmeye bağlı).
export { INGEST_EVENT_SCHEMA_VERSION } from "./events";
export type { IngestContext, IngestEventKind, IngestSource } from "./events";

// ---------------------------------------------------------------------------
// INGEST WRITE SERVICE (V0.6) — sağlayıcıdan gelen CANONICAL kaydı canonical
// tablolara yazan TEK servis. Polling (hospitable-sync) bugün, webhook yarın AYNI
// fonksiyonları çağırır (değişmez #7: payload → normalizasyon (adaptör) →
// source-scoped idempotency → canonical TX → versioned domain event).
//
// Gövdeler hospitable-sync.ts'ten BİREBİR taşındı (V0.6 davranış-koruyan): kimlik
// kilidi, KVKK resurrection/era guard'ları, imleç idempotency'si, adopt-and-heal,
// P2002 dedupe-hit, gövdesiz mesaj sayacı, çit geri alma — hepsi aynen. Tek
// davranış farkı BİLİNÇLİ: rezervasyon UPDATE yalnız gerçekten değişen alan varsa
// yazılır (eskiden her senkron koşulsuz UPDATE atıyordu) — domain event "değişti"
// demek için değişikliği ÖLÇMEK zorunda; değişmeyen senkron event ÜRETMEZ.
//
// Sağlayıcı tipi burada YOK (`HospitableReservation` imzadan çıktı — envanter §4 V0.6).
// Provenance V0.4 sözleşmesi aynen: create'te connectionId+evidence "ingest"+ingestedAt;
// update'te yalnız NULL damga gözlemle dolar; ingestedAt değişmez.
//
// DOMAIN EVENT (`IngestEvent`, migration 51): PII'SİZ — yalnız kiracı, sağlayıcı,
// bağlantı, varlık türü + bizim id'miz, tür, şema sürümü, zaman. Misafir metni/adı
// ve sağlayıcı kimliği TAŞIMAZ (KVKK kapsamına girmez; tüketen kod satırı id ile okur).
// Aynı TX'te yazılır (transactional outbox): satır varsa event vardır, tersi de.
// ---------------------------------------------------------------------------

export type SupplyJob = Parameters<typeof recordSupplyRequestFromMessage>[0];

const CONVERSATION_IDENTITY_LOCK_NS = 43;

/**
 * NS-43 kimlik kilidi — thread başına transaction-kapsamlı advisory lock. Canonical
 * okuma + create/update tek bölünmez adım; eşzamanlı ikinci içe aktarıcı bekler ve
 * kazananın satırını görür (aynı thread'de P2002 erişilemez).
 */
export async function acquireConversationIdentityLock(
  tx: ErasureDb,
  propertyId: string,
  externalReservationId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${CONVERSATION_IDENTITY_LOCK_NS}::int4, hashtext(${`${propertyId}:${externalReservationId}`}))`,
  );
}

/** Test-only seam: canonical okuma ile yazma arasındaki pencereyi genişletir. */
export const __importThreadHooks: { afterCanonicalRead: null | (() => Promise<void>) } = {
  afterCanonicalRead: null,
};

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return (a ?? null) === (b ?? null);
  return a.getTime() === b.getTime();
}

/**
 * Canonical rezervasyonu yaz (create / değişen alanları update). Dönüş: yerel satır id'si,
 * ya da null (tarih çözülemedi / mülk yok). Event: created · updated · cancelled.
 */
export async function upsertCanonicalReservation(
  db: ErasureDb,
  propertyId: string,
  r: CanonicalReservation,
  ctx: IngestContext,
): Promise<string | null> {
  const srcRef = r.externalId;
  if (!r.arrivalDate || !r.departureDate) return null;

  // FK safety: only write if the property genuinely exists.
  const propertyExists = await db.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!propertyExists) return null;

  // Resolve the real name separately from the placeholder fallback: on UPDATE we
  // only overwrite guestName when a real name is present, so a later sync where
  // the channel has masked the guest can't regress a stored name to "Misafir".
  const resolvedGuestName = r.guest.name;
  const guestName = resolvedGuestName ?? (r.code ? `Rezervasyon ${r.code}` : "Misafir");
  const guestEmail = r.guest.email;
  const guestPhone = r.guest.phone;
  const guestExternalId = r.guest.externalId;
  const currency = r.currency ?? "EUR";

  const existing = await db.reservation.findFirst({
    where: { propertyId, sourceReference: srcRef },
    select: {
      id: true,
      guestName: true,
      guestEmail: true,
      guestPhone: true,
      guestExternalId: true,
      arrivalDate: true,
      departureDate: true,
      channel: true,
      status: true,
      totalAmount: true,
      currency: true,
      connectionId: true,
    },
  });

  if (existing) {
    // KVKK resurrection guard: once the retention sweep has anonymized this row
    // (guestName === ANON_NAME), NEVER let a re-sync write the guest's PII back.
    const scrubbed = existing.guestName === ANON_NAME;
    const data: Prisma.ReservationUncheckedUpdateInput = {};
    if (!scrubbed && resolvedGuestName !== null && resolvedGuestName !== existing.guestName) data.guestName = resolvedGuestName;
    if (!scrubbed && guestEmail !== null && guestEmail !== existing.guestEmail) data.guestEmail = guestEmail;
    if (!scrubbed && guestPhone !== null && guestPhone !== existing.guestPhone) data.guestPhone = guestPhone;
    if (!scrubbed && guestExternalId !== null && guestExternalId !== existing.guestExternalId) data.guestExternalId = guestExternalId;
    if (!sameInstant(r.arrivalDate, existing.arrivalDate)) data.arrivalDate = r.arrivalDate;
    if (!sameInstant(r.departureDate, existing.departureDate)) data.departureDate = r.departureDate;
    if (r.channel !== existing.channel) data.channel = r.channel;
    if (r.status !== existing.status) data.status = r.status;
    if (r.totalAmount !== null && (r.totalAmount !== existing.totalAmount || currency !== existing.currency)) {
      data.totalAmount = r.totalAmount;
      data.totalAmountDec = toAmountDec(r.totalAmount);
      data.currency = currency;
    }
    // V0.4 provenance — GÖZLEMLE DOLDURMA (NULL→X yalnız); ingestedAt = ilk alınma, dokunulmaz.
    const observed = Boolean(ctx.connectionId && !existing.connectionId);
    if (observed) {
      data.connectionId = ctx.connectionId;
      data.connectionEvidence = "observed";
    }
    const contentChanged = Object.keys(data).some((k) => k !== "connectionId" && k !== "connectionEvidence");
    if (Object.keys(data).length > 0) {
      await db.reservation.update({ where: { id: existing.id }, data });
    }
    // Tarih değiştiyse açık yaşam döngüsü görevleri yeni tarihe (aynı TX; host'un taşıdığına dokunulmaz — dilim 4a).
    if (data.arrivalDate !== undefined || data.departureDate !== undefined) {
      await followReservationDates(db, existing.id, existing, { arrivalDate: r.arrivalDate, departureDate: r.departureDate });
    }
    if (contentChanged) {
      const cancelledNow = r.status === "cancelled" && existing.status !== "cancelled";
      await emit(
        db,
        ctx,
        "reservation",
        existing.id,
        cancelledNow ? "reservation.cancelled" : "reservation.updated",
        Object.keys(data).filter((k) => k !== "connectionId" && k !== "connectionEvidence"),
      );
    }
    return existing.id;
  }

  try {
    const created = await db.reservation.create({
      data: {
        propertyId,
        guestName,
        guestEmail: guestEmail ?? undefined,
        guestPhone: guestPhone ?? undefined,
        guestExternalId: guestExternalId ?? undefined,
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        channel: r.channel,
        status: r.status,
        totalAmount: r.totalAmount ?? undefined,
        totalAmountDec: toAmountDec(r.totalAmount) ?? undefined,
        currency,
        sourceReference: srcRef,
        connectionId: ctx.connectionId ?? undefined,
        connectionEvidence: ctx.connectionId ? "ingest" : undefined,
        ingestedAt: new Date(),
      },
      select: { id: true },
    });
    await emit(db, ctx, "reservation", created.id, r.status === "cancelled" ? "reservation.cancelled" : "reservation.created");
    return created.id;
  } catch (err) {
    // DEDUPE-HIT on @@unique([propertyId, sourceReference]) ONLY: a racing
    // sync created the canonical row between our lookup and this insert —
    // adopt it (field updates catch up on the next pass).
    if (isUniqueViolation(err, ["propertyId", "sourceReference"])) {
      const raced = await db.reservation.findFirst({ where: { propertyId, sourceReference: srcRef }, select: { id: true } });
      if (raced) return raced.id;
    }
    throw err;
  }
}

/**
 * Canonical thread'i yaz: konuşma create/update + mesajlar (kronolojik, kimlikle
 * dedupe, adopt-and-heal), imleçler döngü bitince ilerler. Event: conversation.created ·
 * conversation.updated (yeni mesaj ya da alan değişti) · message.imported (satır başına).
 */
export async function importCanonicalThread(
  db: ErasureDb,
  propertyId: string,
  reservation: CanonicalReservation,
  messages: CanonicalMessage[],
  localReservationId: string | null,
  ctx: IngestContext,
  /** KVKK explicit-erasure cutoff for a tombstoned guest's ALLOWED new stay. Null = no tombstone. */
  erasureCutoff: Date | null = null,
): Promise<{ imported: number; unimportable: number; supplyJobs: SupplyJob[] }> {
  const reservationId = reservation.externalId;

  // IDENTITY LOCK — the FIRST thing this transaction does for this thread.
  await acquireConversationIdentityLock(db, propertyId, reservationId);
  const channel = reservation.channel;
  const language = reservation.conversationLanguage ?? "tr";
  const lastMessageAt = reservation.lastMessageAt ?? new Date();

  // Chronological order so the last element is the most recent message (sağlayıcı SIRALAMAZ).
  const ordered = [...messages].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));

  const resolvedGuestName =
    reservation.guest.name ?? ordered.find((m) => m.direction === "inbound")?.senderName ?? null;
  const guestName = resolvedGuestName ?? (reservation.code ? `Rezervasyon ${reservation.code}` : "Misafir");

  // Status reflects who spoke last: guest → awaiting a reply ("new"); host → "answered".
  const lastMessage = ordered[ordered.length - 1];
  const computedStatus = lastMessage && lastMessage.direction === "inbound" ? "new" : "answered";

  // CANONICAL READ — authoritative because it runs INSIDE the identity lock.
  const existing = await db.conversation.findFirst({
    where: { propertyId, externalReservationId: reservationId },
    select: { id: true, status: true, reservationId: true, guestIdentifier: true, skippedReason: true, connectionId: true },
  });
  if (__importThreadHooks.afterCanonicalRead) await __importThreadHooks.afterCanonicalRead();

  // Cursor idempotency: create with a conservative value / keep the old value on
  // update, then bump to `lastMessageAt` only after the loop completes.
  const createCursor = ordered[0]?.createdAt ?? lastMessageAt;

  let conversationId: string;
  let scrubbedThread = false;
  let conversationTouched = false;
  if (!existing) {
    let createScrubbed = false;
    if (localReservationId) {
      const linked = await db.reservation.findUnique({ where: { id: localReservationId }, select: { guestName: true } });
      createScrubbed = linked?.guestName === ANON_NAME;
    }
    scrubbedThread = createScrubbed;
    const created = await db.conversation.create({
      data: {
        propertyId,
        channel,
        guestIdentifier: createScrubbed ? ANON_ID : guestName,
        status: computedStatus,
        priority: "standard",
        lastMessageAt: createCursor, // bumped to the real latest after the loop
        // syncCursorAt stays NULL until the message loop FULLY succeeds (idempotency).
        reservationId: localReservationId,
        externalReservationId: reservationId,
        externalConversationId: reservation.conversationExternalId,
        connectionId: ctx.connectionId ?? undefined,
        connectionEvidence: ctx.connectionId ? "ingest" : undefined,
        ingestedAt: new Date(),
      },
      select: { id: true },
    });
    conversationId = created.id;
    await emit(db, ctx, "conversation", conversationId, "conversation.created");
  } else {
    // Preserve human/rule decisions; only refresh the automatic states.
    const preserve = ["problem", "closed", "waiting"].includes(existing.status);
    let scrubbed: boolean;
    if (localReservationId) {
      const linked = await db.reservation.findUnique({ where: { id: localReservationId }, select: { guestName: true } });
      scrubbed = linked?.guestName === ANON_NAME;
    } else {
      scrubbed = existing.guestIdentifier === ANON_ID;
    }
    scrubbedThread = scrubbed;
    const data: Prisma.ConversationUncheckedUpdateInput = {
      // Only ever write a REAL name (never the placeholder) and never onto a scrubbed stay.
      ...(scrubbed || resolvedGuestName === null || resolvedGuestName === existing.guestIdentifier
        ? {}
        : { guestIdentifier: resolvedGuestName }),
      ...(preserve || computedStatus === existing.status ? {} : { status: computedStatus }),
      // Backfill the reservation link only when it's currently empty — never overwrite.
      ...(localReservationId && !existing.reservationId ? { reservationId: localReservationId } : {}),
      ...(ctx.connectionId && !existing.connectionId ? { connectionId: ctx.connectionId, connectionEvidence: "observed" } : {}),
    };
    if (Object.keys(data).length > 0) {
      await db.conversation.update({ where: { id: existing.id }, data });
      conversationTouched = Object.keys(data).some((k) => k !== "connectionId" && k !== "connectionEvidence");
    }
    // ÇİTİN GERİ ALINMASI — yalnız bağ GEÇİŞİNDE, koşul WHERE'de (yarış yok).
    if (localReservationId && !existing.reservationId && !reservation.terminal) {
      await db.conversation.updateMany({
        where: { id: existing.id, skippedReason: "reservation_ended" },
        data: { autoReplyAttemptedAt: null, skippedReason: null },
      });
    }
    conversationId = existing.id;
  }

  // KVKK era filter (time-based anonymization) + explicit-erasure cutoff; stricter wins.
  const retention = scrubbedThread ? retentionCutoff() : null;
  const eraCutoff = retention && erasureCutoff ? (retention > erasureCutoff ? retention : erasureCutoff) : (retention ?? erasureCutoff);

  // Load THIS conversation's existing message externalIds ONCE (N+1 yok).
  const seenExternalIds = new Set(
    (await db.message.findMany({ where: { conversationId, externalId: { not: null } }, select: { externalId: true } })).map(
      (row) => row.externalId!,
    ),
  );
  let newMessages = 0;
  let unimportable = 0;
  const supplyJobs: SupplyJob[] = [];
  const createdMessageIds: string[] = [];
  for (const m of ordered) {
    const externalId = m.externalId;
    const body = m.body;
    // Boşluktan ibaret gövde bilgi taşımaz → atla (oto-gönderim yüzeyi daralır; sayılır).
    if (!externalId || !body || !body.trim()) {
      unimportable++;
      continue;
    }
    if (eraCutoff) {
      const at = m.createdAt;
      if (!at || at <= eraCutoff) continue; // fail-closed for privacy
    }

    if (seenExternalIds.has(externalId)) continue;
    seenExternalIds.add(externalId);

    const inbound = m.direction === "inbound";
    if (!inbound) {
      // Adopt-and-heal: claim the OLDEST un-ID'd local outbound row with the same text.
      const orphan = await db.message.findFirst({
        where: { conversationId, direction: "outbound", externalId: null, body },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (orphan) {
        try {
          await db.message.update({ where: { id: orphan.id }, data: { externalId } });
        } catch (err) {
          if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
        }
        continue;
      }
    }
    let created: { id: string };
    try {
      created = await db.message.create({
        data: {
          conversationId,
          direction: inbound ? "inbound" : "outbound",
          authorType: inbound ? "guest" : "host",
          senderName: m.senderName ?? (inbound ? guestName : "Ev sahibi"),
          body,
          language,
          externalId,
          createdAt: m.createdAt ?? undefined,
          // V0.4 provenance: sağlayıcıdan gelen HER iki yön ingest edilmiştir.
          connectionId: ctx.connectionId ?? undefined,
          connectionEvidence: ctx.connectionId ? "ingest" : undefined,
          ingestedAt: new Date(),
        },
        select: { id: true },
      });
    } catch (err) {
      // DEDUPE-HIT on @@unique([conversationId, externalId]) ONLY.
      if (isUniqueViolation(err, ["conversationId", "externalId"])) continue;
      throw err;
    }
    newMessages++;
    createdMessageIds.push(created.id);
    if (inbound) {
      supplyJobs.push({ propertyId, message: body, sourceMessageId: created.id, reservationId: localReservationId });
    }
  }

  if (createdMessageIds.length) {
    await db.ingestEvent.createMany({
      data: createdMessageIds.map((id) => ({
        organizationId: ctx.organizationId,
        provider: ctx.provider,
        connectionId: ctx.connectionId,
        entityType: "message",
        entityId: id,
        kind: "message.imported",
        schemaVersion: INGEST_EVENT_SCHEMA_VERSION,
      })),
    });
  }
  if (existing && (conversationTouched || newMessages > 0)) {
    await emit(db, ctx, "conversation", conversationId, "conversation.updated");
  }

  // All messages are now written — safe to advance the cursors to the provider's latest.
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt, syncCursorAt: lastMessageAt } });

  return { imported: newMessages, unimportable, supplyJobs };
}
