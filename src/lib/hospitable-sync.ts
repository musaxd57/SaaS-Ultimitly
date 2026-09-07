import "server-only";

import { Prisma } from "@prisma/client";
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
import { getActiveConnection } from "@/lib/channels/connections";
import { reportError, redactSensitive } from "@/lib/report-error";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { recordSupplyRequestFromMessage, sweepMissedSupplyDerivations } from "@/lib/supply";
import { billingEnforced, getEntitlement, isFounderOrg } from "@/lib/billing/subscription";
import { ANON_NAME, ANON_ID, retentionCutoff } from "@/lib/data-retention";
import { loadErasureGuard, acquireErasureLock } from "@/lib/erasure";
import type { ErasureDb, ErasureGuard } from "@/lib/erasure";

/** A deferred supply-detection call — executed only AFTER the thread's
 *  write-transaction commits (the message FK must exist). */
type SupplyJob = Parameters<typeof recordSupplyRequestFromMessage>[0];

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
  /**
   * Sağlayıcıda VAR ama yerel `Reservation` satırı YAZILAMADI (tarih çözülemedi /
   * mülk yok / upsert fırladı). Bu konaklamanın thread'i REZERVASYONSUZ doğar:
   * takvim, doluluk raporu ve yaşam-döngüsü mesajları onu hiç görmez, ve
   * oto-yanıtın iptal/bitmiş kapısı `if (conversation.reservation)` bloğunun
   * içinde olduğu için o konuşmada HİÇ değerlendirilmez (çit için bkz.
   * `fenceUnlinkedTerminalStay`). Sayaç 07-31'de beş kardeşine eklenmişti; bu
   * yol açıkta kalmıştı (denetim, 08-01).
   */
  reservationsUnwritable: number;
  /**
   * Sağlayıcı bir mesaj DÖNDÜ ama gövdesi boş/metin-dışı olduğu için içe
   * AKTARILAMADI (`importThread`: `if (!externalId || !body) continue`).
   *
   * 🚨 NEDEN SAYILIYOR (denetim, 08-06): bu atlama SESSİZ ve KALICI. Atlanan
   * mesaj `syncCursorAt`'i durdurmuyor — imleç geçiş sonunda yine ilerliyor —
   * dolayısıyla o mesaj bir daha HİÇ değerlendirilmiyor. Misafir yalnızca
   * fotoğraf/ek gönderdiyse (gövde boş) host bunu gelen kutusunda HİÇ görmez ve
   * AI kapısı da hiç çalışmaz: misafir cevapsız kalır, hiçbir yerde iz yoktur.
   *
   * ⚠️ DAVRANIŞ BİLEREK DEĞİŞTİRİLMEDİ, yalnız GÖRÜNÜR yapıldı. Boş gövdeli
   * satırı yer-tutucu metinle içe aktarmak, sağlayıcının hangi olay tiplerinde
   * boş gövde döndüğünü BİLMEDEN yapılırsa gelen kutusunu sistem satırlarıyla
   * doldurabilir ve o satırlar AI kapısını da besler. Hospitable'ın gerçek
   * payload'ı görülmeden (Nuve aboneliği 402) bu doğrulanamaz — bu yüzden önce
   * ÖLÇÜM: sayaç sıfır kalırsa ortada sorun yoktur, sıfırdan büyürse gerçek
   * payload elimizde demektir ve karar veriye dayanır. Kardeşi:
   * `reservationsUnwritable` (aynı desen, 08-01).
   */
  messagesUnimportable: number;
}

/** Per-sync-run counter so linkProperty can refuse to CREATE past the plan's
 * property limit. Never blocks a property that's already linked/re-adopted —
 * only caps brand-new growth, so nothing existing is ever affected. */
type PropertyLimitState = { limit: number; current: number } | null;

async function resolvePropertyLimitState(organizationId: string): Promise<PropertyLimitState> {
  if (!billingEnforced()) return null; // dormant — matches canAddProperty's own gate
  // Kurucu muafiyeti — `canAddProperty`nin AYNASI (denetim, 08-09). Burada
  // eksik olması daha sinsiydi: senkron `linkProperty`yi sessizce `null`
  // döndürüyor, yani kurucunun 8. ilanının rezervasyonları ve misafir mesajları
  // hiç içeri girmiyor, ekranda da bir hata çıkmıyordu (yalnız `propertiesCapped`).
  if (isFounderOrg(organizationId)) return null; // unlimited
  const ent = await getEntitlement(organizationId);
  if (ent.propertyLimit == null) return null; // unlimited (grandfathered or no-cap plan)
  const current = await prisma.property.count({ where: { organizationId } });
  return { limit: ent.propertyLimit, current };
}

