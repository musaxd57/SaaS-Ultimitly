import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { reportError } from "@/lib/report-error";
import { getCalendarSourceUrl } from "@/lib/calendar-source-url";
import { parseIcs } from "@/lib/import/ics";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { isPrivateHost, resolvesToPrivate } from "@/lib/net/private-host";
import { loadErasureGuard, acquireErasureLock } from "@/lib/erasure";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { ANON_NAME } from "@/lib/data-retention";

export interface SyncResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const FEED_MAX_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// #23 Feed-disappearance reconciliation (FAZ 2) — DEFAULT OFF.
//
// Some OTAs (Airbnb) REMOVE a cancelled booking's event instead of marking it
// STATUS:CANCELLED, so a silently-gone UID means an upstream cancellation. Reflecting
// that is valuable, but a naive "gone this run → cancel" mass-cancels the feed's OWN
// rows on a partial/transient response (the reason the old inline block stayed OFF).
// This version is SAFE: a stay is cancelled ONLY after it vanishes from >= THRESHOLD
// CONSECUTIVE RELIABLE runs AND for >= MIN wall-clock, is source-bound, and reappears
// reset it atomically. Empty / suspicious-drop / non-reliable fetches never count.
//
// Cadence note (GÜNCELLENDİ 08-08 — eski hâli ARTIK DOĞRU DEĞİL): bu satır bir dönem
// "iCal sync is USER-TRIGGERED … there is no guaranteed interval" diyordu ve bu, feed'lerin
// hiçbir zaman zamanlı senkronlanmamasının GEREKÇESİ değil SONUCUYDU. Zamanlanmış geçiş
// artık `syncDueCalendarSourcesForOrg` üzerinden koşuyor (↓dosya sonu), yani kaynak başına
// kadans ~`ICAL_SYNC_EVERY_MIN` (varsayılan 15 dk).
// ⚠️ BUNUN BU BLOĞA ETKİSİ: iki eşik de AYNEN geçerli — iptal HÂLÂ >= 24 saat duvar-saati
// İSTER, yani 15 dakikalık kadans bir konaklamayı daha erken iptal ETTİREMEZ (sayı eşiği
// zaten 24 saatte fazlasıyla dolar; belirleyici olan duvar-saatidir). Ama bayrak bir gün
// AÇILIRSA iptal artık İNSAN TIKLAMASI OLMADAN kendiliğinden gerçekleşebilir — eskiden
// pratikte hiç koşmuyordu. Bayrak DEFAULT KAPALI kalır (mass-cancel olayı); açma kararı
// bu yeni kadans bilinerek verilmelidir.
// Test-only fault seam: deterministically blow up the reconcile step so the
// catch path (aggregate alarm + import-survives) is testable. Always null in prod.
export const __reconcileHooks: { forceError: Error | null } = { forceError: null };

export function feedReconcileEnabled(): boolean {
  return process.env.ICAL_DISAPPEARANCE_RECONCILE_ENABLED === "1";
}

const FEED_MISSING_THRESHOLD = 2; //            >= 2 consecutive reliable runs missing it
const FEED_MISSING_MIN_MS = 24 * 60 * 60_000; // AND gone >= 24h (user-driven cadence → wall-clock rules)
const SUSPICIOUS_DROP_MIN_BASE = 5; //          only guard a drop when the baseline had >= 5 UIDs
const SUSPICIOUS_DROP_RATIO = 0.5; //           a drop to < 50% of the baseline is treated as partial
const FEED_LOCK_NS = 23; //                     advisory-lock namespace ("#23"), disjoint from the outbox lock

/**
 * 🚨 BOS GECIS BOS OLMALI (denetim 08-08, OLCULDU).
 *
 * Bu yol her eslesen rezervasyona KOSULSUZ `updateMany` yaziyordu: hicbir sey
 * degismese bile. Olculdu — hicbir degisiklik icermeyen bir iCal gecisi
 * **43.252 Prisma islemi, 7.104 satir UPDATE, 61,6 sn** ediyordu ve her
 * `ICAL_SYNC_EVERY_MIN` (varsayilan 15 dk) bunu TEKRARLIYORDU.
 *
 * Takvim senkronu 08-08'de cron'a baglandigi icin bu artik surekli bir yuk:
 * org butcesini (60 sn) HER GECISTE asar, gecis butcesini yer ve 15 dakikalik
 * `SystemLock` TTL'ine dogru iter → `lockLost` → ORTAK KILIT KAYBI, yani ayni
 * org'a paralel iki gecis (tum duplicate korumasinin dayandigi varsayim).
 *
 * ⚠️ `updated` SAYACININ ANLAMI DEGISTI ve bu KASITLI: artik "gercekten degisen
 * satir" sayiyor. Eski sayi ("dokunulan satir") her gecis ayni buyuk sayiyi
 * basiyordu ve bir sey oldugunu SANDIRIYORDU.
 */
const SYNC_COMPARE_SELECT = {
  id: true,
  guestName: true,
  status: true,
  notes: true,
  arrivalDate: true,
  departureDate: true,
  calendarSourceId: true,
} as const;

/** Ayni an mi (null-guvenli, Date kimligine DEGIL degerine bakar). */
function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.getTime() === b.getTime();
}

/** Map a free-text source label to a known reservation channel. */
function channelFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("airbnb")) return "airbnb";
  if (l.includes("booking")) return "booking";
  if (l.includes("direct") || l.includes("doğrudan")) return "direct";
  return "other";
}

