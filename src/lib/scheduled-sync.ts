import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { syncHospitable } from "@/lib/hospitable-sync";
import { isPrimaryOrg } from "@/lib/hospitable-credentials";
import { backfillChannelConnections } from "@/lib/channels/connections";
import { isChannelSubscriptionInactive } from "@/lib/provider-errors";
import { alertTracker, sweepStaleAlertStates } from "@/lib/alert-state";
import { premiumAllowed } from "@/lib/billing/subscription";
import { sendDueTrialReminders } from "@/lib/billing/trial-reminders";
import { anonymizeOldGuestData, purgeOldLeads, retentionCutoff } from "@/lib/data-retention";
import { runIntelligencePass, purgeExpiredSignals } from "@/modules/intelligence";
import { sweepUnverifiedRegistrations } from "@/lib/unverified-sweep";
import { sweepExpiredRateLimits } from "@/lib/rate-limit";
import { sweepPasswordResetChallenges } from "@/lib/auth/password-reset-challenge";
import { drainEmailOutboxOnce, purgeEmailOutbox, recoverEmailOutbox } from "@/lib/email-outbox";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import { drainOutboxOnce, hasDrainableOutbox, reactivateBlockedOutbox } from "@/lib/outbox/worker";
import { drainStorageDeletions, hasPendingStorageDeletions } from "@/lib/storage/deletion-queue";
import { syncDueCalendarSourcesForOrg } from "@/lib/import/sync";
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
  /** Kilit yenilenemedi → geçiş erken kesildi (TTL aşımı / devralma). Alarm da düşer. */
  lockLost?: boolean;
  conversations: number;
  messages: number;
  autoReplies: number;
  welcomes: number;
  checkins: number;
  checkouts: number;
  alerts: number;
  /** Bu geçişte senkronlanan iCal (Kanal Takvimi) kaynağı sayısı. */
  icalSources?: number;
  /** iCal'den gelen YENİ rezervasyon sayısı. */
  icalImported?: number;
  /** iCal'den GÜNCELLENEN rezervasyon sayısı. */
  icalUpdated?: number;
  /** iCal bütçesi dolduğu için sonraki geçişe bırakılan KAYNAK sayısı. */
  icalDeferred?: number;
  /**
   * iCal bütçesi bu geçişte hiç kalmadığı için takvim bacağına sırası HİÇ
   * GELMEYEN org sayısı. ÜST SINIRDIR: havuz bittiğinde sorgu atılmadığı için
   * beslemesi olmayan org'lar da bu sayıya dahildir.
   */
  icalOrgsDeferred?: number;
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

/**
 * Kilidi UZAT — yalnız hâlâ BİZ tutuyorsak (fencing: `holder` WHERE'de, tıpkı
 * `releaseLock` gibi). TTL'i büyütmek yerine CANLILIĞI KANITLAR.
 *
 * ⚠️ İLERLEME-TETİKLİ, `setInterval` DEĞİL. Zamanlayıcıyla atılan bir kalp atışı
 * AĞDA ASILI KALMIŞ bir koşuyu da "canlı" gösterir ve kilidi SONSUZA KADAR
 * tutar — senkron komple, üstelik SESSİZCE durur. Org döngüsünün her turunda
 * çağrıldığında yenileme ancak GERÇEK ilerleme varken olur; gerçekten asılan bir
 * koşuda yenileme de durur ve TTL doğru şekilde devreye girer.
 *
 * ⚠️ KAPATMADIĞI DELİK (bilinçli): TEK bir org'un kendi içinde 15 dakikayı
 * aşması. Org içinde ilerleme noktası yok; tam çözüm `syncHospitable`'a
 * `onProgress` geçirmek olurdu ve imza + `withSyncLock` sözleşmesi genişlerdi.
 * `withSyncLock`'un in-process bayrağı en ulaşılabilir yolu zaten kapatıyor.
 *
 * ⚠️ SONUCU OKUNUR (denetim, 08-01 — üçüncü tur). `count === 0` "kilit ARTIK
 * BİZDE DEĞİL" demektir: TTL'imiz geçmiş ve BAŞKA bir replika kilidi almış
 * (kendi token'ıyla). Bu noktadan sonra devam etmek, İKİ koşunun aynı org'lara
 * paralel yazması demektir — kilidin var olma sebebinin ta kendisi. Eskiden
 * `count` hiç okunmuyordu ve dönüş `void`di: kilit sessizce kaybedilir, koşu
 * hiçbir şey olmamış gibi devam ederdi. `false` dönerse çağıran döngüyü KESER.
 *
 * `.catch(() => false)` bilinçli: DB hıçkırığı kilit kaybı DEĞİLDİR, ama emin
 * de olamayız → GÜVENLİ yön durmaktır (bir geçiş atlanır, 2 dakika sonra yeni
 * geçiş başlar; çift yazmanın bedeli çok daha ağır).
 */