// Per-row sync failures stay console-only (the run-level aggregate reportError
// pages ops), but the ERROR TEXT is scrubbed first: a validation-shaped Prisma
// error renders its input argument VALUES, which on these rows can include the
// guest's name/email/phone — Railway logs must never carry them (KVKK). Message
// only, no raw object/stack (the stack adds no PII but the object echoes inputs).
function scrubErr(err: unknown): string {
  return redactSensitive(err instanceof Error ? err.message : String(err));
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
    reservationsUnwritable: 0,
    messagesUnimportable: 0,
  };
  // Run-level aggregate for failed inline supply derivations (alerted once at
  // the end — a per-row alert would flood; a bare catch hid them entirely).
  let supplyFailures = 0;
  let firstSupplyError: unknown = null;
  // Mesaj içe aktarımı için AYNI görünürlük (denetim, 07-31 — ↓gerekçe).
  let threadImportFailures = 0;
  let firstThreadImportError: unknown = null;
  let linkFailures = 0;
  let firstLinkError: unknown = null;
  let reservationUpsertFailures = 0;
  let firstReservationError: unknown = null;
  /** Yalnız ETİKET taşır ("no_dates"/"no_property"/"upsert_threw") — sağlayıcı
   *  payload'ı ya da misafir verisi ASLA (KVKK). */
  let firstUnwritableReason: string | null = null;
  let fetchFailures = 0;
  let firstFetchError: unknown = null;

  // Multi-tenant: use THIS org's own Hospitable token. If it has no connection
  // (and isn't the primary org falling back to env), there is nothing to pull —
  // return immediately so one customer can never sync another's Airbnb data.
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return result;
  // V0.4 PROVENANCE: bu koşuda YARATILAN her satır org'un AKTİF bağlantısını + ilk alınma anını taşır;
  // gözlemlenen mevcut satırda yalnız NULL damga dolar. Null bağlantı (env fallback / legacy) →
  // damga UYDURULMAZ (ingestedAt create'te yine yazılır).
  const connectionId = (await getActiveConnection(organizationId, "hospitable"))?.id ?? null;

  // KVKK explicit-erasure gate (m40): one read per run; with zero tombstones the
  // guard is inert (nothing hashed, nothing checked). Non-empty → each incoming
  // reservation is matched below BEFORE any row is written.
  const erasureGuard = await loadErasureGuard(organizationId);

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
      // ⚠️ EN GENİŞ SESSİZ KAYIP: buraya düşen ilan `propertyMap`'e girmez, yani
      // O DAİRENİN rezervasyonları da mesajları da bu koşuda HİÇ işlenmez —
      // oto-yanıt ve şikayet eskalasyonu o daire için tamamen susar. Hata
      // deterministikse (P2002, FK, şema sürprizi) her koşuda tekrarlanır.
      // `console.error` Sentry'ye de uyarı e-postasına da GİTMEZ.
      console.error(`[Hospitable sync] linkProperty failed for ${hp.id}`, scrubErr(err));
      linkFailures++;
      if (firstLinkError === null) firstLinkError = err;
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
      // ⚠️ 401/403 DIŞINDAKİ HER ŞEY (404, 429, 5xx, ağ) buraya düşüyor ve
      // `console.error` Sentry'ye de uyarı e-postasına da GİTMEZ. Çağıranlar
      // `continue` ediyor: `listReservations` başarısız olursa O DAİRENİN tüm
      // rezervasyonları+mesajları, `listMessages` başarısız olursa O THREAD'in
      // yeni misafir mesajları hiç içeri alınmaz — oto-yanıt da şikayet
      // eskalasyonu da onları hiç görmez. Kardeş yollar (linkProperty,
      // rezervasyon upsert) aggregate sayaç aldı, bu ikisi açıkta kalmıştı.
      console.error(`[Hospitable sync] ${context}`, scrubErr(err));
      fetchFailures++;
      if (firstFetchError === null) firstFetchError = err;
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

      // KVKK erasure semantics: an explicitly-erased stay (source_reference
      // tombstone) never re-imports — that object IS the erased data (Regulation
      // art. 8: "tekrar kullanılamaz"). A PERSON match (guest id/email/phone)
      // blocks any stay that BEGINS at/before the request (arrival ≤ erasedAt;
      // unknown arrival fails closed); only a stay beginning AFTER it is NEW data
      // (§8c-3). Decided by ARRIVAL so an ongoing/overlapping stay at request time
      // isn't mistaken for new activity (Codex P2).
      const g = reservation.guest;
      const guardInput = {
        guestExternalId: g?.id ? String(g.id) : null,
        guestEmail: str(g?.email) ?? null,
        guestPhone: str(g?.phone) ?? null,
      };
      const arrival = parseDate(reservation.arrival_date) ?? parseDate(reservation.check_in);
      const erasureBlocks = (guard: ErasureGuard): boolean =>
        !guard.isEmpty &&
        (guard.blocksSourceReference(String(reservation.id)) ||
          guard.blocksGuestStay(guardInput, arrival));

      // Cheap PRE-fetch gate on the run-start guard — an OPTIMIZATION ONLY
      // (saves the message fetch). It is never the write authority: the
      // authoritative check re-reads the guard INSIDE each write-transaction
      // below, under the erasure advisory lock (two-orderings guarantee).
      if (erasureBlocks(erasureGuard)) {
        result.skipped++;
        continue;
      }

      // Store the reservation (guest, dates, status) — drives the dashboard and
      // the welcome message. Guarded so one bad record can't abort the sync.
      // WRITE-TX #1: the upsert runs inside the org-scoped erasure lock with a
      // FRESH guard read — either this commits before an erasure (which then
      // masks it) or it sees the erasure's tombstones and refuses (RACE MODEL).
      let localReservationId: string | null = null;
      try {
        const r1 = await prisma.$transaction(
          async (tx) => {
            await acquireErasureLock(tx, organizationId);
            const fresh = await loadErasureGuard(organizationId, tx);
            if (erasureBlocks(fresh)) return { blocked: true as const, id: null };
            return {
              blocked: false as const,
              id: await upsertReservationCalendar(tx, propertyId, reservation, connectionId),
            };
          },
          { timeout: 60_000, maxWait: 15_000 },
        );
        if (r1.blocked) {
          result.skipped++;
          continue;
        }
        localReservationId = r1.id;
        if (!localReservationId) {
          // `upsertReservationCalendar` null döndü: tarih çözülemedi ya da mülk
          // satırı yok. Sessiz kalmasın — kardeş sayaçların emsali.
          result.reservationsUnwritable++;
          if (firstUnwritableReason === null) {
            firstUnwritableReason =
              parseDate(reservation.arrival_date) && parseDate(reservation.departure_date)
                ? "no_property"
                : "no_dates";
          }
        }
        if (localReservationId) {
          result.reservations++;
          // Auto-create check-in/cleaning tasks for this booking (idempotent,
          // best-effort) — AFTER the commit so the FK target exists and the
          // lock is held only for the write itself.
          await createReservationTasks(localReservationId).catch(() => {});
          // If the booking flipped to cancelled, remove its still-pending auto
          // tasks. No-op for active bookings. Best-effort.
          await removeAutoTasksForCancelledReservation(localReservationId).catch(() => {});
        }
      } catch (err) {
        // Buraya düşmek "bu rezervasyon satırı DB'ye hiç yazılmadı" demektir:
        // takvim, doluluk raporu ve karşılama/giriş/çıkış mesajları o konaklamayı
        // hiç görmez. Aynı sessiz sınıf, aynı aggregate çözüm.
        console.error(`[Hospitable sync] reservation upsert failed for ${reservation.id}`, scrubErr(err));
        reservationUpsertFailures++;
        if (firstReservationError === null) firstReservationError = err;
        // Fırlayan upsert de "yerel satır yazılamadı" demektir: `continue`
        // EDİLMİYOR (misafir mesajı kaybolmasın) → thread yine bağsız doğar.
        result.reservationsUnwritable++;
        if (firstUnwritableReason === null) firstUnwritableReason = "upsert_threw";
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
            // Skip-check cursor = syncCursorAt, NOT lastMessageAt. lastMessageAt is
            // stamped with wall-clock now() by outbound paths (auto-reply, manual
            // reply, outbox), so it can exceed a guest message that arrived in the
            // fetch→reply window and would then be wrongly skipped (message loss).
            // syncCursorAt is written ONLY by this sync (the provider's
            // reservation.last_message_at) and never by outbound, so it stays on the
            // provider's time axis and doesn't depend on any message's created_at.
            // null → never-synced → don't skip (import), so the cursor backfills.
            select: { id: true, reservationId: true, syncCursorAt: true, skippedReason: true },
          });
          if (existingConv?.syncCursorAt && existingConv.syncCursorAt >= incomingLast) {
            // Up to date — skip the message fetch (rate-limit saver). But still
            // backfill the reservation link if it's missing, so an already-imported
            // thread gets its correct guest/dates context (and the ended-booking
            // gate) without waiting for the next new message. One-time, never
            // overwrites an existing link.
            if (localReservationId && !existingConv.reservationId) {
              // ⚠️ ÇİTİN GERİ ALINMASI (denetim, 08-01 — üçüncü tur).
              // `fenceUnlinkedTerminalStay` damgayı BAĞSIZ + ölü konaklamaya basar.
              // Bağ kurulduğunda konaklama artık ölü DEĞİLSE damga kalırsa misafirin
              // o mesajı KALICI cevapsız kalır ve host AKTİF bir rezervasyonun
              // üstünde "Konaklama bitti/iptal" okur.
              // ⚠️ Yalnız BAĞ GEÇİŞİNDE (null→X) koşar → konuşma ömründe EN FAZLA
              //    BİR KEZ; çalkalama (her turda yaz-sil) yapısal olarak imkânsız.
              // ⚠️ Yalnız sebebi ÇİTİN KENDİ sebebi olan satırda temizlenir; gerçek
              //    bir sebep (`low_confidence_or_risky`, `escalated_to_human`) ASLA ezilmez.
              // ⚠️ İKİ AYRI YAZMA, ÇÜNKÜ İKİ AYRI KOŞUL (denetim, 08-01 — üçüncü
              // tur, ajan bulgusu). Bağ yazması `reservationId: null` ile atomik;
              // ama sebep temizliğini OKUNAN değere göre yapmak yarış açıyordu:
              // okuma ile yazma arasında `applyChannelAutoReply` (bu kilidin
              // DIŞINDA koşar) gerçek bir sebep yazarsa — `escalated_to_human`,
              // `low_confidence_or_risky` — sessizce silinirdi. Sebep koşulu artık
              // WHERE'de: temizlik ancak satır HÂLÂ çitin kendi sebebini
              // taşıyorsa gerçekleşir.
              // ⚠️ TEK TRANSACTION (denetim, 08-01 — üçüncü tur, ajan bulgusu).
              // İki ayrı yazma olarak bırakılırsa BİRİNCİSİ tek-atımlık
              // `reservationId: null` geçişini TÜKETİR; ikincisi düşerse konuşma
              // KALICI `reservation_ended` kalır ve `importThread`'in aynı onarımı
              // da devreye giremez (`!existing.reservationId` artık YANLIŞ) →
              // misafirin bekleyen mesajı cevapsız, host AKTİF rezervasyonda
              // "Konaklama bitti" okur. Sıra korunur; ikisi birlikte ya olur ya olmaz.
              await prisma.$transaction([
                prisma.conversation.updateMany({
                  where: { id: existingConv.id, reservationId: null },
                  data: { reservationId: localReservationId },
                }),
                ...(isTerminalStay(reservation)
                  ? []
                  : [
                      prisma.conversation.updateMany({
                        where: { id: existingConv.id, skippedReason: "reservation_ended" },
                        data: { autoReplyAttemptedAt: null, skippedReason: null },
                      }),
                    ]),
              ]);
            } else if (
              !localReservationId &&
              !existingConv.reservationId &&
              isTerminalStay(reservation)
            ) {
              // Mesaj yok ama thread güncel: bağsız + iptal konuşma burada da
              // adaylıktan düşmeli, yoksa yeni mesaj gelene kadar aday kalır.
              await fenceUnlinkedTerminalStay(propertyId, String(reservation.id), incomingLast);
            }
            result.skipped++;
            continue; // already up to date — no network call needed
          }
        } catch (err) {
          // A transient DB error on the skip-check must NOT abort the whole
          // property's remaining reservations — log and fall through to a normal
          // import (which is idempotent), losing only this cycle's skip savings.
          console.error(`[Hospitable sync] skip-check failed for ${reservation.id}`, scrubErr(err));
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

      // WRITE-TX #2: thread import under the SAME lock + another FRESH guard
      // read (the provider fetch above deliberately happened OUTSIDE the lock).
      // The messageCutoffFor comes from the fresh guard, so a tombstoned guest's
      // allowed new stay still never re-imports pre-erasure lines.
      const runImportTx = () =>
        prisma.$transaction(
          async (tx) => {
            await acquireErasureLock(tx, organizationId);
            const fresh = await loadErasureGuard(organizationId, tx);
            if (erasureBlocks(fresh)) return null;
            return importThread(
              tx,
              propertyId,
              reservation,
              messages,
              localReservationId,
              fresh.isEmpty ? null : fresh.messageCutoffFor(guardInput),
              connectionId,
            );
          },
          { timeout: 180_000, maxWait: 15_000 },
        );
      try {
        // FORWARD-COMPATIBILITY with @@unique([propertyId, externalReservationId]).
        // The identity lock makes a same-thread P2002 unreachable BETWEEN two
        // lock-respecting importers, but a writer that bypasses the lock could
        // still win the race. PostgreSQL aborts the WHOLE transaction on a unique
        // violation, so the recovery cannot live inside it (a catch there would
        // run in an already-aborted tx) — it is a single bounded RETRY of the
        // transaction. The retry re-acquires the lock and its canonical read now
        // finds the winner's row, so it UPDATES instead of creating: no message is
        // lost and no second conversation appears. Dormant today (the constraint
        // does not exist yet), armed the moment the migration lands. Bounded to
        // ONE retry on purpose — a second failure is not a race, it is a bug, and
        // must surface rather than loop.
        let r2: Awaited<ReturnType<typeof runImportTx>>;
        try {
          r2 = await runImportTx();
        } catch (err) {
          if (!isUniqueViolation(err, ["propertyId", "externalReservationId"])) throw err;
          r2 = await runImportTx();
        }
        if (r2 === null) {
          result.skipped++;
          continue;
        }
        result.conversations++;
        result.messages += r2.imported;
        result.messagesUnimportable += r2.unimportable;
        // ⚠️ BAĞSIZ + KESİN ÖLÜ KONAKLAMA → oto-yanıt kapısını BURADA kapat
        // (denetim, 08-01). `localReservationId` null olmanın İKİ yolu var ve
        // İKİSİ DE YUKARIDA: (1) `upsertReservationCalendar` null döndü (tarih
        // çözülemedi / mülk yok), (2) REZERVASYON upsert TX'i fırladı — o catch
        // bilinçli olarak `continue` ETMİYOR ki misafir mesajı kaybolmasın.
        // ⚠️ THREAD-IMPORT TX'i fırlarsa akış aşağıdaki dış catch'e atlar ve bu
        // satıra HİÇ gelinmez — o durumda çit bir sonraki geçişte kapanır
        // (mesaj yoksa "zaten güncel" dalı, varsa buradan).
        if (!localReservationId && isTerminalStay(reservation)) {
          await fenceUnlinkedTerminalStay(propertyId, String(reservation.id), incomingLast);
        }
        // Deferred supply detection — the message FKs exist only after commit.
        // Failures are COUNTED for the run-level aggregate alert below (they
        // used to vanish in a bare catch), and the end-of-run sweep re-derives
        // anything missed, so a transient error is a delay — not permanent loss.
        for (const job of r2.supplyJobs) {
          try {
            await recordSupplyRequestFromMessage(job);
          } catch (err) {
            supplyFailures++;
            if (firstSupplyError === null) firstSupplyError = err;
          }
        }
      } catch (err) {
        // ⚠️ EN PAHALI SESSİZ KAYIP (denetim, 07-31). Buraya düşmek "bu
        // rezervasyonun MİSAFİR MESAJLARI hiç içeri alınmadı" demektir. Eskiden
        // yalnız `console.error` vardı ve `console.error` Sentry'ye de uyarı
        // e-postasına da GİTMEZ (yalnız `reportError` gider) — koşu raporu ise
        // `messages: 0, ok: true` diyordu. Yani deterministik bir hata (TX
        // timeout, şema sürprizi) TÜM thread'leri düşürse kimse fark etmezdi.
        // Supply türetmesinin emsali burada da uygulanıyor: satır başına DEĞİL,
        // koşu başına TEK aggregate alarm (sağlayıcı komple düşerse sel olmasın).
        console.error(`[Hospitable sync] thread import failed for ${reservation.id}`, scrubErr(err));
        threadImportFailures++;
        if (firstThreadImportError === null) firstThreadImportError = err;
      }
    }
  }

  // Supply-derivation visibility + self-heal (Codex 07-24 #5). Before this, a
  // transient failure after the message committed was PERMANENT silent loss:
  // the next sync deduped the message by externalId and never re-emitted the
  // job. One aggregate alert per run (first sample + count — PII-free, the
  // error text is scrubbed inside reportError)…
  if (supplyFailures > 0) {
    void reportError(
      `supply-derivation org:${organizationId}`, // sayı context'te DEĞİL (↓throttle)
      new Error(
        `${supplyFailures} supply derivation(s) failed; first: ${
          firstSupplyError instanceof Error ? firstSupplyError.message : String(firstSupplyError)
        }`,
      ),
    );
  }
  // Mesaj içe aktarımı SUPPLY'DAN DAHA KRİTİK: supply bir yardımcı özellik,
  // bu ise ürünün girdisi. Aynı aggregate deseni, ayrı sayaç.
  if (fetchFailures > 0) {
    void reportError(
      `hospitable-fetch org:${organizationId}`, // sayı context'te DEĞİL (throttle)
      new Error(
        `${fetchFailures} Hospitable fetch(es) failed — those apartments/threads imported NOTHING this run; first: ${
          firstFetchError instanceof Error ? firstFetchError.message : String(firstFetchError)
        }`,
      ),
    );
  }
  if (linkFailures > 0) {
    void reportError(
      `property-link org:${organizationId}`,
      new Error(
        `${linkFailures} listing link(s) failed — those apartments imported NOTHING this run; first: ${
          firstLinkError instanceof Error ? firstLinkError.message : String(firstLinkError)
        }`,
      ),
    );
  }
  if (result.reservationsUnwritable > 0) {
    // ⚠️ SAYI CONTEXT'E GİRMEZ: `reportError` e-posta throttle'ını CONTEXT
    // string'iyle anahtarlıyor; sayı her koşuda değişirse her koşu YENİ anahtar
    // olur ve 10 dakikalık koruma fiilen kalkar (kardeş alarmların dersi).
    void reportError(
      `reservation-unwritable org:${organizationId}`,
      new Error(
        `${result.reservationsUnwritable} reservation(s) had no writable local row — ` +
          `their threads carry NO stay context (calendar/occupancy/lifecycle blind); ` +
          `first: ${firstUnwritableReason ?? "unknown"}`,
      ),
    );
  }
  if (result.messagesUnimportable > 0) {
    // ⚠️ SAYI CONTEXT'E GİRMEZ (kardeşinin dersi): `reportError` e-posta
    // throttle'ını CONTEXT string'iyle anahtarlıyor; sayı her koşuda değişirse
    // 10 dakikalık koruma fiilen kalkar ve 2 dakikalık cron her geçişte
    // bildirim üretir.
    void reportError(
      `message-unimportable org:${organizationId}`,
      new Error(
        `${result.messagesUnimportable} provider message(s) had an id but NO text body — ` +
          `skipped and NEVER re-evaluated (the sync cursor still advances). If a guest ` +
          `sent only a photo/attachment, the host never sees it and the AI gate never runs. ` +
          `Behaviour unchanged on purpose — this counter exists to decide with DATA whether ` +
          `to import a placeholder row (see SyncResult.messagesUnimportable).`,
      ),
    );
  }
  if (reservationUpsertFailures > 0) {
    void reportError(
      `reservation-upsert org:${organizationId}`,
      new Error(
        `${reservationUpsertFailures} reservation upsert(s) failed; first: ${
          firstReservationError instanceof Error
            ? firstReservationError.message
            : String(firstReservationError)
        }`,
      ),
    );
  }
  if (threadImportFailures > 0) {
    // ⚠️ SAYI CONTEXT'E GİRMEZ: `reportError` e-posta throttle'ını CONTEXT
    // string'iyle anahtarlıyor. Sayı her koşuda değiştiği için (5, sonra 6…)
    // her koşu YENİ bir anahtar olur ve 10 dakikalık koruma fiilen kalkar;
    // Sentry tarafında da tek arıza N ayrı Issue'ya bölünür. Sayı MESAJDA.
    void reportError(
      `thread-import org:${organizationId}`,
      new Error(
        `${threadImportFailures} thread import(s) failed; first: ${
          firstThreadImportError instanceof Error
            ? firstThreadImportError.message
            : String(firstThreadImportError)
        }`,
      ),
    );
  }
  // …and an idempotent sweep over the recent window re-derives whatever was
  // missed (dedupe on [sourceMessageId,itemKey] makes re-runs no-ops), so the
  // loss heals on the next cycle. Best-effort: never fails the sync itself.
  try {
    const sweep = await sweepMissedSupplyDerivations(organizationId);
    if (sweep.capped) {
      // No silent caps: the window hit the take-limit, older rows were not
      // rescanned this run (they get their turn as the window slides).
      console.warn(
        `[Hospitable sync] supply sweep hit its scan cap for org ${organizationId} (scanned ${sweep.scanned})`,
      );
    }
  } catch (err) {
    console.error("[Hospitable sync] supply sweep failed", scrubErr(err));
  }

  return result;
}