/**
 * Fetch an external iCal feed, parse it, and upsert reservations for the
 * given property. Existing reservations (matched by sourceReference / UID)
 * are updated in place; new ones are created. Never throws — failures are
 * captured in the returned result and persisted on the source row.
 */
/**
 * Besleme arızasını KAPALI bir kod kümesine indirger.
 *
 * 🚨 HAM HATA MESAJI ALARMA ASLA GİRMEZ. Feed URL'i bir KİMLİK BİLGİSİDİR —
 * tam da bu yüzden at-rest şifreli (m46 + Faz 4 sentinel). Alt katmanların
 * mesajları ise ana bilgisayar adını TAŞIYOR: `pinned-fetch.ts` "refusing
 * private feed host (<hostname>)" yazıyor, Node'un kendi sistem hataları da
 * "getaddrinfo ENOTFOUND <host>" biçiminde. Alarm e-postaya VE Sentry'ye
 * gidiyor; şifreleyerek koruduğumuz adresin parçasını oraya koymak, korumayı
 * dekoratif hâle getirirdi.
 *
 * İKİNCİ FAYDA — SENTRY GRUPLAMASI: sabit kod, tek arızayı tek Issue'da tutar.
 * Değişken metin (host adı, deneme sayısı) aynı arızayı N ayrı Issue'ya böler;
 * bu deponun `groupingValue()` dersi tam olarak budur.
 */
function classifyFeedFailure(reason: string): string {
  if (reason.includes("too large")) return "feed_too_large";
  const http = reason.match(/HTTP (\d{3})/);
  if (http) return `feed_http_${http[1]}`;
  if (reason.includes("non-https")) return "feed_not_https";
  if (reason.includes("private")) return "feed_private_host";
  if (/timed out|timeout|ETIMEDOUT/i.test(reason)) return "feed_timeout";
  return "feed_unreachable";
}

/**
 * Hataya GEÇİŞTE tek alarm — kardeş "url unreadable" dalının deseninin aynısı.
 *
 * Durum DB'de (`CalendarSource.lastStatus`) yaşar, bellekte değil: yeniden
 * başlatmayı ve replikaları aşar. 2 dakikalık cron aynı bozuk beslemeyi her
 * geçişte görüyor; kapı olmasaydı kalıcı bir 404 operatöre günde 720 alarm
 * yazardı ve alarm kanalı sinyal değerini kaybederdi (bu deponun tekrar tekrar
 * ödediği ders: kalıcı kırmızı bir kapı = kapısızlık).
 *
 * ⚠️ Context KAYNAK BAŞINA — org değil, global değil. CLAUDE.md kuralı: "alarm
 * context'i pencere anahtarıyla AYNI granülerlikte olmalı", yoksa bir kaynağın
 * arızası `reportError`ın 10 dakikalık kovasını yakar ve İKİNCİ bir kaynağın
 * arızası hiç duyurulmadan yutulur.
 */
async function alarmOnErrorTransition(
  source: { lastStatus: string | null },
  sourceId: string,
  code: string,
): Promise<void> {
  if (source.lastStatus === "error") return; // zaten bozuk — ikinci kez uyarma
  await reportError(`ical-sync: feed failed (${sourceId})`, new Error(code));
}

