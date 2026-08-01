import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { syncHospitable } from "@/lib/hospitable-sync";
import { isPrimaryOrg } from "@/lib/hospitable-credentials";
import { HospitableError } from "@/lib/hospitable";
import { reportError } from "@/lib/report-error";
import { premiumAllowed } from "@/lib/billing/subscription";
import { sendDueTrialReminders } from "@/lib/billing/trial-reminders";
import { anonymizeOldGuestData, purgeOldLeads } from "@/lib/data-retention";
import { sweepExpiredRateLimits } from "@/lib/rate-limit";
import { drainEmailOutboxOnce, sweepEmailOutbox } from "@/lib/email-outbox";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import { drainOutboxOnce, hasDrainableOutbox, reactivateBlockedOutbox } from "@/lib/outbox/worker";
import { drainStorageDeletions, hasPendingStorageDeletions } from "@/lib/storage/deletion-queue";
import {
  runDueChannelAutoReplies,
  sendDueWelcomes,
  sendDueCheckins,
  sendDueCheckouts,
  sendDueAlerts,
  refreshStyleProfile,
} from "@/lib/automation";

// ---------------------------------------------------------------------------
// The one scheduled pass: pull new Hospitable messages for every organization,
// then run the auto-reply / welcome / checkout passes. Shared by BOTH triggers:
//   1. The external scheduler hitting /api/cron/sync (cron-job.org).
//   2. The in-process timer in instrumentation.ts (a self-contained backup so a
//      single failing scheduler can't silently stop the whole system).
//
// Idempotent and safe to call concurrently: message import de-duplicates by
// provider id, welcomes/checkouts are stamped once per booking, and auto-reply
// only ever answers the guest's latest UNANSWERED message. An in-process lock
// still skips overlapping runs to avoid wasted work.
// ---------------------------------------------------------------------------

export interface ScheduledSyncTotals {
  ok: boolean;
  error?: string;
  organizations: number;
  /** Boşta olduğu için hiç işlenmeyen org sayısı (mülk yok + PMS yok). */
  idleOrganizationsSkipped?: number;
  /** Süre bütçesi dolduğu için bu geçişte atlanan org sayısı (iş kaybı değil, gecikme). */
  budgetSkipped?: number;
  conversations: number;
  messages: number;
  autoReplies: number;
  welcomes: number;
  checkins: number;
  checkouts: number;
  alerts: number;
}

function zero(): ScheduledSyncTotals {
  return {
    ok: true,
    organizations: 0,
    conversations: 0,
    messages: 0,
    autoReplies: 0,
    welcomes: 0,
    checkins: 0,
    checkouts: 0,
    alerts: 0,
  };
}

const LOCK_NAME = "scheduled-sync";
// Auto-release if a holder crashes mid-run. Set well ABOVE the worst-case run
// time (a deep sync of a large multi-listing account with 429 back-offs can take
// several minutes): if the TTL lapses WHILE a sync is still running, a second
// run can acquire and execute concurrently — and the non-atomic import dedupe
// (findFirst-then-create) can then write duplicate rows. 15 min gives ample
// head-room; the fencing token below stops the overrunning run from clobbering
// the new owner's lock if it ever does happen.
const LOCK_TTL_MS = 15 * 60 * 1000;

// Fast in-process guard (same instance) on top of the cross-instance DB lock.
let running = false;

// Two-speed sweep: most runs use a NARROW reservation window (cheap, ~every 2
// min); a WIDE "catch-up" window runs at most once per HOSPITABLE_DEEP_EVERY_MIN
// so a guest who checked out long ago but messages now is still imported —
// without paying the wide sweep on every run. The cadence lives in SystemLock
// (not a module variable) so ALL replicas share ONE schedule: previously each
// replica — and every restart — kept its own timestamp and re-ran its own deep
// sweep (extra Hospitable load + 429s for nothing).
const DEEP_CADENCE_NAME = "deep-sync-cadence";