/**
 * Sağlayıcı durumunu KAPALI setimize eşler. MODÜL SEVİYESİNE ÇIKARILDI (denetim,
 * 08-01): artık yalnız satırı YAZAN yol değil, satırı YAZAMAYAN yol da aynı
 * kararı okuyabiliyor. Gövde birebir taşındı — davranış değişmedi.
 *
 * Terminal "hiç yaşanmadı" durumları (cancelled/declined/expired/not_possible/
 * denied) hepsi "cancelled"a düşer, böylece ölü bir talebe hiçbir yaşam-döngüsü
 * mesajı gitmez.
 */
function mapReservationStatus(
  reservation: HospitableReservation,
): "cancelled" | "pending" | "completed" | "confirmed" {
  const rawStatus =
    `${reservation.status ?? ""} ${reservation.reservation_status?.current?.category ?? ""}`.toLowerCase();
  return rawStatus.includes("cancel") ||
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
}

/**
 * "Bu konaklama bir daha yaşanmayacak."
 *
 * ⚠️ KÜME `automation.ts`'teki `reservation_ended` kapısının İKİ DALINI DA
 * karşılar (denetim, 08-01 — ikinci tur). O kapı hem "cancelled" hem
 * "departureDate < bugün" diyor; ilk yazımda yalnız "cancelled" alınmıştı ve
 * yorum "birebir aynı" diyordu — YANLIŞTI. Sonuç: bağsız + BİTMİŞ bir
 * konaklamanın thread'ine oto-yanıt gidiyordu, oysa BAĞLI olsaydı gitmezdi.
 * Tarih çözülemese bile sağlayıcı DURUMU okunabiliyor (düzeltmenin premisi
 * zaten bu), yani "completed" ayrımı elimizde.
 *
 * ⚠️ "pending"/"confirmed" (tarihsiz sorgu) BURAYA GİRMEZ — rezervasyon ÖNCESİ
 * soru bir SATIŞ FIRSATIDIR ve ona cevap vermek bilinçli ürün davranışıdır
 * (`prompts.ts` preBookingBlock, testle pinli). Kümeyi ORAYA genişletmek bir
 * ÜRÜN KARARIDIR, sessizce yapılmaz.
 */