async function renewLock(holder: string): Promise<boolean> {
  return prisma.systemLock
    .updateMany({
      where: { name: LOCK_NAME, holder },
      data: { lockedUntil: new Date(Date.now() + LOCK_TTL_MS) },
    })
    .then((res) => res.count === 1)
    // 🚨 DB HIÇKIRIĞI KİLİT KAYBI DEĞİLDİR → `true` (denetim, 08-01 — üçüncü tur;
    // ilk hâlim `false` döndürüyordu ve bu ÇOK DAHA TEHLİKELİYDİ). Kilidi
    // kaybetmek TTL'in (15 dk) GERÇEKTEN dolmasını gerektirir; tek bir tutarsız
    // statement bunu ima ETMEZ. `false` dönmek, geçici bir DB hatasında geçişi
    // İLK org'da kesiyordu — üstelik yenileme döngünün ilk turunda, kilit
    // alındıktan saniyeler sonra koştuğu için hata kalıcıysa HİÇBİR org hiç
    // işlenmiyor, tüm kiracıların mesaj içe aktarımı + oto-yanıtı duruyordu
    // (üstüne saatte 30 alarm). Gerçek kayıp `count === 0` ile zaten görülür ve
    // bir sonraki org turunda yakalanır.
    .catch(() => true);
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
  // ⚠️ IN-PROCESS BAYRAĞI DA OKUNUR VE YAZILIR (denetim, 08-01).
  //
  // Eskiden burada YALNIZ DB kilidine bakılıyordu. `runScheduledSync` ise ayrıca
  // modül-içi `running` bayrağını tutuyor. Sonuç iki yönlü bir delikti:
  //   · Uzun bir koşunun ORTASINDA 15 dk'lık TTL dolarsa (429 geri çekilmesi tek
  //     çağrıda 6 dakikaya kadar uyuyabiliyor) `acquireLock` kilidi SERBEST görür
  //     → manuel "Mesajları çek" butonu aynı org için İKİNCİ bir senkron başlatır.
  //   · Ters yön: manuel senkron sürerken `running` false kaldığı için cron
  //     tick'i araya girebiliyordu.
  // Tüm duplicate korumasının dayandığı "aynı org iki kez koşmaz" varsayımı tam
  // buradan deliniyordu ve bu, tek replikada bile ULAŞILABİLİR tek yoldu.
  //
  // Yeniden-giriş (re-entrancy) sorunu YOK: `runScheduledSync` bayrağı KENDİ set
  // eder ve `acquireLock`'u DOĞRUDAN çağırır — bu sarmalayıcıdan geçmez.
  if (running) return { locked: true };
  running = true;
  try {
    const holder = await acquireLock();
    if (!holder) return { locked: true };
    try {
      return await fn();
    } finally {
      await releaseLock(holder);
    }
  } finally {
    running = false;
  }
}