export async function syncCalendarSource(sourceId: string): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, updated: 0, skipped: 0, errors: [] };

  const source = await prisma.calendarSource.findUnique({
    where: { id: sourceId },
    include: { property: { select: { organizationId: true } } },
  });
  if (!source) {
    result.errors.push("Takvim kaynağı bulunamadı.");
    return result;
  }

  // Resolve the feed URL through THE accessor (phase 3 of the url-encryption
  // expand-contract) — never off the row directly. An encrypted value that
  // fails to open means tamper, a foreign ciphertext or a wrong key, and the
  // policy is FAIL CLOSED: this source is skipped, the plaintext column is NOT
  // used as a fallback (that would make the encryption decorative on exactly
  // the rows where it matters). Legacy rows (urlEnc NULL) keep working on the
  // plaintext column until the backfill runs.
  const resolvedUrl = getCalendarSourceUrl(source, source.property.organizationId);
  if (!resolvedUrl.ok) {
    const msg =
      resolvedUrl.reason === "key-fingerprint-mismatch"
        ? "Takvim bağlantısı çözülemedi — şifreleme anahtarı bu kaydın anahtarıyla uyuşmuyor."
        : resolvedUrl.reason === "sentinel-without-ciphertext"
          ? "Takvim bağlantısı çözülemedi — kayıtta şifreli değer eksik (bozuk durum)."
          : "Takvim bağlantısı çözülemedi — şifreli değer bu kayda ait değil (olası kurcalama).";
    result.errors.push(msg);
    // Alarm on the TRANSITION into this state only — the 2-minute cron would
    // otherwise page once per pass for the same broken row.
    if (source.lastStatus !== "error") {
      await reportError(
        `ical-sync: calendar-source url unreadable (${sourceId})`,
        new Error(resolvedUrl.reason),
      );
    }
    await prisma.calendarSource.update({
      where: { id: sourceId },
      data: { lastSyncedAt: new Date(), lastStatus: "error", lastResult: msg },
    });
    return result;
  }
  const feedUrl = resolvedUrl.url;

  const channel = channelFromLabel(source.label);

  // KVKK explicit-erasure gate (m40): iCal rows carry only a UID (no guest
  // id/email/phone), so matching is by source_reference alone — DELIBERATE:
  // hashing free-text SUMMARY names would false-positive on namesakes, and the
  // erased stay's own UID is exactly what a feed re-delivers. The guard is
  // read FRESH inside each row's write-transaction below (RACE MODEL) — no
  // stale run-start copy is ever the write authority.

  // Fetch-start stamp — the ordering key for the disappearance reconciliation (a slower older
  // run must never overwrite a newer run's result). Captured BEFORE the network call.
  const runStartedAt = new Date();

  let text: string;
  try {
    // SSRF pre-check (cheap, defense-in-depth): reject a literal private target
    // or a hostname that currently RESOLVES private. The AUTHORITATIVE guard is
    // fetchFeedText's pinned lookup, which validates the address the socket
    // actually connects to (closing the DNS-rebind TOCTOU this pre-check can't).
    const feedHost = new URL(feedUrl).hostname;
    if (isPrivateHost(feedHost) || (await resolvesToPrivate(feedHost))) {
      throw new Error("blocked private host");
    }
    // node:https/http GET with: pinned public-only IP, NO redirect following
    // (a 3xx is a failure, nothing to re-resolve), a declared + streamed byte
    // cap, and a 15s timeout. HTTPS keeps full cert validation.
    text = await fetchFeedText(feedUrl, {
      maxBytes: FEED_MAX_BYTES,
      timeoutMs: 15000,
      userAgent: "Lixus-AI/1.0",
    });
  } catch (err) {
    // AYIRT EDİLEBİLİR HATA: eskiden her arıza "bağlantıya ulaşılamadı" diyordu.
    // Dosya 10 MB'ı aştığında bağlantıya ULAŞILMIŞTI — host adresi kontrol edip
    // hiçbir sorun bulamıyor ve nerede takıldığını asla anlayamıyordu.
    const reason = err instanceof Error ? err.message : "";
    result.errors.push(
      reason.includes("too large")
        ? "Takvim dosyası çok büyük (10 MB üstü) — içe aktarılamadı."
        : reason.startsWith("HTTP ")
          ? `Takvim sunucusu hata döndürdü (${reason}) — bağlantının hâlâ geçerli olduğunu kontrol edin.`
          : "Bağlantıya ulaşılamadı — takvim (.ics) bağlantısını kontrol edin.",
    );
    await alarmOnErrorTransition(source, sourceId, classifyFeedFailure(reason));
    await prisma.calendarSource.update({
      where: { id: sourceId },
      data: { lastSyncedAt: new Date(), lastStatus: "error", lastResult: result.errors[0] },
    });
    return result;
  }

  // 🚨 SESSİZ ARIZA SINIFI: iCalendar OLMAYAN bir gövde (sağlayıcının HTML hata
  // sayfası, süresi dolmuş token için giriş ekranı, kesilmiş dosya) `parseIcs`ten
  // SIFIR olayla döner — ve `parseIcs` hiçbir zaman fırlatmaz. Eski kod bunu
  // "Yeni rezervasyon bulunamadı" diye özetleyip `lastStatus:"ok"` yazıyordu:
  // KALICI olarak bozuk bir besleme ekranda SAĞLIKLI görünüyordu ve host
  // rezervasyonlarının neden gelmediğini asla anlayamazdı.
  //
  // Ayrım GÜVENLİ: RFC 5545 `BEGIN:VCALENDAR`ı ZORUNLU kılar, yani GERÇEKTEN boş
  // ama geçerli bir takvim de bu satırı taşır → "boş feed" ile "feed değil"
  // birbirine karışmaz (mass-cancel dersinin korunması bu ayrıma bağlı).
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    const msg =
      "Bağlantı takvim (.ics) dosyası döndürmedi — adres bir giriş/hata sayfasına gidiyor olabilir.";
    result.errors.push(msg);
    await alarmOnErrorTransition(source, sourceId, "feed_not_icalendar");
    await prisma.calendarSource.update({
      where: { id: sourceId },
      data: { lastSyncedAt: new Date(), lastStatus: "error", lastResult: msg },
    });
    return result;
  }

  const rows = parseIcs(text);
  // Every UID seen in THIS feed (incl. cancelled ones) → used below to reconcile
  // reservations that silently disappeared from the feed.
  const seenRefs = new Set<string>();
  // #4 (Codex): keep only the FIRST row-failure sample; a SINGLE aggregate
  // reportError fires after the loop (never one-per-row → no event/log flood).
  let firstRowError: unknown;

  for (const row of rows) {
    if (row.sourceReference) seenRefs.add(row.sourceReference);
    if (!row.guestName || !row.arrivalDate || !row.departureDate) {
      result.skipped++;
      continue;
    }
    if (
      isNaN(row.arrivalDate.getTime()) ||
      isNaN(row.departureDate.getTime()) ||
      row.departureDate <= row.arrivalDate
    ) {
      result.skipped++;
      continue;
    }
    // WRITE-TX (RACE MODEL, erasure.ts): every row write runs inside the
    // org-scoped erasure advisory lock with a FRESH guard read — either this
    // commits before an erasure (which then masks it) or it sees the fresh
    // tombstones and refuses. The stale pre-loaded guard is NOT the authority.
    // Task side effects run AFTER the commit (lock held only for the write).
    // NOTE: the CREATE dedupe-hit (P2002) now aborts the row-transaction and is
    // classified in the OUTER catch — same skip semantics as before.
    try {
      const action = await prisma.$transaction(
        async (tx): Promise<
          | { kind: "erased" | "skip" }
          // "unchanged" = satır ZATEN aynı, YAZMA YOK. `skip`ten ayrı bir kind
          // olması ŞART: sayaç açısından ikisi de "skipped" ama yalnız bunda
          // görev onarımı koşuyor (↓gerekçe). Aynı kind'a katlamak, onarımı
          // gerçekten atlanan satırlara da uygulardı.
          | { kind: "unchanged"; id: string; healTasks: boolean }
          | { kind: "cancelled" | "updated" | "created"; id: string }
        > => {
          await acquireErasureLock(tx, source.property.organizationId);
          const fresh = await loadErasureGuard(source.property.organizationId, tx);
          // Explicitly-erased stay re-appearing in the feed → never re-import
          // (KVKK Regulation art. 8: erased data must stay unusable). Checked
          // AFTER the seenRefs.add above on purpose: the UID *is* present in the
          // feed, and the disappearance-reconcile must keep seeing it.
          if (!fresh.isEmpty && fresh.blocksSourceReference(row.sourceReference)) {
            return { kind: "erased" };
          }

          // BOUND-FIRST lookup (Codex round-5): match a row already owned by THIS
          // source; only a LIVE event may fall back to a legacy calendarSourceId=NULL
          // row (one-time adoption). A CANCELLED event never touches an unowned row —
          // safer default: an upstream-cancelled legacy row simply stays until a live
          // match or manual cleanup (bounded staleness, zero cross-source risk).
          const bound = row.sourceReference
            ? await tx.reservation.findFirst({
                where: { propertyId: source.propertyId, sourceReference: row.sourceReference, calendarSourceId: source.id },
                select: SYNC_COMPARE_SELECT,
              })
            : null;
          const legacy =
            !bound && row.sourceReference && row.status !== "CANCELLED"
              ? await tx.reservation.findFirst({
                  where: { propertyId: source.propertyId, sourceReference: row.sourceReference, calendarSourceId: null },
                  select: SYNC_COMPARE_SELECT,
                })
              : null;
          const existing = bound ?? legacy;

          // Feed explicitly marks the booking CANCELLED → reflect it locally (cancel +
          // drop the auto tasks), never import it as a live stay.
          if (row.status === "CANCELLED") {
            if (existing && existing.status !== "cancelled") {
              // Only a row ALREADY bound to this source may be cancelled (ownership
              // re-checked atomically inside the UPDATE; legacy NULL is never here —
              // the lookup above excludes it for CANCELLED events).
              const resC = await tx.reservation.updateMany({
                where: { id: existing.id, calendarSourceId: source.id },
                data: { status: "cancelled" },
              });
              if (resC.count === 1) return { kind: "cancelled", id: existing.id };
            }
            return { kind: "skip" };
          }

          if (existing) {
            // KVKK resurrection guard: once the retention sweep has anonymized this
            // row (guestName === ANON_NAME), NEVER let a re-import write the guest's
            // name/notes back from the feed. Dates (non-PII) still refresh so
            // occupancy stays correct. Mirrors the hospitable-sync.ts guard.
            const scrubbed = existing.guestName === ANON_NAME;
            // ↑SYNC_COMPARE_SELECT: yazacagimiz her alan ZATEN ayniysa ve satir
            // ZATEN bu kaynaga bagliysa hicbir sey yazma. `scrubbed` satirda
            // ad/not zaten yazilmadigi icin karsilastirmaya da girmezler
            // (KVKK anonimlestirmesini "degisiklik" sayip geri yazmayi denemek
            // dirilme olurdu). Iptalden donen satir DAIMA yazilir.
            const unchanged =
              existing.calendarSourceId === source.id &&
              existing.status !== "cancelled" &&
              sameInstant(existing.arrivalDate, row.arrivalDate) &&
              sameInstant(existing.departureDate, row.departureDate) &&
              (scrubbed ||
                (existing.guestName === row.guestName.slice(0, 200) &&
                  (existing.notes ?? null) === (row.notes ? row.notes.slice(0, 5000) : null)));
            if (unchanged) {
              // ⚠️ ATLAMA, GÖREV ONARIMINI DA ÖLDÜRÜYORDU (denetim 08-08).
              // Eski koşulsuz UPDATE'in yan etkisi olarak her geçişte
              // `createReservationTasks` çağrılıyordu ve bu, görev otomasyonundan
              // ÖNCE içeri girmiş satırların görevlerini geriye dönük açan TEK
              // yoldu (ayrıca create sırasında geçici bir hata olduysa onarıyordu).
              // Yazmayı atlamak onu da atlıyordu → satır sonsuza dek görevsiz.
              // ÇÖZÜM maliyeti sınırlamak: onarım YALNIZ konaklaması BİTMEMİŞ
              // satırlar için koşar. Geçmiş konaklamaya görev açmak zaten
              // anlamsız, ve bu sınır kümeyi bir dairenin gelecek rezervasyonları
              // kadar küçültüyor (ölçülen 7.104 satırlık yükün kaynağı, çoktan
              // bitmiş konaklamalardı).
              return {
                kind: "unchanged" as const,
                id: existing.id,
                healTasks: row.departureDate >= new Date(),
              };
            }

            // ATOMIC adoption: ownership re-checked inside the UPDATE (count 0 = a
            // concurrent source claimed the legacy NULL row first → not ours, skip).
            const resU = await tx.reservation.updateMany({
              where: { id: existing.id, OR: [{ calendarSourceId: source.id }, { calendarSourceId: null }] },
              data: {
                ...(scrubbed
                  ? {}
                  : {
                      guestName: row.guestName.slice(0, 200),
                      notes: row.notes ? row.notes.slice(0, 5000) : null,
                    }),
                arrivalDate: row.arrivalDate,
                departureDate: row.departureDate,
                // (Re-)bind to THIS source: legacy pre-binding rows heal on their
                // first match, making them reconcilable again — safely scoped.
                calendarSourceId: source.id,
                // Re-confirm a stay that had been cancelled but now reappears live.
                ...(existing.status === "cancelled" ? { status: "confirmed" } : {}),
              },
            });
            if (resU.count === 0) return { kind: "skip" };
            return { kind: "updated", id: existing.id };
          }

          const created = await tx.reservation.create({
            data: {
              propertyId: source.propertyId,
              guestName: row.guestName.slice(0, 200),
              arrivalDate: row.arrivalDate,
              departureDate: row.departureDate,
              channel,
              status: "confirmed",
              sourceReference: row.sourceReference ? row.sourceReference.slice(0, 200) : null,
              calendarSourceId: source.id,
              notes: row.notes ? row.notes.slice(0, 5000) : null,
              currency: "EUR",
            },
          });
          return { kind: "created", id: created.id };
        },
        { timeout: 60_000, maxWait: 15_000 },
      );

      // Post-commit side effects + counters (idempotent, best-effort as before).
      switch (action.kind) {
        case "erased":
        case "skip":
          result.skipped++;
          break;
        case "unchanged":
          // Yazma YOK (satır zaten aynı) ama görev onarımı korunuyor — ↑gerekçe.
          if (action.healTasks) await createReservationTasks(action.id);
          result.skipped++;
          break;
        case "cancelled":
          await removeAutoTasksForCancelledReservation(action.id);
          result.updated++;
          break;
        case "updated":
          // Backfill tasks for reservations imported before task automation existed.
          await createReservationTasks(action.id);
          result.updated++;
          break;
        case "created":
          await createReservationTasks(action.id);
          result.imported++;
          break;
      }
    } catch (err) {
      // DEDUPE-HIT on @@unique([propertyId, sourceReference]) ONLY: the UID
      // already exists on a row BOUND TO ANOTHER SOURCE (our bound-first lookup
      // deliberately doesn't see it) or raced in. Source-binding rule: never
      // mutate another source's row — skip. (The P2002 aborts the row-TX, so it
      // surfaces HERE now; nothing else was written in that TX by design.)
      if (isUniqueViolation(err, ["propertyId", "sourceReference"])) {
        result.skipped++;
        continue;
      }
      // Surface the real cause — a BARE catch here hid systematic failures (schema
      // drift, a DB outage) so an import that dropped rows still looked fine and no
      // one was alerted. But do NOT alert PER ROW: a systematic fault can fail EVERY
      // row, and one Sentry event + log line per row means hundreds/thousands of
      // duplicates (the alert email is throttled per-context, but the Sentry events
      // and Railway logs are NOT). Keep just the FIRST sample; a single aggregate
      // reportError fires after the loop.
      if (result.errors.length === 0) firstRowError = err;
      result.errors.push("Kaydetme sırasında bir sorun oluştu, tekrar deneyin.");
      result.skipped++;
    }
  }

  // #4 (Codex): ONE alert per sync run — never per row. If ANY row failed, report
  // exactly once here with an AGGREGATE count + the representative cause. No guest
  // name / body / row data is added — only the failure count; redactSensitive still
  // strips PII from the sample. Context stays stable ("import.sync") so the email
  // throttle keys per run-type, not per varying count. Fire-and-forget (never throws).
  if (result.errors.length > 0) {
    const sample =
      firstRowError instanceof Error ? firstRowError : new Error(String(firstRowError));
    const aggregate = new Error(
      `${result.errors.length} satır kaydedilemedi — örnek hata: ${sample.message}`,
    );
    aggregate.stack = sample.stack;
    void reportError("import.sync", aggregate);
  }

  // Feed-disappearance reconciliation (#23, FAZ 2) — DEFAULT OFF. All the mass-cancel guards
  // (consecutive-reliable-miss threshold + wall-clock minimum + suspicious-drop/empty skip +
  // strict source binding + per-source lock + stale-run ordering) live in the function. It only
  // runs after a SUCCESSFUL fetch; the explicit STATUS:CANCELLED path above is unaffected.
  // Best-effort: a reconciliation hiccup must never turn a good import into a failure.
  let reconcileWarning: string | null = null;
  if (feedReconcileEnabled()) {
    try {
      if (__reconcileHooks.forceError) throw __reconcileHooks.forceError;
      const rec = await reconcileFeedDisappearance({ source, channel, seenRefs, runStartedAt });
      result.updated += rec.cancelled;
      reconcileWarning = rec.warning;
    } catch (err) {
      // Never fail the import on reconciliation — but never stay SILENT either
      // (Codex 07-23 #6): if reconcile keeps crashing while the flag is on,
      // feed cancellations simply stop applying and the operator could not see
      // it. Per-source context → reportError's own context-throttle collapses a
      // crash-loop into ONE aggregate alarm per source (error text is redacted
      // inside reportError); the run result also carries an operator-visible
      // "⚠" line (lastResult), so the panel shows it without breaking the import.
      reconcileWarning = "Kaybolma-uzlaştırma hatası — feed iptalleri bu koşuda uygulanamadı";
      await reportError(`ical.reconcile:${source.id}`, err instanceof Error ? err : new Error(String(err))).catch(() => {});
    }
  }

  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} yeni rezervasyon`);
  if (result.updated > 0) parts.push(`${result.updated} güncellendi`);
  if (result.skipped > 0) parts.push(`${result.skipped} atlandı`);
  if (result.errors.length) parts.push(`${result.errors.length} hata`);
  if (reconcileWarning) parts.push(`⚠ ${reconcileWarning}`);
  const summary = parts.length ? parts.join(", ") : "Yeni rezervasyon bulunamadı";

  await prisma.calendarSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: new Date(),
      // ANY error surfaces as "error" — a PARTIAL import (some rows failed) must not
      // report "ok" and hide the failures. The summary line carries the exact counts.
      lastStatus: result.errors.length ? "error" : "ok",
      lastResult: summary,
    },
  });

  return result;
}

/**
 * FAZ 2 — reconcile reservations that silently disappeared from a calendar feed. Runs ONLY
 * after a successful fetch, and internally enforces every safety gate:
 *  • per-source advisory lock → two concurrent syncs never double-count a miss;
 *  • stale-run ordering → an older/slower run never overwrites a newer one's result;
 *  • empty / suspicious-drop feed → NEVER counts a miss (audit warning instead);
 *  • a stay is cancelled ONLY after >= THRESHOLD consecutive reliable misses AND >= MIN
 *    wall-clock, is source-bound, and reappearing resets the streak atomically;
 *  • cancel is a one-time status flip (no DELETE); only system auto-tasks are cleared.
 * `now` / `runStartedAt` are injectable for deterministic tests.
 */
export async function reconcileFeedDisappearance(opts: {
  source: { id: string; propertyId: string };
  channel: string;
  seenRefs: Set<string>;
  runStartedAt: Date;
  now?: Date;
}): Promise<{ cancelled: number; warning: string | null }> {
  const { source, channel, seenRefs, runStartedAt } = opts;
  const now = opts.now ?? new Date();
  const eventCount = seenRefs.size;
  const cancelledIds: string[] = [];
  let warning: string | null = null;

  await prisma.$transaction(async (tx) => {
    // Serialize this source's reconciliation (namespaced advisory lock, disjoint from the
    // outbox claim lock). Non-blocking: if another sync holds it, skip — the other run does it.
    const gate = await tx.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${FEED_LOCK_NS}::int4, hashtext(${source.id})) AS locked`,
    );
    if (!gate[0]?.locked) return;

    const src = await tx.calendarSource.findUnique({
      where: { id: source.id },
      select: { lastFeedEventCount: true, lastReconcileAt: true },
    });
    if (!src) return;
    // Stale-run guard: a newer reliable run already reconciled → don't let this older run overwrite.
    if (src.lastReconcileAt && runStartedAt <= src.lastReconcileAt) return;

    // RELIABILITY GATE 1 — empty / unparseable feed never mass-cancels (keep the last baseline).
    if (eventCount === 0) {
      warning = "Takvim akışı boş/okunamadı — kayıp uzlaştırması bu turda atlandı.";
      return;
    }
    // RELIABILITY GATE 2 — a suspicious sudden drop is treated as a partial feed: skip miss
    // tracking this run AND keep the TRUSTED baseline (Codex). Earlier this lowered the
    // baseline to the suspicious count, which QUARANTINE-DEFEATED itself: 100→10 skipped once,
    // but baseline became 10, so the SAME partial feed (10) was no longer "suspicious" next run
    // → the 90 missing rows accrued misses and could mass-cancel after 2 misses + 24h. Keeping
    // the high baseline means a sustained partial NEVER reconciles until a FULL feed reappears
    // (≥ ratio of the baseline) — the deliberate, safe bias for this feature (mass-cancel = never
    // again). A genuinely-shrunk feed simply won't auto-cancel; the host sees the rows linger.
    if (
      src.lastFeedEventCount != null &&
      src.lastFeedEventCount >= SUSPICIOUS_DROP_MIN_BASE &&
      eventCount < src.lastFeedEventCount * SUSPICIOUS_DROP_RATIO
    ) {
      warning = `Takvim akışı ${src.lastFeedEventCount} → ${eventCount} ani düşüş (kısmi olabilir) — kayıp uzlaştırması bu turda atlandı.`;
      await tx.calendarSource.update({
        where: { id: source.id },
        data: { lastReconcileAt: runStartedAt }, // baseline KORUNUR — suspicious sayı bazı ezmez
      });
      return;
    }

    // RELIABLE run. Candidates: only FUTURE, source-bound, still-active rows of THIS feed.
    const candidates = await tx.reservation.findMany({
      where: {
        propertyId: source.propertyId,
        channel,
        calendarSourceId: source.id, // source binding — never touch another source / Hospitable / legacy-NULL
        sourceReference: { not: null },
        status: { in: ["confirmed", "pending"] },
        arrivalDate: { gt: now },
      },
      select: { id: true, sourceReference: true, feedMissingCount: true, feedFirstMissingAt: true },
    });

    for (const r of candidates) {
      const present = r.sourceReference != null && seenRefs.has(r.sourceReference);
      if (present) {
        // Reappeared / still there → reset the missing streak atomically.
        await tx.reservation.updateMany({
          where: { id: r.id },
          data: { feedMissingCount: 0, feedFirstMissingAt: null, feedLastSeenAt: runStartedAt },
        });
        continue;
      }
      // Missing this run → grow the streak; anchor firstMissing on the first miss.
      const count = (r.feedMissingCount ?? 0) + 1;
      const firstMissing = r.feedFirstMissingAt ?? runStartedAt;
      await tx.reservation.updateMany({
        where: { id: r.id },
        data: { feedMissingCount: count, feedFirstMissingAt: firstMissing },
      });
      // Cancel ONLY when BOTH thresholds are crossed. One-time, source-bound + still-active
      // re-checked atomically inside the UPDATE.
      if (count >= FEED_MISSING_THRESHOLD && now.getTime() - firstMissing.getTime() >= FEED_MISSING_MIN_MS) {
        const res = await tx.reservation.updateMany({
          where: { id: r.id, calendarSourceId: source.id, status: { in: ["confirmed", "pending"] } },
          data: { status: "cancelled" },
        });
        if (res.count === 1) cancelledIds.push(r.id);
      }
    }

    await tx.calendarSource.update({
      where: { id: source.id },
      data: { lastFeedEventCount: eventCount, lastReconcileAt: runStartedAt },
    });
  });

  // Auto-task cleanup for the cancelled stays — ONLY system-origin tasks (manual/ai preserved).
  // Best-effort, outside the tx so a task hiccup never rolls back a correct cancellation.
  for (const id of cancelledIds) {
    await removeAutoTasksForCancelledReservation(id).catch(() => {});
  }
  return { cancelled: cancelledIds.length, warning };
}