function isTerminalStay(reservation: HospitableReservation): boolean {
  const st = mapReservationStatus(reservation);
  return st === "cancelled" || st === "completed";
}

/**
 * BAĞSIZ THREAD + KESİN ÖLÜ KONAKLAMA → oto-yanıt adaylığını kapat (denetim, 08-01).
 *
 * Tarihi çözülemeyen (ya da upsert'i fırlayan) bir rezervasyon için yerel satır
 * YAZILMIYOR; konuşma yine yaratılıyor ama `reservationId: null` ile. Oysa
 * `applyChannelAutoReply`'ın iptal/bitmiş konaklama kapılarının TAMAMI
 * `if (conversation.reservation)` bloğunun İÇİNDE — yani bağsız konuşmada o
 * kapı HİÇ değerlendirilmiyor ve İPTAL EDİLMİŞ bir konaklamaya otomatik cevap
 * gidebiliyor.
 *
 * ⚠️ YALNIZ `reservationId: null` satıra dokunulur: bağlı konuşmanın kapısı
 *    zaten çalışıyor, oraya dokunmak geçici bir upsert hatasında MEŞRU bir
 *    konuşmayı susturur.
 * ⚠️ Susturmayı `autoReplyAttemptedAt` yapar (aday sorgusunun
 *    `autoReplyAttemptedAt < lastMessageAt` koşulu); `skippedReason` yalnız
 *    HOST'A GÖRÜNÜRLÜK içindir ve GERÇEK bir sebebi EZMEZ.
 * ⚠️ KALICI SUSTURMA DEĞİL: misafir yeni mesaj yazarsa `lastMessageAt` damgayı
 *    geçer ve konuşma yeniden uygun olur; bir sonraki senkron hâlâ iptalse
 *    yeniden damgalar.
 */