/**
 * Atomically claim the deep-sweep slot: true when THIS run should go deep. The
 * row's lockedUntil holds the NEXT allowed deep time; updateMany on a free slot
 * is the atomic arbiter (same pattern as the sync lock). On a DB hiccup the run
 * quietly stays narrow — the deep sweep retries on a later round.
 */
async function claimDeepWindow(deepEveryMs: number): Promise<boolean> {
  const now = new Date();
  try {
    await prisma.systemLock.upsert({
      where: { name: DEEP_CADENCE_NAME },
      create: { name: DEEP_CADENCE_NAME, lockedUntil: new Date(0) },
      update: {},
    });
    const res = await prisma.systemLock.updateMany({
      where: { name: DEEP_CADENCE_NAME, lockedUntil: { lte: now } },
      data: { lockedUntil: new Date(now.getTime() + deepEveryMs) },
    });
    return res.count === 1;
  } catch {
    return false;
  }
}

/**
 * Take the cross-instance lock if it is free; safe to call from any replica.
 * Returns a unique fencing token to whoever wins the lock, or null if the lock
 * is currently held. The token must be passed back to releaseLock so a run can
 * only ever release the lock IT holds.
 */
async function acquireLock(): Promise<string | null> {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_TTL_MS);
  const holder = randomUUID();
  // Ensure the row exists with a past expiry so the first ever run can acquire.
  await prisma.systemLock.upsert({
    where: { name: LOCK_NAME },
    create: { name: LOCK_NAME, lockedUntil: new Date(0) },
    update: {},
  });
  // Atomic: only one caller's updateMany can match a free lock. Stamp our token
  // so releaseLock can verify ownership.
  const res = await prisma.systemLock.updateMany({
    where: { name: LOCK_NAME, lockedUntil: { lte: now } },
    data: { lockedUntil: until, holder },
  });
  return res.count === 1 ? holder : null;
}

async function releaseLock(holder: string): Promise<void> {
  // Fencing: only free the lock if we still hold it. If our TTL had lapsed and a
  // newer run re-acquired (writing its own token), the WHERE won't match and we
  // leave the new owner's lock untouched — instead of yanking it out from under
  // a run that is still going.
  await prisma.systemLock
    .updateMany({
      where: { name: LOCK_NAME, holder },
      data: { lockedUntil: new Date(0), holder: null },
    })
    .catch(() => {});
}

/**
 * Run `fn` while holding the cross-instance sync lock, so it can never overlap
 * the scheduled cron (which uses the same lock). Returns `{ locked: true }`
 * without running if a sync is already in progress. Used by the manual
 * "Mesajları çek" button to prevent duplicate rows from a manual+cron race.
 */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T | { locked: true }> {
  const holder = await acquireLock();
  if (!holder) return { locked: true };
  try {
    return await fn();
  } finally {
    await releaseLock(holder);
  }
}