/** Sync every calendar source belonging to an organization. */
export async function syncAllSourcesForOrg(orgId: string): Promise<SyncResult & { sources: number }> {
  const sources = await prisma.calendarSource.findMany({
    where: { property: { organizationId: orgId } },
    select: { id: true },
  });

  const total: SyncResult & { sources: number } = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    sources: sources.length,
  };

  for (const s of sources) {
    const r = await syncCalendarSource(s.id);
    total.imported += r.imported;
    total.updated += r.updated;
    total.skipped += r.skipped;
    total.errors.push(...r.errors);
  }

  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZAMANLANMIŞ iCal GEÇİŞİ (08-08 — GERÇEK AÇIK, kod-doğrulandı)
//
// 🚨 BULGU: iCal beslemeleri HİÇBİR ZAMAN zamanlı senkronlanmıyordu. Zincirin
// tamamı kullanıcı tıklamasına bağlıydı: `syncAllSourcesForOrg`'un TEK çağıranı
// `/api/calendar/sync` (oturum-kapılı; üstelik ön yüzde HİÇBİR çağıranı yok) ve
// `syncCalendarSource`'un tek dış çağıranı `/api/calendar-sources/[id]/sync`
// ("Senkronla" düğmesi). `runScheduledSync` bu modülden HİÇBİR ŞEY import
// etmiyordu. Sonuç: host Airbnb iCal bağlantısını ekliyor, bir kez tıklıyor ve
// besleme ORADA DONUYOR — ertesi gün gelen rezervasyon panelde/takvimde
// GÖRÜNMÜYOR, temizlik görevi doğmuyor, doluluk yanlış → ÇİFTE REZERVASYON.
//
// ⚠️ İKİNCİ BİR FETCH YOLU YAZILMADI: bu fonksiyon `syncCalendarSource`'u
// çağırır, yani `fetchFeedText`in TÜM sertleştirmesi (yalnız-HTTPS, DNS-rebind
// pinlemesi, 15 sn TOPLAM duvar-saati, 10 MB akış tavanı, redirect yok), KVKK
// silme kapısı, kaynak-bağlama kuralları ve `reconcileFeedDisappearance`'ın
// kaynak-başına advisory kilidi AYNEN geçerlidir.
//
// ⚠️ KAYNAK-BAŞINA KADANS = `lastSyncedAt`. Ayrı bir "claim" kolonu YOK ve
// GEREKMİYOR: `syncCalendarSource` ÜÇ çıkış yolunun HEPSİNDE `lastSyncedAt`
// yazıyor (url çözülemedi / fetch hatası / başarı), zamanlanmış geçiş de
// global `scheduled-sync` SystemLock'u altında TEK koşu olarak sürüyor. Yan
// fayda: host "Senkronla"ya elle bastığında damga ilerler ve zamanlayıcı o
// kaynağı bir pencere boyunca TEKRAR çekmez — iki yol tek saati paylaşır.
// ⚠️ Kalan tek yarış "elle tıklama ile zamanlı geçişin ÇAKIŞMASI"dır ve bu
// BUGÜN DE VAR (iki host aynı anda tıklayabiliyor): satır-başına TX +
// `@@unique([propertyId, sourceReference])` + `isUniqueViolation` → sonuç
// duplicate DEĞİL, "skip". Yeni bir kilit primitifi UYDURULMADI.
// ─────────────────────────────────────────────────────────────────────────────