async function fenceUnlinkedTerminalStay(
  propertyId: string,
  externalReservationId: string,
  providerLastMessageAt: Date | null,
): Promise<void> {
  // Damga thread damgasını KESİN geçmeli: sağlayıcı saati ileri olabilir ve
  // eşitlikte `<` koşulu yanlış tarafa düşerdi.
  const stamp = new Date(Math.max(Date.now(), (providerLastMessageAt?.getTime() ?? 0) + 1000));
  // ⚠️ TEK ATOMİK YAZMA + NO-OP KORUMASI (denetim, 08-01 — ikinci tur).
  // İlk yazımda İKİ ayrı `updateMany` vardı ve ikisi de koşulsuzdu:
  //   · birincisi geçip ikincisi düşerse konuşma SEBEPSİZ susturulmuş olurdu
  //     (host inbox'ta hiçbir açıklama görmez),
  //   · ve "zaten güncel" dalı her geçişte koştuğu için iptal edilmiş her bağsız
  //     thread'e 2 DAKİKADA BİR iki yazma düşüyordu (süresiz `updatedAt` çalkası).
  // Artık tek yazma ve yalnız GERÇEKTEN değişecek satıra dokunuyor.
  const res = await prisma.conversation
    .updateMany({
      where: {
        propertyId,
        externalReservationId,
        reservationId: null,
        // Zaten damgalı VE sebebi yazılmışsa yapacak iş yok.
        OR: [
          { autoReplyAttemptedAt: null },
          { autoReplyAttemptedAt: { lt: stamp } },
          { skippedReason: null },
        ],
      },
      data: { autoReplyAttemptedAt: stamp, skippedReason: "reservation_ended" },
    })
    .catch(() => null);
  // Sessiz `catch {}` bu repoda belgeli bir anti-desen. Çit düşerse iptal edilmiş
  // konaklamaya oto-yanıt gidebilir — iz bırakmadan geçmemeli.
  if (res === null) {
    void reportError(
      "fence-unlinked-terminal-stay",
      new Error(`property=${propertyId} — bağsız+ölü konaklamanın oto-yanıt çiti yazılamadı`),
    );
  }
}