export async function runScheduledSync(): Promise<ScheduledSyncTotals> {
  // Multi-tenant: no global token gate here. Each org self-gates on ITS OWN
  // Hospitable connection (syncHospitable + the automation senders return early
  // when the org has no token), so orgs that aren't connected are simply skipped.
  if (running) {
    return { ...zero(), ok: false, error: "already_running" };
  }
  running = true;
  try {
    const holder = await acquireLock();
    if (!holder) {
      return { ...zero(), ok: false, error: "locked" };
    }
    try {
      const totals = zero();

      // Faz-A cutover healing (Codex #26): runs on EVERY pass, immediately after
      // the lock and BEFORE any Hospitable/premium/deep gating — an org whose
      // Hospitable subscription is inactive (402) or whose plan lapsed must
      // still get its Float-only rows (written by the OLD deployment during
      // cutover, or by any missed dual-write) backfilled. Same explicit
      // NaN-safe cast as migration 23; idempotent (WHERE Dec IS NULL) and
      // best-effort — money display keeps working off the Float fallback.
      try {
        const healed = await prisma.$executeRaw`
          UPDATE "Reservation"
          SET "totalAmountDec" = round("totalAmount"::numeric, 2)
          WHERE "totalAmount" IS NOT NULL
            AND "totalAmountDec" IS NULL
            AND "totalAmount" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
            AND abs("totalAmount") < 1e10`;
        if (healed > 0) console.log(`[scheduled-sync] amount shadow healed: ${healed}`);
      } catch (err) {
        await reportError("scheduled-sync amount-heal", err);
      }

      // BOŞTA ORG'U ATLA. Döngünün yaptığı her iş (konuşma, rezervasyon, uyarı,
      // oto-mesaj) Property üzerinden asılıdır — mülkü OLMAYAN ve PMS bağlamamış
      // bir org'un burada yapacak hiçbir işi yoktur. Buna rağmen bugüne kadar org
      // başına ~12 sorgu × 2 dakikada bir × SONSUZA KADAR koşuyordu (terk edilmiş
      // deneme hesapları için otomatik temizlik yok). Döngü SERİ ve global kilit
      // altında olduğu için bu yük doğrudan gerçek müşterinin senkron gecikmesine
      // dönüşüyordu.
      //
      // Atlama koşulu bilerek DAR: yalnız "hiç mülkü yok VE kendi token'ı yok VE
      // env-token fallback'i de geçerli değil". Yani ilk senkronunda listelerini
      // içeri çekecek yeni bir bağlantı ASLA atlanmaz.
      const orgRows = await prisma.organization.findMany({
        select: { id: true, hospitableTokenEnc: true, _count: { select: { properties: true } } },
      });
      const envToken = Boolean(process.env.HOSPITABLE_API_TOKEN);
      const orgs: { id: string }[] = [];
      for (const o of orgRows) {
        const busy =
          o._count.properties > 0 ||
          o.hospitableTokenEnc !== null ||
          (envToken && (await isPrimaryOrg(o.id)));
        if (busy) orgs.push({ id: o.id });
      }
      totals.organizations = orgs.length;
      const skipped = orgRows.length - orgs.length;
      if (skipped > 0) totals.idleOrganizationsSkipped = skipped;

      // Decide once per run: narrow (frequent, light) or wide (hourly catch-up).
      // Narrow keeps the every-2-min reservation sweep cheap; the wide window runs
      // at most hourly to still pick up far-future bookings and long-ago guests
      // who message now. All tunable via env, sensible defaults baked in.
      const deepEveryMs = (Number(process.env.HOSPITABLE_DEEP_EVERY_MIN) || 60) * 60_000;
      const deep = await claimDeepWindow(deepEveryMs);
      // PENCERE SEÇİMİ (kullanıcı "sen seç" dedi, 07-31). Dört sayının hepsi
      // env'den ezilebilir → yanlış çıkarsa deploy'suz geri alınır.
      //  · Sık geçiş geriye 90 → 30 gün. Her 2 dakikada 3 aylık rezervasyon
      //    listesini sayfalamanın karşılığı yoktu; çıkışından sonra yazan misafir
      //    için 30 gün fazlasıyla yeter, kalanını saatlik geniş geçiş topluyor.
      //  · Geniş geçiş İLERİ 540 → 365 gün. Kısa dönem kiralamada bir yıldan uzak
      //    rezervasyon pratikte yok; sayfalama maliyetinin büyük kısmı buradaydı.
      //  · Geniş geçiş GERİYE 540 gün AYNI KALDI — bilinçli. Mesaj içe aktarımı
      //    rezervasyon penceresi üzerinden yürüdüğü için burayı daraltmak, eski
      //    bir konaklamadan yazan misafirin mesajını SESSİZCE kaybetmek demektir;
      //    bugün kapatılan arıza sınıfının ta kendisi. Ucuz değil, riskli olurdu.
      const window = deep
        ? {
            backDays: Number(process.env.HOSPITABLE_DEEP_BACK_DAYS) || 540,
            forwardDays: Number(process.env.HOSPITABLE_DEEP_FORWARD_DAYS) || 365,
          }
        : {
            backDays: Number(process.env.HOSPITABLE_SYNC_BACK_DAYS) || 30,
            forwardDays: Number(process.env.HOSPITABLE_SYNC_FORWARD_DAYS) || 120,
          };

      // ⚠️ SÜRE BÜTÇESİ (denetim, 07-31 · düzeltme 07-31). Döngü SERİ ve global
      // kilit altında; bir kiracının yavaşlığı doğrudan diğerlerinin senkronunu
      // geciktiriyor. Kötü hâli: koşu kilidin TTL'ini (15 dk) aşarsa ikinci bir
      // koşu aynı org için EŞZAMANLI başlar ve tüm duplicate korumasının
      // dayandığı "aynı org iki kez koşmaz" varsayımı delinir.
      //
      // ⚠️ BU TAVANLARIN GERÇEKTE NE YAPTIĞI (eski yorum fazlasını iddia
      // ediyordu, düzeltildi): ikisi de ÇALIŞAN bir işi KESMEZ — JS tek iş
      // parçacıklı ve `syncHospitable` bölünemez. Sağladıkları şey, YENİ iş
      // BAŞLATMAMAK:
      //   · koşu başına 12 dk — bu süreden sonra sıradaki org'a BAŞLANMAZ,
      //   · org başına 4 dk — bütçesini yiyen org'un otomasyon geçişleri atlanır.
      // Yani toplam süre 12 dk + son org'un kendi süresi kadar olabilir; TTL
      // aşımı imkânsız DEĞİL, sadece çok daha uzak. Gerçek garanti isteniyorsa
      // çözüm heartbeat'li kilit ya da per-org kuyruk — ikisi de ayrı iş.
      const passStartedAt = Date.now();
      const PASS_BUDGET_MS = 12 * 60_000;
      const ORG_BUDGET_MS = 4 * 60_000;
      let budgetSkipped = 0;

      for (const org of orgs) {
        if (Date.now() - passStartedAt > PASS_BUDGET_MS) {
          budgetSkipped += 1;
          continue;
        }
        const orgStartedAt = Date.now();
        // Bir org'un hatası diğerlerini durdurmaz. AYNI gövde iki try'da da
        // kullanılıyor (senkron + otomasyon), o yüzden tek yerde duruyor.
        const handleOrgError = async (err: unknown) => {
          // A Hospitable 402 ("Subscription not active") means THIS org's Hospitable
          // billing lapsed — an expected external state, not a Lixus bug — so log it
          // (the UI connection status already reflects it) but DON'T alert-email every
          // cycle, which would flood the inbox until they renew.
          if (err instanceof HospitableError && err.status === 402) {
            console.warn(`[scheduled-sync] org ${org.id}: Hospitable subscription not active (skipped)`);
          } else {
            await reportError(`scheduled-sync org ${org.id}`, err);
          }
        };

        let syncOk = false;
        try {
          const result = await syncHospitable(org.id, window);
          // Sayaçlar İMPORT'un hemen ardında. Eskiden bütçe dalı bunları atlıyordu:
          // satırlar DB'ye YAZILMIŞ ama koşu raporu 0 diyordu — kendi loglarımıza
          // güvenilmez hâle geliyordu.
          totals.conversations += result.conversations;
          totals.messages += result.messages;

          // A SUCCESSFUL sync PROVES this org's Hospitable subscription is active again (a 402
          // "subscription not active" throws a HospitableError above, skipping this line). So
          // atomically requeue any outbox rows parked as `blocked` (subscription-not-active) →
          // `pending`, to be retried exactly ONCE by the drain at the end of this run. Tenant-
          // scoped + idempotent; a no-op when nothing is blocked. Best-effort — never aborts.
          await reactivateBlockedOutbox(org.id).catch((err) =>
            reportError(`scheduled-sync reactivate-blocked ${org.id}`, err),
          );
          syncOk = true;
        } catch (err) {
          await handleOrgError(err);
        }

        // ŞİKAYET UYARISI SÜRE BÜTÇESİNDEN MUAF (denetim düzeltmesi).
        // Bu geçiş şikayeti "Sorunlu" işaretleyip host'a acil e-posta atan yol;
        // ürünün "riskli mesaj insana gider" sözünün taşıyıcısı. Eskiden bütçe
        // dalının ARKASINDA kalıyordu, yani senkronu sürekli 4 dakikayı aşan
        // bir org'un şikayet uyarıları SÜRESİZ susabiliyordu (gecikme değil,
        // sessiz kayıp).
        //
        // ⚠️ MUAFİYET SENKRONUN TRY'INDAN DA ÇIKARILDI (denetim, 08-01). Muafiyet
        // BÜTÇEYE karşı sağlanmıştı ama İSTİSNAYA karşı sağlanmamıştı: çağrı
        // `syncHospitable`'ın try'ı içinde ve ONDAN SONRA duruyordu, yani
        // Hospitable fırlattığı anda (402 abonelik pasif — Nuve'nin BUGÜNKÜ hâli;
        // ya da 401/403/5xx) `sendDueAlerts` o org için HİÇ koşmuyordu. Bu geçiş
        // hiçbir Hospitable API'sine dokunmuyor (yalnız DB + e-posta), yani
        // senkronun başarısına bağlı olmasının teknik bir gerekçesi yoktu.
        // ⚠️ SIRA KORUNDU: uyarı geçişi otomasyondan ÖNCE koşar — şikayeti
        // "Sorunlu" işaretlemesi oto-yanıtın ikinci savunmasıdır.
        //
        // ⚠️ MUAFİYETİN BEDELİ (ilk yorum bunu YANLIŞ anlatıyordu: "dış API
        // yok" demiştim — e-posta sağlayıcısı da bir dış API'dir): bu geçiş 50
        // adaya kadar SERİ `sendReporting` yapabilir, her biri 15 sn timeout'a
        // kadar. Sağlayıcı asılı kalırsa tek org 12 dakika yer ve 15 dk'lık
        // kilit TTL'i tehlikeye girer. Bu yüzden muafiyet SINIRSIZ değil:
        // `sendDueAlerts` kendi wall-clock bütçesini taşır (↓ALERT_BUDGET_MS)
        // ve dolduğunda kalanları bir sonraki geçişe bırakır.
        try {
          const alert = await sendDueAlerts(org.id);
          totals.alerts += alert.alerted;
        } catch (err) {
          await handleOrgError(err);
        }

        // Senkron patladıysa otomasyon koşmaz (eski davranış birebir): mesajlar
        // içeri alınamamışken oto-yanıt/karşılama göndermenin anlamı yok.
        if (!syncOk) continue;
        if (Date.now() - orgStartedAt > ORG_BUDGET_MS) {
          // Bu org bütçesini yedi: import bitti (yazılanlar kalıcı), uyarılar
          // gitti; GERİYE KALAN otomatik MİSAFİR mesajlarını sonraki tura bırak
          // ki sıradakiler aç kalmasın. Sonraki geçiş 2 dakika sonra.
          budgetSkipped += 1;
          continue;
        }

        try {
          // Keep the host's style profile fresh (self-throttles to once a day).
          await refreshStyleProfile(org.id);
          // Free/expired tier (billing enforced + subscription not active): keep
          // syncing messages and host complaint-alerts, but SUPPRESS all
          // automatic guest messaging — the paid feature. Dormant-safe: while
          // BILLING_ENFORCED is off, premiumAllowed is always true.
          const canAutomate = await premiumAllowed(org.id);
          const auto = canAutomate ? await runDueChannelAutoReplies(org.id) : { sent: 0 };
          const welcome = canAutomate ? await sendDueWelcomes(org.id) : { sent: 0 };
          const checkin = canAutomate ? await sendDueCheckins(org.id) : { sent: 0 };
          const checkout = canAutomate ? await sendDueCheckouts(org.id) : { sent: 0 };
          totals.autoReplies += auto.sent;
          totals.welcomes += welcome.sent;
          totals.checkins += checkin.sent;
          totals.checkouts += checkout.sent;
        } catch (err) {
          await handleOrgError(err);
        }
      }
      if (budgetSkipped > 0) {
        totals.budgetSkipped = budgetSkipped;
        console.warn(
          `[scheduled-sync] süre bütçesi: ${budgetSkipped} org bu geçişte atlandı (sonraki turda devam eder)`,
        );
      }

      // Durable Outbox drain. The flag ONLY gates NEW enqueues — the worker must
      // drain the queue whenever the flag is ON *or* rows already exist, so an
      // emergency rollback (flag flipped OFF) still delivers everything that was
      // queued while it was ON instead of stranding it forever (Codex #1). Runs under
      // the same cross-instance sync lock (never overlaps another pass); the worker's
      // own SKIP LOCKED claim keeps it correct regardless. Best-effort.
      if (durableOutboxEnabled() || (await hasDrainableOutbox())) {
        try {
          const drained = await drainOutboxOnce();
          if (drained.claimed > 0) console.log(`[scheduled-sync] outbox: ${JSON.stringify(drained)}`);
        } catch (err) {
          await reportError("scheduled-sync outbox-drain", err);
        }
      }

      // Private-storage deletion drain. Independent of the STORAGE_ENABLED upload
      // flag on purpose: intents queued before a flag-off rollback still get
      // deleted as long as the provider credentials remain (drain itself skips
      // quietly when unconfigured — rows wait). No-op when the queue is empty.
      try {
        if (await hasPendingStorageDeletions()) {
          const r = await drainStorageDeletions();
          if (!r.skipped && (r.deleted > 0 || r.failed > 0)) {
            console.log(`[scheduled-sync] storage-deletions: ${JSON.stringify(r)}`);
          }
        }
      } catch (err) {
        await reportError("scheduled-sync storage-deletions", err);
      }

      // KVKK retention sweep — anonymize guest PII for long-past stays. No-op
      // unless DATA_RETENTION_MONTHS is set; runs at most once per deep window so
      // it never burdens the frequent narrow passes. Best-effort, never aborts.
      if (deep) {
        try {
          await anonymizeOldGuestData();
        } catch (err) {
          await reportError("scheduled-sync retention", err);
        }
        // Marketing-lead retention. No-op unless LEAD_RETENTION_MONTHS is set.
        try {
          await purgeOldLeads();
        } catch (err) {
          await reportError("scheduled-sync lead-purge", err);
        }
        // Distributed rate-limit hygiene: drop counters whose window ended (keys
        // that never return — one-off IPs — would otherwise accumulate forever).
        try {
          await sweepExpiredRateLimits();
        } catch (err) {
          await reportError("scheduled-sync rate-limit-sweep", err);
        }
        // Reverse-trial reminder emails ("ending soon" / "ended"). No-op unless
        // BILLING_ENFORCED is on; idempotent + per-tenant. Best-effort.
        try {
          await sendDueTrialReminders();
        } catch (err) {
          await reportError("scheduled-sync trial-reminders", err);
        }
        // Identity e-mail outbox: the 2-min RECOVERY net behind the 15s poller
        // (crash recovery + retention sweep + a drain pass so external-cron-only
        // deployments still deliver). No-op while EMAIL_OUTBOX_ENABLED is off.
        try {
          await sweepEmailOutbox();
          await drainEmailOutboxOnce();
        } catch (err) {
          await reportError("scheduled-sync email-outbox", err);
        }
      }
      return totals;
    } finally {
      await releaseLock(holder);
    }
  } finally {
    running = false;
  }
}