/** Bir kaynağın yeniden çekilmeden önce beklemesi gereken süre (kaynak-başına kadans). */
export function icalSyncEveryMs(): number {
  const min = Number(process.env.ICAL_SYNC_EVERY_MIN);
  return (Number.isFinite(min) && min > 0 ? min : 15) * 60_000;
}

/**
 * Tek geçişte bir org'dan BELLEĞE alınacak en fazla kaynak satırı. Verim sınırı
 * DEĞİL, bellek koruması: gerçek sınır duvar-saati bütçesidir. Aşılırsa fark
 * `deferred`'a düşer (sayım `count` ile YAPILDIĞI için tavan kırpması da
 * görünür kalır — sessiz kırpma yok).
 */
const ICAL_MAX_SOURCES_PER_ORG_PASS = 100;

export interface ScheduledIcalResult {
  /** Bu geçişte işlenmeye ADAY (vadesi gelmiş) kaynak sayısı. */
  due: number;
  /** Bu geçişte GERÇEKTEN işlenen kaynak sayısı (hatayla bitenler DAHİL). */
  synced: number;
  /** Bütçe/tavan yüzünden SONRAKİ geçişe bırakılanlar. İş KAYBI değil, gecikme. */
  deferred: number;
  imported: number;
  updated: number;
  /** Hata döndüren ya da fırlatan kaynak sayısı. */
  failed: number;
}