/**
 * Upsert a Reservation row (guest, dates, status) from a Hospitable reservation.
 * Returns the local Reservation id so the caller can link the conversation to it
 * (correct guest/dates context), or null when nothing was written.
 */
async function upsertReservationCalendar(
  db: ErasureDb,
  propertyId: string,
  reservation: HospitableReservation,
  /** V0.4 provenance: org'un aktif bağlantısı. Create'te damga+ilk alınma; update'te yalnız NULL damga gözlemle dolar. */
  connectionId: string | null = null,
): Promise<string | null> {
  const srcRef = String(reservation.id);
  const arrivalDate = parseDate(reservation.arrival_date) ?? parseDate(reservation.check_in);
  const departureDate = parseDate(reservation.departure_date) ?? parseDate(reservation.check_out);
  if (!arrivalDate || !departureDate) return null;

  // FK safety: only write if the property genuinely exists.
  const propertyExists = await db.property.findUnique({
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

  const status = mapReservationStatus(reservation);

  const totalAmount =
    typeof reservation.total_price === "number" ? reservation.total_price : null;
  const currency = str(reservation.currency) ?? "EUR";

  const existing = await db.reservation.findFirst({
    where: { propertyId, sourceReference: srcRef },
    select: { id: true, guestName: true, connectionId: true },
  });

  if (existing) {
    // KVKK resurrection guard: once the retention sweep has anonymized this row
    // (guestName === ANON_NAME), NEVER let a re-sync write the guest's PII back
    // from the channel — the deep look-back can reach past the retention cutoff,
    // and Booking/direct channels return the real name forever. Dates/status
    // (non-PII) still refresh so occupancy stays correct.
    const scrubbed = existing.guestName === ANON_NAME;
    await db.reservation.update({
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
        // V0.4 provenance — GÖZLEMLE DOLDURMA: bu satır az önce O bağlantıdan gerçekten çekildi;
        // damga NULL ise kanıtla doldurulur (NULL→X). Dolu damga ASLA ezilmez (X→Y yok, X→NULL yok).
        // ingestedAt = ilk alınma; update yolu DOKUNMAZ (tekrar senkron eski satırı "yeni" göstermez).
        ...(connectionId && !existing.connectionId ? { connectionId, connectionEvidence: "observed" } : {}),
      },
    });
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
        arrivalDate,
        departureDate,
        channel,
        status,
        totalAmount: totalAmount ?? undefined,
        totalAmountDec: toAmountDec(totalAmount) ?? undefined,
        currency,
        sourceReference: srcRef,
        connectionId: connectionId ?? undefined,
        connectionEvidence: connectionId ? "ingest" : undefined,
        ingestedAt: new Date(),
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
      const raced = await db.reservation.findFirst({
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

  try {
    const created = await prisma.property.create({
      data: { organizationId, name, hospitableId: hp.id },
      select: { id: true },
    });
    if (limitState) limitState.current++;
    return created.id;
  } catch (err) {
    // ⚠️ YARIŞTA KAYBEDEN KOŞU İLANI BENİMSER (denetim, 08-01).
    //
    // `Property.hospitableId` GLOBAL `@unique`. İki koşu aynı ilanı aynı anda
    // yaratmaya kalkarsa (senkron kilidinin TTL'i uzun bir koşunun ortasında
    // dolarsa mümkün) kaybeden P2002 alır ve döngünün catch'i "link failure"
    // sayar → O DAİRENİN rezervasyon+mesajlarının TAMAMI o koşuda hiç işlenmez.
    // Kendiliğinden iyileşiyor (sonraki koşuda `findFirst` bulur) ama bir tur
    // kaybediliyor ve dosyanın kendi yorumu bunu "en geniş sessiz kayıp" diye
    // niteliyor.
    //
    // ⚠️ ARAMA ORG KAPSAMLI OLMAK ZORUNDA: kısıt GLOBAL olduğu için çakışma
    // BAŞKA BİR ORG'un satırından da gelebilir ve onu benimsemek ÇAPRAZ-KİRACI
    // VERİ SIZINTISI olurdu. Bulunamazsa hata FIRLAR (döngünün catch'i sayar +
    // koşu sonu toplu alarm) — sessizce yutulmaz.
    if (isUniqueViolation(err, ["hospitableId"])) {
      const raced = await prisma.property.findFirst({
        where: { organizationId, hospitableId: hp.id },
        select: { id: true },
      });
      // `limitState` ARTIRILMAZ: yeni satır yaratmadık, mevcut olanı bulduk.
      if (raced) return raced.id;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CONVERSATION IDENTITY LOCK (Faz A — unique migration'dan ÖNCE)
//
// KORUNAN INVARIANT: bir (propertyId, externalReservationId) çifti için EN FAZLA
// TEK Conversation satırı. `importThread` bugüne kadar bunu çıplak
// findFirst → create ile uyguluyordu; iki eşzamanlı koşucu (scheduled-sync
// SystemLock TTL'i uzun bir deep-sweep ortasında dolduğunda ikinci koşucu
// başlar) aynı rezervasyon için İKİ konuşma açabilir ve tüm mesajlar iki kez
// yazılır — 2026-07-26 prod preflight'ı tam olarak bu izi buldu (7 grup, her
// biri 2 satır, hepsinde AYNI externalConversationId = sağlayıcı tek thread
// vermiş, çift satır bizim yarışımız).
//
// NEDEN AYRI BİR KİLİT (erasure kilidi zaten varken):
//   · Erasure kilidi ORG kapsamlı ve amacı KVKK silme yarışı. Kimlik
//     invariant'ının onun yan etkisine yaslanması kırılgan: erasure yolu
//     değişirse/kaldırılırsa invariant SESSİZCE korumasız kalır.
//   · Kapsam doğru olsun: kilit rezervasyon kimliğinde, org'da değil — aynı
//     org'un farklı thread'leri paralel işlenmeye devam eder.
//   · Kilit `importThread`'in İÇİNDE alınır, çağıranın iyi niyetine bağlı
//     değildir: fonksiyonu kim çağırırsa çağırsın garanti onunla gelir.
//
// KİLİT SIRASI (deadlock önlemi): erasure(NS 40, org) → identity(NS 43, thread).
// Sync'in iki write-TX'i erasure kilidini ZATEN importThread'den önce alır;
// başka hiçbir yol NS 43'ü NS 40'tan önce almaz.
//
// PROVIDER FETCH KİLİDİN DIŞINDA: `listMessages` çağrısı bu TX'e girmeden önce
// yapılır (bkz. WRITE-TX #2 yorumu). Ağ gecikmesi kilidi tutmaz.
const CONVERSATION_IDENTITY_LOCK_NS = 43;

/**
 * Acquire the per-(property, provider-reservation) advisory lock on THIS
 * transaction (auto-released at commit/rollback). $executeRaw, not $queryRaw:
 * pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
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

/**
 * TEST-ONLY seam: bir gecikme enjekte ederek "canonical satırı okudum ama henüz
 * yazmadım" penceresini yapay olarak genişletir. Üretimde `null` → sıfır maliyet,
 * sıfır davranış. (iCal `__reconcileHooks` deseninin aynısı.)
 */
export const __importThreadHooks: { afterCanonicalRead: null | (() => Promise<void>) } = {
  afterCanonicalRead: null,
};

/**
 * Create/update the conversation for a reservation and import its new messages.
 *
 * Exported so the parallel-import race test can drive two of these concurrently
 * against a real PostgreSQL; production callers stay inside this module.
 */
export async function importThread(
  db: ErasureDb,
  propertyId: string,
  reservation: HospitableReservation,
  messages: HospitableMessage[],
  localReservationId: string | null,
  /** KVKK explicit-erasure cutoff for a tombstoned guest's ALLOWED new stay:
   *  messages at/before this instant never (re-)import. Null = no tombstone. */
  erasureCutoff: Date | null = null,
  /** V0.4 provenance: org'un aktif bağlantısı. Create'te damga+ilk alınma; update'te yalnız NULL damga gözlemle dolar. */
  connectionId: string | null = null,
): Promise<{ imported: number; unimportable: number; supplyJobs: SupplyJob[] }> {
  const reservationId = String(reservation.id);

  // IDENTITY LOCK — the FIRST thing this transaction does for this thread, so the
  // canonical read below and the create/update that follows are one indivisible
  // step against any concurrent importer of the SAME thread. Transaction-scoped:
  // held until the caller's TX commits or rolls back, never leaked.
  await acquireConversationIdentityLock(db, propertyId, reservationId);
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

  // CANONICAL READ — authoritative because it runs INSIDE the identity lock: a
  // concurrent importer of this same thread is either fully committed (so we see
  // its row and UPDATE) or still blocked on the lock (so it will see ours).
  const existing = await db.conversation.findFirst({
    where: { propertyId, externalReservationId: reservationId },
    select: {
      id: true,
      status: true,
      reservationId: true,
      guestIdentifier: true,
      // Çitin geri alınması için gerekli (aşağıdaki bağ-backfill dalı).
      skippedReason: true,
      connectionId: true, // V0.4: yalnız NULL iken gözlemle doldurulur
    },
  });
  // Widen the read→write window on demand (tests only; null in production).
  if (__importThreadHooks.afterCanonicalRead) await __importThreadHooks.afterCanonicalRead();

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
    // KVKK resurrection guard on CREATE — mirrors the UPDATE branch below. If the
    // linked stay was anonymized by the retention sweep (guestName === ANON_NAME) —
    // a thread that first appears / re-appears AFTER the sweep (row deleted or a new
    // message arrives on an old, scrubbed booking) — we must NOT write the real
    // channel name, and the era filter (eraCutoff) must engage; otherwise re-importing
    // resurrects the scrubbed guest name + the redacted message bodies.
    let createScrubbed = false;
    if (localReservationId) {
      const linked = await db.reservation.findUnique({
        where: { id: localReservationId },
        select: { guestName: true },
      });
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
        // syncCursorAt stays NULL until the message loop FULLY succeeds. Writing
        // createCursor here would defeat the idempotency for a single-message (or
        // all-same-timestamp) thread where createCursor === incomingLast: the row
        // would be "current" the instant it's created, so if a message write then
        // throws (caught per-reservation above) the loop-end update never runs and
        // the next sync skips the thread — losing the message. null = never-synced
        // → import (never skip), and the loop-end update fills it in on success.
        // Link to the local reservation row (same property + same Hospitable
        // reservation id) so the AI replies with the correct guest/dates and
        // skips finished/cancelled bookings. Null when no reservation matched.
        reservationId: localReservationId,
        externalReservationId: reservationId,
        externalConversationId: str(reservation.conversation_id),
        connectionId: connectionId ?? undefined,
        connectionEvidence: connectionId ? "ingest" : undefined,
        ingestedAt: new Date(),
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
      const linked = await db.reservation.findUnique({
        where: { id: localReservationId },
        select: { guestName: true },
      });
      scrubbed = linked?.guestName === ANON_NAME;
    } else {
      scrubbed = existing.guestIdentifier === ANON_ID;
    }
    scrubbedThread = scrubbed;
    await db.conversation.update({
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
        //
        ...(localReservationId && !existing.reservationId
          ? { reservationId: localReservationId }
          : {}),
        // V0.4 provenance — gözlemle doldurma (NULL→X yalnız); ingestedAt = ilk alınma, dokunulmaz.
        ...(connectionId && !existing.connectionId ? { connectionId, connectionEvidence: "observed" } : {}),
      },
    });
    // ⚠️ ÇİTİN GERİ ALINMASI (denetim, 08-01 — üçüncü tur). Yukarıdaki
    // atlama-dalıyla AYNI kusur bu yolda da vardı ve BURASI DAHA KOLAY
    // TETİKLENİR: yeni mesaj gelen her thread buradan geçer.
    // `fenceUnlinkedTerminalStay` damgayı BAĞSIZ + ölü konaklamaya basar; bağ
    // kurulduğunda konaklama artık ölü DEĞİLSE damganın kalması misafiri KALICI
    // cevapsız bırakır ve host AKTİF rezervasyonda "Konaklama bitti" okur.
    //
    // ⚠️ AYRI ve KOŞULLU YAZMA: sebep temizliğini OKUNAN `existing.skippedReason`
    // değerine göre yapmak yarış açıyordu — okuma ile yazma arasında
    // `applyChannelAutoReply` (bu kilidin DIŞINDA koşar) gerçek bir sebep
    // yazarsa (`escalated_to_human`, `low_confidence_or_risky`) sessizce
    // silinirdi. Koşul artık WHERE'de. Yalnız bağ GEÇİŞİNDE koşar → ömürde en
    // fazla bir kez; çalkalama yapısal olarak imkânsız.
    if (localReservationId && !existing.reservationId && !isTerminalStay(reservation)) {
      await db.conversation.updateMany({
        where: { id: existing.id, skippedReason: "reservation_ended" },
        data: { autoReplyAttemptedAt: null, skippedReason: null },
      });
    }
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
  //
  // SCOPE (KVKK — do not overstate): the guards above implement the TIME-BASED
  // anonymization policy only (Law 6698 art. 7, ex-officio destruction when the
  // retention period ends). A guest's EXPLICIT erasure request (art. 11 via art. 7;
  // Deletion Regulation art. 12) is a SEPARATE regime: "silme" must leave the data
  // "hiçbir şekilde erişilemez ve tekrar kullanılamaz" (Regulation art. 8), so a
  // sync re-import after such a request would undo the erasure — that path needs a
  // DURABLE per-request tombstone (erasedAt cutoff), designed in
  // docs/DATA-RETENTION-ERASURE-DRAFT.md §8 and pending a legal decision. The
  // "newer messages import normally" behaviour here is a property of the
  // time-based policy, NOT a general KVKK rule.
  //
  // The EXPLICIT-erasure regime plugs in right here (m40): erasureCutoff carries a
  // tombstoned guest's erasedAt, so on their allowed NEW stay any pre-erasure
  // message still never re-imports. The two cutoffs merge (stricter wins).
  const retention = scrubbedThread ? retentionCutoff() : null;
  const eraCutoff =
    retention && erasureCutoff
      ? retention > erasureCutoff
        ? retention
        : erasureCutoff
      : retention ?? erasureCutoff;
  // Load THIS conversation's existing message externalIds ONCE, then check
  // membership in memory. Previously each incoming message ran its own findFirst
  // — an N+1 (one query per message) on every thread sync.
  const seenExternalIds = new Set(
    (
      await db.message.findMany({
        where: { conversationId, externalId: { not: null } },
        select: { externalId: true },
      })
    ).map((r) => r.externalId!),
  );
  let newMessages = 0;
  let unimportable = 0;
  const supplyJobs: SupplyJob[] = [];
  for (const m of ordered) {
    const externalId = m.id != null ? String(m.id) : null;
    const body = str(m.body);
    // ⚠️ `.trim()` ŞART — `str()` TRİMLEMİYOR (`"   ".length === 3` → truthy).
    // Bu testi yazarken ölçüldü (08-06): yalnız boşluktan ibaret bir gövde
    // bugüne kadar NORMAL bir mesaj gibi içe aktarılıyordu — gelen kutusunda boş
    // bir balon, konuşma "new", ve en kötüsü AI kapısı BOŞ bir mesaja cevap
    // üretmeye çalışıyordu (misafire boşluğa karşı otomatik yanıt gidebilirdi).
    // Boşluk hiçbir bilgi taşımadığı için atlamak SIFIR veri kaybeder ve
    // oto-gönderim yüzeyini DARALTIR — bu depoda güvenli yön daima budur.
    if (!externalId || !body || !body.trim()) {
      // 🚨 SESSİZ + KALICI ATLAMA — artık SAYILIYOR (denetim, 08-06). İmleç
      // (`syncCursorAt`) bu satır yüzünden durmuyor, geçiş sonunda yine
      // ilerliyor → atlanan mesaj bir daha HİÇ değerlendirilmiyor. Misafir
      // yalnızca fotoğraf/ek gönderdiyse host onu gelen kutusunda hiç görmez.
      // Davranış BİLEREK aynı (gerekçe: `SyncResult.messagesUnimportable`);
      // burada yapılan tek şey körlüğü kaldırmak.
      //
      // ⚠️ SAYAÇ KÜMÜLATİF DEĞİL, KOŞU-BAŞINA: gövdesiz mesaj hiç kalıcı
      // olmadığı için `seenExternalIds`'e de girmez → getirme penceresinde
      // durduğu SÜRECE her geçişte yeniden sayılır. Bu bilinçli: soru "kaç
      // farklı mesaj kayboldu" değil, "şu an kayıp mesaj ÜRETEN bir akış var
      // mı". Alarm zaten context-anahtarlı 10 dk throttle'a tabi (aşağıda),
      // yani her 2 dakikalık cron geçişi ayrı bir bildirim üretmez.
      unimportable++;
      continue;
    }
    if (eraCutoff) {
      const msgAt = parseDate(m.created_at);
      if (!msgAt || msgAt < eraCutoff) continue;
    }

    if (seenExternalIds.has(externalId)) continue;
    // Reserve it: past this point we WILL persist (or heal) a row carrying this
    // externalId, so a repeated id later in the SAME batch skips too — matching
    // the old per-message DB lookup that would have seen the just-written row.
    seenExternalIds.add(externalId);

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
      const orphan = await db.message.findFirst({
        where: { conversationId, direction: "outbound", externalId: null, body },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (orphan) {
        try {
          await db.message.update({ where: { id: orphan.id }, data: { externalId } });
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
      created = await db.message.create({
        data: {
          conversationId,
          direction: inbound ? "inbound" : "outbound",
          // Imported channel messages: inbound = the guest; outbound = the host's own
          // reply on the channel (our AI sends carry externalId and dedupe, so they are
          // not re-created here). authorType is the reliable classifier.
          authorType: inbound ? "guest" : "host",
          senderName: senderFullName(m) ?? (inbound ? guestName : "Ev sahibi"),
          body,
          language,
          externalId,
          createdAt: parseDate(m.created_at) ?? undefined,
          // V0.4 provenance: sağlayıcıdan gelen HER iki yön ingest edilmiştir.
          connectionId: connectionId ?? undefined,
          connectionEvidence: connectionId ? "ingest" : undefined,
          ingestedAt: new Date(),
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
    // Supply detection ("extra towel/sheet" ask → +1 to the prep plan) is
    // COLLECTED here and executed by the caller AFTER the write-transaction
    // commits: it references the just-created message id (FK), which does not
    // exist outside the transaction until commit. Best-effort as before.
    if (inbound) {
      supplyJobs.push({
        propertyId,
        message: body,
        sourceMessageId: created.id,
        reservationId: localReservationId,
      });
    }
  }

  // All messages are now written — safe to advance the cursors to the provider's
  // latest. If the loop above threw, execution never reaches here (the caller
  // catches), so the cursors stay behind and the next sync re-fetches the tail.
  // lastMessageAt = UI/auto-reply "last activity"; syncCursorAt = the outbound-
  // immune skip-check cursor. Unconditional so a null syncCursorAt (freshly added
  // column / first sync of an existing thread) always gets set — otherwise that
  // thread would be re-fetched every run and never start saving requests.
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt, syncCursorAt: lastMessageAt },
  });

  return { imported: newMessages, unimportable, supplyJobs };
}
