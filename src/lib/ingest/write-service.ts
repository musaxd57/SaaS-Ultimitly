import "server-only";

import { Prisma } from "@prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";
import { toAmountDec } from "@/lib/money";
import { ANON_NAME, ANON_ID, retentionCutoff } from "@/lib/data-retention";
import type { ErasureDb } from "@/lib/erasure";
import { followReservationDates } from "@/lib/tasks/follow-reservation";
import { givenNameForStorage, type GuestNameSource } from "@/lib/guest-name-source";
import { AUTOMATION_AUTHOR, canonicalChannelSenderRole } from "@/lib/message-author";
import { claimAutomatedSend, planAutomatedMatches } from "@/lib/automated-sends";
import type { recordSupplyRequestFromMessage } from "@/lib/supply";
import type { CanonicalMessage, CanonicalReservation } from "@/lib/channels/ingest";
import { channelMetadataWriteEnabled } from "@/lib/channels/metadata";
import { recordIngestEvent as emit, INGEST_EVENT_SCHEMA_VERSION } from "./events";
import type { IngestContext } from "./events";
import { REACTIVATION_BLOCKED_FIELD, REACTIVATION_NOTE_INTERVAL_MS } from "./reactivation";

/**
 * G9: kanal iptalli satırı yeniden etkin gösterdi → olay (günde en çok bir kez; 2 dakikalık senkron her geçişte yazmaz). Aynı işlemde
 * (satırla birlikte commit). Dikkat akışı bu olaydan "kontrol edin" satırı çıkarır.
 */