/**
 * Bir org'un VADESİ GELMİŞ takvim kaynaklarını, verilen duvar-saati son anına
 * kadar senkronlar. Zamanlanmış geçişin (`runScheduledSync`) iCal bacağı.
 *
 * 🚨 ASLA FIRLATMAZ: tek bir bozuk kaynak ne org döngüsünü ne de Hospitable
 * mesaj senkronunu düşürebilir.
 *
 * 🚨 BESLEMESİ OLMAYAN KİRACI = TEK `count` SORGUSU, sıfır iş, sıfır hata.
 * (`count` bilinçli olarak `findMany`'den ÖNCE: hem boş kiracıda satır
 * yüklemiyoruz hem de tavan kırpması `deferred`'da doğru görünüyor.)
 *
 * ⚠️ `deadline` KOŞAN İŞİ KESMEZ — JS tek iş parçacıklı, `syncCalendarSource`
 * bizim açımızdan bölünemez. Sağladığı şey YENİ İŞ BAŞLATMAMAKTIR; bu, deponun
 * `PASS_BUDGET_MS`/`ORG_BUDGET_MS` disipliniyle BİREBİR aynı sözleşmedir.
 * Tek kaynağın kendi tavanı `fetchFeedText`in 15 sn'lik toplam deadline'ıdır
 * (artı ayrıştırma + satır yazımları).
 */