export async function runScheduledSync(): Promise<ScheduledSyncTotals> {
  // 🚨 GEÇİŞ TABANLI ALARM (09-23 olayının SINIF düzeltmesi): bu dosyadaki HER alarm bu
  // izleyiciden geçer. `reportError`ın kısıtı süreç belleğinde, context başına 10 dk'dır;
  // 2 dakikalık döngüde KALICI bir arıza (Hospitable kesintisi, env token'ına kalıcı 401,
  // deterministik bir DB hatası) bu yüzden günde ~130 e-posta üretiyordu. Artık durum
  // DEĞİŞTİĞİNDE bir kez + 24 saatte bir hatırlatma; aşama başarılı olunca durum temizlenir.
  // E-posta KONULARI değişmedi (kurucu aynı başlıkları tanır).
  const opsAlarm = await alertTracker("scheduled-sync:");

  // V0.3 EXPAND — idempotent backfill of ChannelConnection rows for orgs that were
  // connected before migration 49 (dual-write keeps everyone else current). Cheap
  // (indexed "no connection row yet" query, normally 0 rows); a failure is reported,
  // never blocks the pass.
  try {
    const { created } = await backfillChannelConnections();
    if (created > 0) console.log(`[scheduled-sync] channel-connection backfill: ${created} row(s) created`);
    await opsAlarm.ok("channel-connection-backfill");
  } catch (err) {
    void opsAlarm.fail("channel-connection-backfill", "channel-connection-backfill", err);
  }
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
        await opsAlarm.ok("amount-heal");
      } catch (err) {
        await opsAlarm.fail("amount-heal", "scheduled-sync amount-heal", err);
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
        select: {
          id: true,
          hospitableTokenEnc: true,
          // V0.7: bağlantı satırı da "meşgul" sayılır (çift kaynak; V0.7 contract'ında kolon düşer).
          channelConnections: { where: { provider: "hospitable", status: "active" }, select: { id: true }, take: 1 },
          _count: { select: { properties: true } },
        },
      });
      const envToken = Boolean(process.env.HOSPITABLE_API_TOKEN);
      const orgs: { id: string }[] = [];
      for (const o of orgRows) {
        const busy =
          o._count.properties > 0 ||
          o.hospitableTokenEnc !== null ||
          o.channelConnections.length > 0 ||
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
      let lockLost = false;

      // ⚠️ iCal BÜTÇESİ = YUKARIDAKİ 12 DAKİKANIN İÇİNDEN AYRILMIŞ BİR PAY
      // (üstüne EKLENEN bir süre DEĞİL). Gerekçe ölçekle ilgili: İşletme
      // planındaki bir host 25 daire × 10 besleme = 250 kaynak tanımlayabilir ve
      // her biri `fetchFeedText`in 15 sn'lik toplam deadline'ına kadar
      // sürebilir → sınırsız bırakılsa TEK geçiş bir saati aşar, 15 dakikalık
      // kilit TTL'i aşılır ve İKİNCİ bir koşu aynı org'a paralel yazar (tüm
      // duplicate korumasının dayandığı varsayım delinir).
      //   · geçiş başına 3 dk — TÜM org'ların iCal'i için ORTAK havuz,
      //   · org başına 60 sn — tek kiracı havuzu tek başına yiyemesin.
      // İkisi de YENİ İŞ BAŞLATMAYI keser, çalışanı kesmez (deponun mevcut
      // bütçe sözleşmesiyle birebir). Kırpma SESSİZ DEĞİL: aşağıda tek bir
      // `[scheduled-sync] ical:` satırı ertelenen kaynak/org sayısını ve
      // bütçenin kendisini basar.
      // 🚨 KAPATMA ANAHTARI — VARSAYILAN AÇIK, GERİ ALMA DEPLOY GEREKTİRMEZ
      // (denetim 08-08). Bu tur, üretimde HİÇ koşmamış bir kod yolunu açtı ve
      // depodaki her riskli özellik env'den kapatılabiliyor
      // (ICAL_DISAPPEARANCE_RECONCILE_ENABLED, DURABLE_OUTBOX_ENABLED,
      // EMAIL_OUTBOX_ENABLED, STORAGE_ENABLED…). Bunun yoktu: tek geri dönüş
      // yolu kodu revert edip yeniden deploy etmekti.
      // ⚠️ VARSAYILAN AÇIK, çünkü bu bir ÖZELLİK değil bir ARIZA DÜZELTMESİ:
      // kapalıyken beslemeler hiç senkronlanmıyor ve daire boş görünüyor.
      // Bayrak "kapat" yönünde okunuyor — env yoksa davranış bugünkü hâli.
      // ⚠️ `ICAL_PASS_BUDGET_MS=0` ile kapatılamaz (`Number("0") || 180000` →
      // varsayılana düşer); kapatmanın TEK doğru yolu budur.
      // Kapalıyken sessiz: her 2 dakikada log basmak gürültü olurdu; kapalı
      // olduğu `/api/cron/sync` çıktısındaki `icalSources: 0` ile görülür.
      const icalLegEnabled = process.env.ICAL_SCHEDULED_SYNC_DISABLED !== "1";
      const ICAL_PASS_BUDGET_MS = Number(process.env.ICAL_PASS_BUDGET_MS) || 3 * 60_000;
      const ICAL_ORG_BUDGET_MS = Number(process.env.ICAL_ORG_BUDGET_MS) || 60_000;
      let icalSpentMs = 0;
      let icalSources = 0;
      let icalImported = 0;
      let icalUpdated = 0;
      let icalFailed = 0;
      let icalDeferred = 0;
      let icalOrgsDeferred = 0;

      for (const [orgIndex, org] of orgs.entries()) {
        if (Date.now() - passStartedAt > PASS_BUDGET_MS) {
          budgetSkipped += 1;
          continue;
        }
        // Bu geçiş HÂLÂ ilerliyor → kilidi tazele (↑renewLock: ilerleme-tetikli).
        // ⚠️ SONUÇ OKUNUR: `count === 0` "kilit BİZDE DEĞİL" demektir (TTL geçmiş,
        // başka replika almış). Devam etmek iki koşunun aynı org'lara paralel
        // yazması demek — kilidin var olma sebebi tam olarak bu. Kalan org'lar
        // kaybolmaz: kilidi alan koşu zaten aynı listeyi işliyor.
        // ⚠️ İLK TUR ATLANIR: kilit saniyeler önce `acquireLock` ile alındı,
        // yenileme tanım gereği gereksiz — sırf bir başarısızlık yüzeyi eklerdi.
        if (orgIndex > 0 && !(await renewLock(holder))) {
          lockLost = true;
          break;
        }
        const orgStartedAt = Date.now();
        // Alarm durumu AŞAMA başınadır (senkron düzelirken otomasyon hâlâ düşüyor olabilir;
        // tek anahtar olsaydı birinin başarısı ötekinin alarmını silerdi). E-posta konusu
        // dört aşamada da AYNI kalır.
        const orgKey = (stage: string) => `org:${org.id}:${stage}`;
        // Bir org'un hatası diğerlerini durdurmaz. AYNI gövde dört try'da da
        // kullanılıyor (senkron, uyarı, otomasyon, takvim), o yüzden tek yerde duruyor.
        const handleOrgError = async (stage: string, err: unknown) => {
          // A Hospitable 402 ("Subscription not active") means THIS org's Hospitable
          // billing lapsed — an expected external state, not a Lixus bug — so log it
          // but DON'T alert-email every cycle, which would flood the inbox until they renew.
          // 🚨 09-23 OLAYI: bu kontrol `err instanceof HospitableError` idi. V0.6 okumayı
          // ingest adaptörüne taşıdı ve adaptör hatayı `IngestError`a SARIYOR → dal
          // 09-08'den beri ÖLÜYDÜ, kurucuya her geçişte "sistem hatası" e-postası gitti.
          // Okuma artık sarmaldan bağımsız TEK yerden (`provider-errors`, sınıf pinli).
          // Bilinen bir dış durumdur, alarm hâli DEĞİL → aşamanın alarm durumu da temizlenir
          // (abonelik yenilendikten sonra gelen gerçek bir kesinti yeniden bildirilsin).
          if (isChannelSubscriptionInactive(err)) {
            console.warn(`[scheduled-sync] org ${org.id}: Hospitable subscription not active (skipped)`);
            await opsAlarm.ok(orgKey(stage));
          } else {
            await opsAlarm.fail(orgKey(stage), `scheduled-sync org ${org.id}`, err);
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
          // "subscription not active" throws above — wrapped by the ingest adapter as an
          // `IngestError` of kind `blocked` — skipping this line). So
          // atomically requeue any outbox rows parked as `blocked` (subscription-not-active) →
          // `pending`, to be retried exactly ONCE by the drain at the end of this run. Tenant-
          // scoped + idempotent; a no-op when nothing is blocked. Best-effort — never aborts
          // (kendi try'ı: hatası senkronu "başarısız" SAYDIRMAZ).
          try {
            await reactivateBlockedOutbox(org.id);
            await opsAlarm.ok(orgKey("reactivate-blocked"));
          } catch (err) {
            await opsAlarm.fail(orgKey("reactivate-blocked"), `scheduled-sync reactivate-blocked ${org.id}`, err);
          }
          syncOk = true;
          await opsAlarm.ok(orgKey("sync"));
        } catch (err) {
          await handleOrgError("sync", err);
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
        // Hospitable fırlattığı anda (402 abonelik pasif — kurucu org'un BUGÜNKÜ hâli;
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
          await opsAlarm.ok(orgKey("complaint-alerts"));
        } catch (err) {
          await handleOrgError("complaint-alerts", err);
        }

        // Senkron patladıysa otomasyon koşmaz (eski davranış birebir): mesajlar
        // içeri alınamamışken oto-yanıt/karşılama göndermenin anlamı yok.
        // ⚠️ `continue` YERİNE İÇ BLOK (08-08): koşullar ve sıra BİREBİR aynı
        // kaldı — tek sebep, aşağıdaki iCal bacağının bu iki erken çıkışın
        // ARKASINDA kalmaması. `continue` bırakılsaydı Hospitable'ı 402 olan bir
        // host (kurucu org'un BUGÜNKÜ hâli) takvim beslemelerini de HİÇ senkronlayamaz,
        // yani düzeltmenin en çok ihtiyaç duyulan vakada etkisi olmazdı.
        if (syncOk) {
          if (Date.now() - orgStartedAt > ORG_BUDGET_MS) {
            // Bu org bütçesini yedi: import bitti (yazılanlar kalıcı), uyarılar
            // gitti; GERİYE KALAN otomatik MİSAFİR mesajlarını sonraki tura bırak
            // ki sıradakiler aç kalmasın. Sonraki geçiş 2 dakika sonra.
            budgetSkipped += 1;
          } else {
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
              await opsAlarm.ok(orgKey("automation"));
            } catch (err) {
              await handleOrgError("automation", err);
            }
          }
        }

        // ── iCal (Kanal Takvimleri) — 08-08'de eklendi ───────────────────────
        // 🚨 KAPATILAN AÇIK: bu bacak YOKTU. `runScheduledSync` bu modülden
        // hiçbir şey import etmiyordu; iCal'in TEK yolu kullanıcının "Senkronla"
        // düğmesiydi. Host Airbnb bağlantısını ekliyor, bir kez tıklıyor ve
        // besleme orada donuyordu (ertesi günkü rezervasyon panelde yok →
        // temizlik görevi yok, doluluk yanlış, çifte rezervasyon riski).
        //
        // ⚠️ EN SONDA, BİLİNÇLİ. Aynı org içinde mesaj importunun, şikayet
        // uyarısının ve oto-yanıtın ARKASINDA hiçbir feed beklemesi olmasın:
        // asılı bir besleme bu org için HİÇBİR ŞEYİ geciktirmez, yalnız SIRADAKİ
        // org'lara sarkabilir — ve tam olarak onun için bütçe var.
        // ⚠️ `syncOk`'a BAĞLI DEĞİL (`sendDueAlerts` ile aynı gerekçe): iCal tek
        // bir Hospitable API'sine dokunmuyor; Hospitable'ı 402/401 olan ya da
        // Hospitable'ı HİÇ OLMAYAN bir host'un takvimleri senkronlanmaya devam
        // etmeli. iCal-only kiracı zaten `syncHospitable`'dan token'sız erken
        // döndüğü için syncOk=true olur; 402 olan kiracı için ise bu satır
        // düzeltmenin TAMAMIDIR.
        // ⚠️ PREMIUM KAPISI YOK — bilinçli: ücretsiz sürümde de veri senkronu
        // (mesaj importu + uyarılar) sürüyor; kapatılan tek şey otomatik MİSAFİR
        // mesajlaşmasıdır ve iCal importu o sınıfa girmez.
        // ⚠️ `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` BURADAN AÇILMAZ: bu bacak
        // yalnızca `syncCalendarSource`'u çağırır, o da bayrağı KENDİ okur
        // (default KAPALI). Zamanlama uzlaştırmayı AÇMAZ.
        if (icalLegEnabled && icalSpentMs < ICAL_PASS_BUDGET_MS) {
          const icalStartedAt = Date.now();
          try {
            const ical = await syncDueCalendarSourcesForOrg(org.id, {
              deadline: Math.min(
                icalStartedAt + ICAL_ORG_BUDGET_MS,
                icalStartedAt + (ICAL_PASS_BUDGET_MS - icalSpentMs),
                passStartedAt + PASS_BUDGET_MS,
              ),
            });
            icalSources += ical.synced;
            icalImported += ical.imported;
            icalUpdated += ical.updated;
            icalFailed += ical.failed;
            icalDeferred += ical.deferred;
            await opsAlarm.ok(orgKey("ical"));
          } catch (err) {
            // `syncDueCalendarSourcesForOrg` sözleşme gereği fırlatmaz; yine de
            // bir org'un takvimi diğerlerinin geçişini düşüremez.
            await handleOrgError("ical", err);
          }
          icalSpentMs += Date.now() - icalStartedAt;
        } else {
          // Havuz bitti → bu org'un takvim bacağına bu geçişte HİÇ sıra gelmedi.
          // ⚠️ BU SAYI BİR ÜST SINIRDIR, "kaç besleme kaldı" DEĞİL: havuz
          // bittiğinde tek bir sorgu bile atmıyoruz (bütçenin amacı tam da bu),
          // dolayısıyla bu org'un HİÇ beslemesi olmasa da sayılır. Kesin sayı
          // istenirse org başına bir `count` gerekir — yani sistemin zaten
          // bütçeyi aştığı anda N sorgu daha; bilinçli olarak YAPILMADI.
          icalOrgsDeferred += 1;
        }

        // V1 INTELLIGENCE — KB hafızası + event tüketimi + örüntü; org'un TÜM giriş yollarından
        // (Hospitable senkronu VE iCal bacağı) SONRA: bu geçişte yazılan besleme event'leri aynı
        // geçişte tüketilir. AYRI ve KORUMALI: hatası raporlanır, PMS akışını (senkron/oto-yanıt/
        // karşılama/takvim) asla bloklamaz. Hospitable'ı olmayan org da buraya gelir (busy = mülkü var).
        try {
          await runIntelligencePass(org.id);
          await opsAlarm.ok(orgKey("intelligence"));
        } catch (err) {
          await opsAlarm.fail(orgKey("intelligence"), `intelligence-pass org:${org.id}`, err);
        }
      }
      if (icalSources > 0 || icalDeferred > 0 || icalOrgsDeferred > 0) {
        const line =
          `[scheduled-sync] ical: ${icalSources} kaynak işlendi ` +
          `(${icalImported} yeni, ${icalUpdated} güncellendi, ${icalFailed} hatalı) · ` +
          `ertelenen kaynak: ${icalDeferred} · sırası gelmeyen org (üst sınır): ${icalOrgsDeferred} · ` +
          `bütçe: geçiş ${ICAL_PASS_BUDGET_MS} ms (harcanan ${icalSpentMs} ms), org ${ICAL_ORG_BUDGET_MS} ms`;
        // Kırpma varsa WARN: "sessizce kısaltma" yerine operatörün göreceği bir iz.
        if (icalDeferred > 0 || icalOrgsDeferred > 0) console.warn(line);
        else console.log(line);
        if (icalSources > 0) totals.icalSources = icalSources;
        if (icalImported > 0) totals.icalImported = icalImported;
        if (icalUpdated > 0) totals.icalUpdated = icalUpdated;
        if (icalDeferred > 0) totals.icalDeferred = icalDeferred;
        if (icalOrgsDeferred > 0) totals.icalOrgsDeferred = icalOrgsDeferred;
      }
      if (budgetSkipped > 0) {
        totals.budgetSkipped = budgetSkipped;
        console.warn(
          `[scheduled-sync] süre bütçesi: ${budgetSkipped} org bu geçişte atlandı (sonraki turda devam eder)`,
        );
      }
      // ⚠️ KİLİT KAYBI SESSİZ GEÇMEZ. Bu, TTL'in (15 dk) gerçekten aşıldığının
      // KANITIDIR ve tam olarak "heartbeat'li kilide geç" kararının tetikleyicisi
      // olması gereken sinyaldir. Org sayısı ve PII taşımaz.
      if (lockLost) {
        totals.lockLost = true;
        await opsAlarm.fail(
          "lock-lost",
          "scheduled-sync lock-lost",
          new Error(
            "Kilit yenilenemedi (TTL aşıldı ya da başka bir replika devraldı) — geçiş erken kesildi. " +
              `Toplam org: ${orgs.length}.`,
          ),
        );
      } else {
        await opsAlarm.ok("lock-lost");
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
          await opsAlarm.ok("outbox-drain");
        } catch (err) {
          await opsAlarm.fail("outbox-drain", "scheduled-sync outbox-drain", err);
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
        await opsAlarm.ok("storage-deletions");
      } catch (err) {
        await opsAlarm.fail("storage-deletions", "scheduled-sync storage-deletions", err);
      }

      // Kimlik e-postası KURTARMASI — HER geçişte (09-23; eskiden yalnız saatlik derin
      // blokta koşuyordu, ↓ve `recoverEmailOutbox` yorumu). 15 sn'lik poller yalnız drain
      // eder; gönderim ortasında düşen sürecin `claimed` satırını YALNIZ bu geri kazanır.
      // Drain de burada: yalnız harici cron'la çalışan kurulumlar da gecikmesiz teslim eder.
      // Bayrak kapalıyken ikisi de sorgusuz no-op.
      try {
        await recoverEmailOutbox();
        await drainEmailOutboxOnce();
        await opsAlarm.ok("email-outbox");
      } catch (err) {
        await opsAlarm.fail("email-outbox", "scheduled-sync email-outbox", err);
      }

      // KVKK retention sweep — anonymize guest PII for long-past stays. No-op
      // unless DATA_RETENTION_MONTHS is set; runs at most once per deep window so
      // it never burdens the frequent narrow passes. Best-effort, never aborts.
      if (deep) {
        // Saatlik işler. Alarm anahtarı işin adı, e-posta konusu ESKİ başlık (değişmedi);
        // geçiş tabanlı olduğu için kalıcı bir arıza saatte bir değil, bir kez bildirilir.
        const hourly = async (key: string, context: string, fn: () => Promise<unknown>) => {
          try {
            await fn();
            await opsAlarm.ok(key);
          } catch (err) {
            await opsAlarm.fail(key, context, err);
          }
        };
        await hourly("retention", "scheduled-sync retention", () => anonymizeOldGuestData());
        // V1: misafir mesajından türeyen sinyaller aynı saklama süresine tabi (değişmez 14).
        await hourly("signal-retention", "scheduled-sync signal retention", async () => {
          const cutoff = retentionCutoff();
          if (cutoff) await purgeExpiredSignals(cutoff);
        });
        // Marketing-lead retention. No-op unless LEAD_RETENTION_MONTHS is set.
        await hourly("lead-purge", "scheduled-sync lead-purge", () => purgeOldLeads());
        // Distributed rate-limit hygiene: drop counters whose window ended (keys
        // that never return — one-off IPs — would otherwise accumulate forever).
        await hourly("rate-limit-sweep", "scheduled-sync rate-limit-sweep", () => sweepExpiredRateLimits());
        // Parola sıfırlama challenge'ları: süresi dolmuş / tüketilmiş / iptal
        // edilmiş satırları topla. CANLI satıra dokunmaz; 24 saatlik gecikme
        // bilinçli (destek "sıfırlayamıyorum" derse izi bir süre daha durur).
        await hourly("pw-reset-challenge-sweep", "scheduled-sync pw-reset-challenge-sweep", () =>
          sweepPasswordResetChallenges(),
        );
        // Terk edilmiş DOĞRULANMAMIŞ kayıtlar: hesap ön-ele-geçirme
        // düzeltmesinin tamamlayıcısı. Doğrulama artık parola istediği için
        // saldırgan kurbanın adresiyle açtığı hesaba giremiyor — ama hesap
        // orada durdukça `User.email` benzersizliği yüzünden KURBAN da kendi
        // adresiyle kaydolamıyor (register enumeration koruması gereği sessiz
        // 201 döner). Bu süpürge o işgali sonlandırır.
        // 🚨 YIKICI → `UNVERIFIED_SWEEP_ENABLED` DEFAULT KAPALI; bayrak
        // kapalıyken tek sorgu bile koşmaz.
        await hourly("unverified-sweep", "scheduled-sync unverified-sweep", async () => {
          const r = await sweepUnverifiedRegistrations();
          if (r.deleted > 0 || r.failed > 0 || r.skipped > 0) {
            console.log(`[scheduled-sync] unverified-sweep: ${JSON.stringify(r)}`);
          }
        });
        // Reverse-trial reminder emails ("ending soon" / "ended"). No-op unless
        // BILLING_ENFORCED is on; idempotent + per-tenant. Best-effort.
        await hourly("trial-reminders", "scheduled-sync trial-reminders", () => sendDueTrialReminders());
        // Kimlik e-postası kuyruğunun SAKLAMA silmesi (terminal satırlar). Kurtarma + drain
        // artık HER geçişte (↑); burada yalnız silme kaldı.
        await hourly("email-outbox-purge", "scheduled-sync email-outbox", () => purgeEmailOutbox());
        // Alarm durum satırlarının kendisi: 30 gündür dokunulmamış (sahibi silinmiş org vb.).
        await hourly("alert-state-sweep", "scheduled-sync alert-state-sweep", () => sweepStaleAlertStates());
      }
      return totals;
    } finally {
      await releaseLock(holder);
    }
  } finally {
    running = false;
  }
}