async function noteReactivationBlocked(db: ErasureDb, ctx: IngestContext, reservationId: string): Promise<void> {
  const recent = await db.ingestEvent.findFirst({
    where: {
      organizationId: ctx.organizationId,
      entityType: "reservation",
      entityId: reservationId,
      kind: "reservation.updated",
      changedFieldsJson: { contains: REACTIVATION_BLOCKED_FIELD },
      occurredAt: { gte: new Date(Date.now() - REACTIVATION_NOTE_INTERVAL_MS) },
    },
    select: { id: true },
  });
  if (recent) return;
  await emit(db, ctx, "reservation", reservationId, "reservation.updated", [REACTIVATION_BLOCKED_FIELD]);
}

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
  /** İsteğe bağlı çıktı: bu yazma rezervasyonu GERÇEKTEN iptale çevirdi mi (çağıran iptal temizliğini geçiş ile onarım arasında ayırır —
   *  kurucu D5, 10-15: onarım yalnız başlanmamış + dokunulmamış görevi siler). */
  out?: { cancelledNow?: boolean },
): Promise<string | null> {
  const srcRef = r.externalId;
  if (!r.arrivalDate || !r.departureDate) return null;
  // 🚨 Y6 (Codex 10-07): çıkış girişten sonra olmalı (iCal ayrıştırıcısıyla aynı kural) — ters / sıfır süreli tarih uydurma
  // konaklamadır; satır YAZILMAZ, var olan kayıt korunur (sayaç `reservationsUnwritable`).
  if (r.departureDate.getTime() <= r.arrivalDate.getTime()) return null;

  // FK safety: only write if the property genuinely exists.
  const propertyExists = await db.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!propertyExists) return null;

  // Resolve the real name separately from the placeholder fallback: on UPDATE we
  // only overwrite guestName when a real name is present, so a later sync where
  // the channel has masked the guest can't regress a stored name to "Misafir".
  const resolvedGuestName = r.guest.name;
  const guestName = resolvedGuestName ?? (r.code ? `Rezervasyon ${r.code}` : "Misafir");
  // Hitap adı YALNIZ kanalın ayrı ad alanından (migration 57, K10-o 09-28); tam addan bölünerek ÜRETİLMEZ.
  const givenName = givenNameForStorage(r.guest.givenName);
  const guestEmail = r.guest.email;
  const guestPhone = r.guest.phone;
  const guestExternalId = r.guest.externalId;
  const currency = r.currency ?? "EUR";

  // Ham platform adı (migration 60 B): anahtar açıkken ve sağlayıcı verdiyse; yalnız gösterim / teşhis (olay değildir).
  const sourcePlatform = channelMetadataWriteEnabled() ? (r.sourcePlatform ?? null) : null;
  const existing = await db.reservation.findFirst({
    where: { propertyId, sourceReference: srcRef },
    select: {
      id: true,
      guestName: true,
      guestEmail: true,
      guestPhone: true,
      guestExternalId: true,
      guestGivenName: true,
      guestNameSource: true,
      arrivalDate: true,
      departureDate: true,
      channel: true,
      status: true,
      totalAmount: true,
      currency: true,
      connectionId: true,
      // Anahtar kapalıyken yeni kolon OKUNMAZ (sorgu bugünküyle aynı).
      sourcePlatform: sourcePlatform !== null,
    },
  });

  if (existing) {
    // KVKK resurrection guard: once the retention sweep has anonymized this row
    // (guestName === ANON_NAME), NEVER let a re-sync write the guest's PII back.
    const scrubbed = existing.guestName === ANON_NAME;
    const data: Prisma.ReservationUncheckedUpdateInput = {};
    if (!scrubbed && resolvedGuestName !== null && resolvedGuestName !== existing.guestName) {
      data.guestName = resolvedGuestName;
      // Ad değişti: eski hitap adı yeni ada ait olmayabilir → kanalın verdiği (vermediyse boş) yazılır.
      if (givenName !== existing.guestGivenName) data.guestGivenName = givenName;
    } else if (!scrubbed && givenName !== null && givenName !== existing.guestGivenName) {
      // Ad aynı: hitap adı yalnız kanal VERDİĞİNDE yazılır (boş gelince eskisi silinmez — tam adla aynı kural).
      data.guestGivenName = givenName;
    }
    // Köken: kanal gerçek bir ad gönderdiyse "channel" (gözlem; eski NULL satır da damgalanır). Ad gelmediyse dokunulmaz — saklı ad
    // önceki bir senkronun gerçek adı da, bizim yer tutucumuz da olabilir.
    if (!scrubbed && resolvedGuestName !== null && existing.guestNameSource !== "channel") data.guestNameSource = "channel" satisfies GuestNameSource;
    if (!scrubbed && guestEmail !== null && guestEmail !== existing.guestEmail) data.guestEmail = guestEmail;
    if (!scrubbed && guestPhone !== null && guestPhone !== existing.guestPhone) data.guestPhone = guestPhone;
    if (!scrubbed && guestExternalId !== null && guestExternalId !== existing.guestExternalId) data.guestExternalId = guestExternalId;
    if (!sameInstant(r.arrivalDate, existing.arrivalDate)) data.arrivalDate = r.arrivalDate;
    if (!sameInstant(r.departureDate, existing.departureDate)) data.departureDate = r.departureDate;
    if (r.channel !== existing.channel) data.channel = r.channel;
    // 🚨 İPTAL EDİLMİŞ REZERVASYON KANALDAN KENDİLİĞİNDEN GERİ AÇILMAZ (G9, kurucu kararı 10-13 "Kanal açmasın, iCal aynı"; değişmez
    // 7 / 17). Eskiden durum koşulsuz yazılıyordu: iptalden sonra eski bir anlık görüntü ("accepted") gelirse satır yeniden onaylı olur,
    // karşılama / giriş göndericileri ve görev üretimi yeniden devreye girebilirdi. Artık satır iptal kalır; ev sahibine dikkat akışında
    // "kanal bu rezervasyonu yeniden etkin gösteriyor — kontrol edin" satırı düşer (↓ `noteReactivationBlocked`). Diğer alanlar aynen
    // eşitlenir. iCal aboneliği (`import/sync.ts`) ve elle dosya yükleme bu yoldan GEÇMEZ — kuralları değişmedi.
    const reactivationBlocked = existing.status === "cancelled" && r.status !== "cancelled";
    if (r.status !== existing.status && !reactivationBlocked) data.status = r.status;
    if (out) out.cancelledNow = data.status === "cancelled";
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
    // Köken / hitap adı alanları OLAY DEĞİLDİR (bağlantı damgası gibi): yalnız onlar değişince `reservation.updated` üretilmez,
    // alan listesine de girmez (olay şeması aynı kalır).
    if (sourcePlatform !== null && sourcePlatform !== existing.sourcePlatform) data.sourcePlatform = sourcePlatform;
    const isMetadataKey = (k: string) =>
      k === "connectionId" ||
      k === "connectionEvidence" ||
      k === "guestGivenName" ||
      k === "guestNameSource" ||
      k === "sourcePlatform";
    const contentChanged = Object.keys(data).some((k) => !isMetadataKey(k));
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
        Object.keys(data).filter((k) => !isMetadataKey(k)),
      );
    }
    if (reactivationBlocked) await noteReactivationBlocked(db, ctx, existing.id);
    return existing.id;
  }

  try {
    const created = await db.reservation.create({
      data: {
        propertyId,
        guestName,
        guestGivenName: givenName ?? undefined,
        guestNameSource: (resolvedGuestName !== null ? "channel" : "placeholder") satisfies GuestNameSource,
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
        sourcePlatform: sourcePlatform ?? undefined,
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

  // CANONICAL READ — authoritative because it runs INSIDE the identity lock.
  const existing = await db.conversation.findFirst({
    where: { propertyId, externalReservationId: reservationId },
    select: { id: true, status: true, reservationId: true, guestIdentifier: true, skippedReason: true, connectionId: true },
  });
  if (__importThreadHooks.afterCanonicalRead) await __importThreadHooks.afterCanonicalRead();

  // K7 (09-30) — BİZİM OTOMATİK MESAJIMIZ MI? Daha önce yazılmış satırın yazarı + yeni giden mesajların gönderim iziyle
  // SALT OKUMA eşleşmesi (`automated-sends.ts`; sahiplenme mesaj yazılırken). Otomatik şablon mesajı bir CEVAP değildir:
  // konuşma durumunu ve etkinlik anını belirlemez (↓). Thread kilidi altında: arada başka yazan yok.
  const storedRows = existing
    ? await db.message.findMany({
        where: { conversationId: existing.id, externalId: { not: null } },
        select: { externalId: true, authorType: true },
      })
    : [];
  const storedAuthor = new Map(storedRows.map((row) => [row.externalId!, row.authorType]));
  const automationPlan = await planAutomatedMatches(
    db,
    { organizationId: ctx.organizationId, propertyId, externalReservationId: reservationId },
    ordered
      .filter((m) => m.direction !== "inbound" && m.externalId && m.body && m.body.trim() && !storedAuthor.has(m.externalId))
      .map((m) => ({ externalId: m.externalId!, body: m.body!, createdAt: m.createdAt ?? null })),
  );
  const isAutomation = (m: CanonicalMessage): boolean =>
    !!m.externalId && m.direction !== "inbound" && (storedAuthor.get(m.externalId) === AUTOMATION_AUTHOR || automationPlan.has(m.externalId));

  // Status reflects who spoke last: guest → awaiting a reply ("new"); host / AI → "answered". Otomatik şablon mesajı
  // (K7) konuşan sayılmaz: misafirin cevapsız mesajından sonra giden karşılama / giriş mesajı konuşmayı cevaplamaz.
  const answeringOrdered = ordered.filter((m) => !isAutomation(m));
  const lastMessage = answeringOrdered[answeringOrdered.length - 1];
  const computedStatus = lastMessage && lastMessage.direction === "inbound" ? "new" : "answered";
  // Etkinlik anı (`lastMessageAt`): thread'in SONU otomatik mesajsa son gerçek mesajın anı — yoksa otomatik mesaj
  // konuşmayı oto-yanıt için yeniden "yeni" gösterir (aynı misafir mesajına ikinci değerlendirme) ve kapanış kararını
  // bayatlatır. İmleç (`syncCursorAt`) sağlayıcının anı kalır (thread her geçişte yeniden çekilmesin).
  const tailIsAutomation = ordered.length > 0 && isAutomation(ordered[ordered.length - 1]);
  const activityAt = tailIsAutomation && lastMessage?.createdAt ? lastMessage.createdAt : lastMessageAt;

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

  // THIS conversation's existing message externalIds (N+1 yok) — kilit altında yukarıda okundu; yeni konuşmada boş.
  const seenExternalIds = new Set(storedRows.map((row) => row.externalId!));
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
    // K7: gönderim izine bağlanan giden mesaj bizim otomatik mesajımızdır (bire bir sahiplenme; bağlanamazsa eski yol).
    const automation = inbound ? undefined : automationPlan.get(externalId);
    const isOurAutomation = automation ? await claimAutomatedSend(db, automation.recordId, externalId, new Date()) : false;
    // L5: kanal "otomasyon" dese de BİZİM kuyruktan gönderdiğimiz mesajsa (sağlayıcı kimliği kuyruk satırında) rol yazılmaz — sağlayıcı API ile
    // gideni otomasyon diye etiketleyebilir; kimlik iliştirmesi kaçmış ve gövde ufak farkla dönmüşse (sahiplenme tutmadı) ev sahibinin gerçek
    // cevabı öğrenmeden düşerdi (Haiku 10-17). Sorgu YALNIZ otomasyon rolünde (nadir) koşar.
    let channelSenderRole = canonicalChannelSenderRole(inbound ? "inbound" : "outbound", m.senderRole);
    if (channelSenderRole === "automation") {
      const ours = await db.messageOutbox.findFirst({ where: { conversationId, providerMessageId: externalId }, select: { id: true } });
      if (ours) channelSenderRole = null;
    }
    let created: { id: string };
    try {
      created = await db.message.create({
        data: {
          conversationId,
          direction: inbound ? "inbound" : "outbound",
          authorType: inbound ? "guest" : isOurAutomation ? AUTOMATION_AUTHOR : "host",
          senderName: m.senderName ?? (inbound ? guestName : "Ev sahibi"),
          body,
          language,
          externalId,
          createdAt: m.createdAt ?? undefined,
          // V0.4 provenance: sağlayıcıdan gelen HER iki yön ingest edilmiştir.
          connectionId: ctx.connectionId ?? undefined,
          connectionEvidence: ctx.connectionId ? "ingest" : undefined,
          ingestedAt: new Date(),
          // L5 (migration 71): kanalın bildirdiği gönderen rolü — kapalı küme + yönle tutarlılık çekirdekte (yazar alanı `authorType` otorite
          // kalır). Sahiplenme yolu (↑ yerel giden satıra kimlik iliştirme) rol YAZMAZ: o satır bizim gönderdiğimiz ev sahibi / yapay zekâ
          // mesajı; sağlayıcı API ile gideni "otomasyon" diye etiketlerse ev sahibinin gerçek cevabı öğrenmeden düşerdi.
          channelSenderRole,
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

  // All messages are now written — safe to advance the cursors to the provider's latest (etkinlik anı ↑ K7).
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: activityAt, syncCursorAt: lastMessageAt } });

  return { imported: newMessages, unimportable, supplyJobs };
}