export async function syncDueCalendarSourcesForOrg(
  orgId: string,
  opts: { deadline: number; now?: Date },
): Promise<ScheduledIcalResult> {
  const result: ScheduledIcalResult = {
    due: 0,
    synced: 0,
    deferred: 0,
    imported: 0,
    updated: 0,
    failed: 0,
  };
  // Bütçe zaten dolmuşsa TEK SORGU BİLE koşmaz.
  if (Date.now() >= opts.deadline) return result;

  const now = opts.now ?? new Date();
  const dueBefore = new Date(now.getTime() - icalSyncEveryMs());
  // VADE KOŞULU: hiç senkronlanmamış (host yeni ekledi → sıradaki geçişte,
  // yani ≤2 dakikada içeri düşer) VEYA kadans penceresi dolmuş.
  const where: Prisma.CalendarSourceWhereInput = {
    property: { organizationId: orgId },
    OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }],
  };

  try {
    result.due = await prisma.calendarSource.count({ where });
  } catch (err) {
    await reportError("ical.scheduled count", err instanceof Error ? err : new Error(String(err)));
    return result;
  }
  if (result.due === 0) return result;

  let sources: { id: string }[];
  try {
    sources = await prisma.calendarSource.findMany({
      where,
      select: { id: true },
      // EN BAYAT ÖNCE (hiç senkronlanmamışlar en başta). Bütçe kırpınca sıradaki
      // geçiş kaldığı yerden devam eder → aynı kaynaklar sürekli aç kalmaz.
      orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: ICAL_MAX_SOURCES_PER_ORG_PASS,
    });
  } catch (err) {
    await reportError("ical.scheduled list", err instanceof Error ? err : new Error(String(err)));
    return result;
  }

  for (const s of sources) {
    // Son an KONTROLÜ İŞ BAŞLAMADAN ÖNCE (↑sözleşme).
    if (Date.now() >= opts.deadline) break;
    try {
      const r = await syncCalendarSource(s.id);
      result.synced += 1;
      result.imported += r.imported;
      result.updated += r.updated;
      if (r.errors.length > 0) result.failed += 1;
    } catch (err) {
      // `syncCalendarSource` sözleşme gereği fırlatmaz, ama ayrıştırma/DB gibi
      // beklenmedik bir yol fırlatırsa: (a) org döngüsü DEVAM ETMELİ, (b) satır
      // damgalanmalı. Damgalamazsak kaynak SONSUZA KADAR "vadesi gelmiş" kalır
      // ve HER geçişte yeniden denenip bütçeyi yakar (kardeşlerini aç bırakır).
      result.synced += 1;
      result.failed += 1;
      await reportError(
        `ical.scheduled:${s.id}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      await prisma.calendarSource
        .update({
          where: { id: s.id },
          data: {
            lastSyncedAt: new Date(),
            lastStatus: "error",
            lastResult: "Senkronizasyon beklenmedik bir hatayla durdu.",
          },
        })
        .catch(() => {});
    }
  }

  // Hem bütçe kırpmasını hem `take` tavanını KAPSAR (`due` gerçek sayım).
  result.deferred = Math.max(0, result.due - result.synced);
  return result;
}
