import "server-only";

import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { providerErrorStatus } from "@/lib/provider-errors";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { getActiveConnection } from "@/lib/channels/connections";
import { getIngestAdapter, type CanonicalMessage, type CanonicalReservation } from "@/lib/channels";
import {
  upsertCanonicalReservation,
  importCanonicalThread,
  acquireConversationIdentityLock,
  __importThreadHooks,
  type IngestContext,
} from "@/lib/ingest/write-service";
// V0.6: yazma katmanı ingest write service'e taşındı (canonical tipler, aynı TX'te domain
// event). Kimlik kilidi ve test kancası oradan re-export — mevcut çağıranlar için.
export { acquireConversationIdentityLock, __importThreadHooks };
import { reportError, redactSensitive } from "@/lib/report-error";
import { alertTracker } from "@/lib/alert-state";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { recordSupplyRequestFromMessage, sweepMissedSupplyDerivations } from "@/lib/supply";
import { billingEnforced, getEntitlement, isFounderOrg } from "@/lib/billing/subscription";
import { loadErasureGuard, acquireErasureLock } from "@/lib/erasure";
import type { ErasureGuard } from "@/lib/erasure";

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
   * payload'ı görülmeden (kurucu org aboneliği 402) bu doğrulanamaz — bu yüzden önce
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
  // V0.6: sağlayıcı okuması Channel Layer ingest adaptöründen (canonical tipler);
  // yazma ingest write service'ten (aynı TX'te domain event). Polling da webhook da bu yoldan.
  const adapter = getIngestAdapter("hospitable");
  if (!adapter) {
    void reportError(`ingest-adapter-missing org:${organizationId}`, new Error("hospitable ingest adapter not registered"));
    return result;
  }
  const credential = { provider: "hospitable" as const, token };
  const ctx: IngestContext = { organizationId, provider: "hospitable", connectionId };
  const hospitableProps = await adapter.listProperties(credential);
  // Live Hospitable listing ids this run — used so linkProperty never re-points a
  // property that still belongs to a different LIVE same-named listing.
  const liveIds = new Set<string>(
    hospitableProps.map((p) => p.externalId).filter((id): id is string => Boolean(id)),
  );
  const propertyMap = new Map<string, string>(); // hospitableId → our propertyId
  for (const hp of hospitableProps) {
    if (!hp.externalId) continue;
    try {
      const ourId = await linkProperty(organizationId, { id: hp.externalId, name: hp.name }, liveIds, limitState);
      if (!ourId) {
        result.propertiesCapped++;
        continue;
      }
      propertyMap.set(hp.externalId, ourId);
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
      console.error(`[Hospitable sync] linkProperty failed for ${hp.externalId}`, scrubErr(err));
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
  // Alarm koşu SONUNDA, diğer toplulaştırılmış alarmlarla birlikte ve geçiş tabanlı
  // (↓`opsAlarm`): kalıcı bir 401 artık 2 dakikada bir değil, bir kez bildirilir.
  let firstAuthError: unknown = null;
  const noteHospitableError = (context: string, err: unknown) => {
    // Sarmaldan bağımsız okuma TEK yerde (`provider-errors`; 09-23 olayı, sınıf pinli).
    const status = providerErrorStatus(err);
    if ((status === 401 || status === 403) && firstAuthError === null) {
      firstAuthError = err;
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
    let reservations: CanonicalReservation[];
    try {
      reservations = await adapter.listReservations(credential, { propertyExternalId: hospitableId, startDate, endDate });
    } catch (err) {
      noteHospitableError(`reservations failed for ${hospitableId}`, err);
      continue;
    }

    for (const reservation of reservations) {
      if (!reservation || !reservation.externalId) continue;

      // KVKK erasure semantics: an explicitly-erased stay (source_reference
      // tombstone) never re-imports — that object IS the erased data (Regulation
      // art. 8: "tekrar kullanılamaz"). A PERSON match (guest id/email/phone)
      // blocks any stay that BEGINS at/before the request (arrival ≤ erasedAt;
      // unknown arrival fails closed); only a stay beginning AFTER it is NEW data
      // (§8c-3). Decided by ARRIVAL so an ongoing/overlapping stay at request time
      // isn't mistaken for new activity (Codex P2).
      const guardInput = {
        guestExternalId: reservation.guest.externalId,
        guestEmail: reservation.guest.email,
        guestPhone: reservation.guest.phone,
      };
      const arrival = reservation.arrivalDate;
      const erasureBlocks = (guard: ErasureGuard): boolean =>
        !guard.isEmpty &&
        (guard.blocksSourceReference(reservation.externalId) ||
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
              id: await upsertCanonicalReservation(tx, propertyId, reservation, ctx),
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
          // `upsertCanonicalReservation` null döndü: tarih çözülemedi ya da mülk
          // satırı yok. Sessiz kalmasın — kardeş sayaçların emsali.
          result.reservationsUnwritable++;
          if (firstUnwritableReason === null) {
            firstUnwritableReason =
              reservation.arrivalDate && reservation.departureDate
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
        console.error(`[Hospitable sync] reservation upsert failed for ${reservation.externalId}`, scrubErr(err));
        reservationUpsertFailures++;
        if (firstReservationError === null) firstReservationError = err;
        // Fırlayan upsert de "yerel satır yazılamadı" demektir: `continue`
        // EDİLMİYOR (misafir mesajı kaybolmasın) → thread yine bağsız doğar.
        result.reservationsUnwritable++;
        if (firstUnwritableReason === null) firstUnwritableReason = "upsert_threw";
      }

      // Message thread import — only for reservations that have a conversation.
      if (!reservation.lastMessageAt) continue;
      result.threads++;

      // Skip threads that are UNCHANGED since our last import: only spend a
      // Hospitable API request when the thread genuinely has a newer message.
      // This keeps the per-run request count low so busy accounts (many
      // listings) don't exhaust the rate limit before reaching new messages.
      const incomingLast = reservation.lastMessageAt;
      if (incomingLast) {
        try {
          const existingConv = await prisma.conversation.findFirst({
            where: { propertyId, externalReservationId: reservation.externalId },
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
                ...(reservation.terminal
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
              reservation.terminal
            ) {
              // Mesaj yok ama thread güncel: bağsız + iptal konuşma burada da
              // adaylıktan düşmeli, yoksa yeni mesaj gelene kadar aday kalır.
              await fenceUnlinkedTerminalStay(propertyId, reservation.externalId, incomingLast);
            }
            result.skipped++;
            continue; // already up to date — no network call needed
          }
        } catch (err) {
          // A transient DB error on the skip-check must NOT abort the whole
          // property's remaining reservations — log and fall through to a normal
          // import (which is idempotent), losing only this cycle's skip savings.
          console.error(`[Hospitable sync] skip-check failed for ${reservation.externalId}`, scrubErr(err));
        }
      }

      let messages: CanonicalMessage[];
      try {
        messages = await adapter.listMessages(credential, reservation.externalId);
      } catch (err) {
        noteHospitableError(`messages failed for ${reservation.externalId}`, err);
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
            return importCanonicalThread(
              tx,
              propertyId,
              reservation,
              messages,
              localReservationId,
              ctx,
              fresh.isEmpty ? null : fresh.messageCutoffFor(guardInput),
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
        // İKİSİ DE YUKARIDA: (1) `upsertCanonicalReservation` null döndü (tarih
        // çözülemedi / mülk yok), (2) REZERVASYON upsert TX'i fırladı — o catch
        // bilinçli olarak `continue` ETMİYOR ki misafir mesajı kaybolmasın.
        // ⚠️ THREAD-IMPORT TX'i fırlarsa akış aşağıdaki dış catch'e atlar ve bu
        // satıra HİÇ gelinmez — o durumda çit bir sonraki geçişte kapanır
        // (mesaj yoksa "zaten güncel" dalı, varsa buradan).
        if (!localReservationId && reservation.terminal) {
          await fenceUnlinkedTerminalStay(propertyId, reservation.externalId, incomingLast);
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
        console.error(`[Hospitable sync] thread import failed for ${reservation.externalId}`, scrubErr(err));
        threadImportFailures++;
        if (firstThreadImportError === null) firstThreadImportError = err;
      }
    }
  }

  // 🚨 GEÇİŞ TABANLI (09-23 olayının sınıf düzeltmesi): bu toplulaştırılmış alarmların
  // hepsi 2 dakikalık döngüde HER koşuda yeniden ateşleniyordu; kalıcı bir durum (ör. hiç
  // yazılamayan bir rezervasyon, kalıcı bir P2002, iptal edilmiş token) `reportError`ın
  // 10 dakikalık bellek-içi kısıtıyla günde ~130 e-posta demekti. Artık her tür için
  // durum DEĞİŞİNCE bir kez + 24 saatte bir hatırlatma; sayaç sıfıra inince temizlenir.
  // Konu başlıkları DEĞİŞMEDİ; sayı hâlâ MESAJDA, context'te değil (↓eski dersler).
  const opsAlarm = await alertTracker(`hospitable-sync:${organizationId}:`);
  const aggregate = async (kind: string, context: string, failed: boolean, err: () => unknown) => {
    if (failed) await opsAlarm.fail(kind, context, err());
    else await opsAlarm.ok(kind);
  };
  // A revoked/expired token makes EVERY per-listing call 401/403 → reconnect gerekir.
  await aggregate("auth", `hospitable-auth org:${organizationId}`, firstAuthError !== null, () => firstAuthError);
  // Supply-derivation visibility + self-heal (Codex 07-24 #5). Before this, a
  // transient failure after the message committed was PERMANENT silent loss:
  // the next sync deduped the message by externalId and never re-emitted the
  // job. One aggregate alert per run (first sample + count — PII-free, the
  // error text is scrubbed inside reportError)…
  await aggregate(
    "supply-derivation",
    `supply-derivation org:${organizationId}`, // sayı context'te DEĞİL (↓throttle)
    supplyFailures > 0,
    () =>
      new Error(
        `${supplyFailures} supply derivation(s) failed; first: ${
          firstSupplyError instanceof Error ? firstSupplyError.message : String(firstSupplyError)
        }`,
      ),
  );
  // Mesaj içe aktarımı SUPPLY'DAN DAHA KRİTİK: supply bir yardımcı özellik,
  // bu ise ürünün girdisi. Aynı aggregate deseni, ayrı sayaç.
  await aggregate(
    "fetch",
    `hospitable-fetch org:${organizationId}`, // sayı context'te DEĞİL (throttle)
    fetchFailures > 0,
    () =>
      new Error(
        `${fetchFailures} Hospitable fetch(es) failed — those apartments/threads imported NOTHING this run; first: ${
          firstFetchError instanceof Error ? firstFetchError.message : String(firstFetchError)
        }`,
      ),
  );
  await aggregate(
    "property-link",
    `property-link org:${organizationId}`,
    linkFailures > 0,
    () =>
      new Error(
        `${linkFailures} listing link(s) failed — those apartments imported NOTHING this run; first: ${
          firstLinkError instanceof Error ? firstLinkError.message : String(firstLinkError)
        }`,
      ),
  );
  // ⚠️ SAYI CONTEXT'E GİRMEZ: `reportError` e-posta throttle'ını CONTEXT
  // string'iyle anahtarlıyor; sayı her koşuda değişirse her koşu YENİ anahtar
  // olur ve 10 dakikalık koruma fiilen kalkar (kardeş alarmların dersi).
  await aggregate(
    "reservation-unwritable",
    `reservation-unwritable org:${organizationId}`,
    result.reservationsUnwritable > 0,
    () =>
      new Error(
        `${result.reservationsUnwritable} reservation(s) had no writable local row — ` +
          `their threads carry NO stay context (calendar/occupancy/lifecycle blind); ` +
          `first: ${firstUnwritableReason ?? "unknown"}`,
      ),
  );
  // ⚠️ SAYI CONTEXT'E GİRMEZ (kardeşinin dersi): `reportError` e-posta
  // throttle'ını CONTEXT string'iyle anahtarlıyor; sayı her koşuda değişirse
  // 10 dakikalık koruma fiilen kalkar ve 2 dakikalık cron her geçişte
  // bildirim üretir.
  await aggregate(
    "message-unimportable",
    `message-unimportable org:${organizationId}`,
    result.messagesUnimportable > 0,
    () =>
      new Error(
        `${result.messagesUnimportable} provider message(s) had an id but NO text body — ` +
          `skipped and NEVER re-evaluated (the sync cursor still advances). If a guest ` +
          `sent only a photo/attachment, the host never sees it and the AI gate never runs. ` +
          `Behaviour unchanged on purpose — this counter exists to decide with DATA whether ` +
          `to import a placeholder row (see SyncResult.messagesUnimportable).`,
      ),
  );
  await aggregate(
    "reservation-upsert",
    `reservation-upsert org:${organizationId}`,
    reservationUpsertFailures > 0,
    () =>
      new Error(
        `${reservationUpsertFailures} reservation upsert(s) failed; first: ${
          firstReservationError instanceof Error ? firstReservationError.message : String(firstReservationError)
        }`,
      ),
  );
  // ⚠️ SAYI CONTEXT'E GİRMEZ: `reportError` e-posta throttle'ını CONTEXT
  // string'iyle anahtarlıyor. Sayı her koşuda değiştiği için (5, sonra 6…)
  // her koşu YENİ bir anahtar olur ve 10 dakikalık koruma fiilen kalkar;
  // Sentry tarafında da tek arıza N ayrı Issue'ya bölünür. Sayı MESAJDA.
  await aggregate(
    "thread-import",
    `thread-import org:${organizationId}`,
    threadImportFailures > 0,
    () =>
      new Error(
        `${threadImportFailures} thread import(s) failed; first: ${
          firstThreadImportError instanceof Error ? firstThreadImportError.message : String(firstThreadImportError)
        }`,
      ),
  );
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
 * Link a Hospitable property to an existing Property (by id, then name) or
 * create one — unless creating one would exceed the plan's property limit, in
 * which case returns null (nothing already onboarded is ever affected; only
 * a brand-new, never-before-linked listing can be refused this way).
 */
async function linkProperty(
  organizationId: string,
  hp: { id: string; name: string | null },
  liveIds: Set<string>,
  limitState: PropertyLimitState,
): Promise<string | null> {
  const linked = await prisma.property.findFirst({
    where: { organizationId, hospitableId: hp.id },
    select: { id: true },
  });
  if (linked) return linked.id;

  const name = hp.name ?? "Hospitable mülkü";

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



