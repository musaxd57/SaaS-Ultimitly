import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clearProbeCache, readProbeCache, sharedProbe, writeProbeCache, type ProbeSnapshot } from "@/lib/health-probe";
import { strictQueueState } from "@/lib/outbox/health";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Public health probe. NO auth, NO tenant data and NO external-service calls —
// Paddle/Hospitable/OpenAI state must never flip this endpoint. It reads exactly
// two signals: DB connectivity and the scheduler heartbeat.
//
// NORMAL /api/health — Railway readiness + basic uptime monitor:
//   200 ⇔ the app answers and the DB is reachable. Scheduler state is REPORTED
//   (sync / lastSyncAgeSec) but never fails the probe, so a fresh deploy (no
//   heartbeat row yet) or a post-deploy gap can't flap readiness.
//   DB unreachable → 503 { reason: "db_unreachable" }.
//
// STRICT /api/health?strict=1 — ops monitor (point a SECOND monitor here):
//   additionally 503 when the scheduler heartbeat is missing/unreadable
//   ("sync_unknown") or older than SYNC_STALE_AFTER_SEC ("sync_stale"), so a
//   silently-dead sync loop actually pages you. Kurucu 10-16 (O3-B): ayrıca 503
//   "queue_stalled" — kalıcı kuyruklardan birinde vadesi gelmiş satır 15 dk'dır
//   bekliyor (döngü canlı ama satır ilerlemiyor). Yalnız STRICT: Railway'in
//   hazır olma yoklaması (normal mod) kuyruk yüzünden ASLA düşmez → yeniden
//   başlatma döngüsü yok. Gövde yalnız "ok" / "stalled" söyler (sayı, kimlik yok).
//
// LIVENESS /api/health?live=1 (altyapı envanteri 10-21, madde 57): süreç cevap veriyor mu — veritabanına HİÇ dokunmaz. Kapsayıcı
//   yöneticisi (Docker HEALTHCHECK / ileride ikinci kopya) "yeniden başlat" kararını buna bağlar; DB arızası süreci yeniden başlatma
//   sebebi değildir (yeniden başlatma DB'yi düzeltmez, yalnız döngü üretir). Gövde yalnız { ok: true, live: true }.
//
// Heartbeat = SystemLock("scheduled-sync").updatedAt: every scheduler pass bumps
// it (acquire + release), INCLUDING passes that do no work — zero orgs, per-org
// Hospitable 402 skips, free-tier automation suppression, or a concurrent run
// still holding the lock (its acquire stamped updatedAt). Healthy means "the
// scheduler ran", never "messages flowed" — an inactive Hospitable subscription
// or an intentionally skipped pass is NOT an outage.
//
// Body is machine-readable: { ok, db, sync, lastSyncAgeSec, reason? }; reason
// appears only on 503. Cache-Control: no-store so no proxy/CDN ever serves a
// stale verdict to a monitor.
// ---------------------------------------------------------------------------

// The loop fires every ~2 min (in-process timer + external cron) and the sync
// lock TTL is 15 min: 15 min of heartbeat silence means every trigger AND the
// lock TTL have lapsed — genuinely dead, not merely a long deep-sync pass.
const SYNC_STALE_AFTER_SEC = 15 * 60;

type Health = {
  ok: boolean;
  db: "up" | "down";
  sync: "ok" | "stale" | "unknown";
  lastSyncAgeSec: number | null;
  /** Yalnız strict modda: kalıcı kuyruklar ilerliyor mu. Okunamazsa "unknown" (sayfalamaz — kuyruk okuma hatası ayrı bir arıza değildir). */
  queue?: "ok" | "stalled" | "unknown";
  reason?: "db_unreachable" | "sync_stale" | "sync_unknown" | "queue_stalled";
};

function respond(body: Health, status: 200 | 503) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Veritabanı yoklaması (iki okuma). `"db_down"` = SELECT 1 düştü; `null` = DB ayakta ama nabız satırı okunamadı (→ "unknown").
 * Başarılı okuma önbelleğe yazılır; arıza ASLA (önbellek temizlenir).
 */
async function probeDb(): Promise<ProbeSnapshot | null | "db_down"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    clearProbeCache(); // arıza ASLA cache'lenmez
    return "db_down";
  }
  // Scheduler heartbeat, best-effort: a failed read is reported as "unknown"
  // (strict mode decides whether that pages) — never crashes the probe.
  try {
    const lock = await prisma.systemLock.findUnique({
      where: { name: "scheduled-sync" },
      select: { updatedAt: true },
    });
    const at = Date.now();
    let age: number | null = null;
    let sync: Health["sync"] = "unknown";
    if (lock) {
      age = Math.max(0, Math.round((at - lock.updatedAt.getTime()) / 1000));
      sync = age <= SYNC_STALE_AFTER_SEC ? "ok" : "stale";
    }
    const snapshot: ProbeSnapshot = { at, lastSyncAgeAtRead: age, sync };
    writeProbeCache(snapshot);
    return snapshot;
  } catch {
    // DB answered SELECT 1 but the heartbeat row is unreadable → stay "unknown".
    clearProbeCache();
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("live") === "1") {
    return NextResponse.json({ ok: true, live: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  const strict = req.nextUrl.searchParams.get("strict") === "1";

  // Kısa ömürlü memoizasyon — gerekçe ve test yardımcısı lib/health-probe.ts'te. Önbellek boşsa süren yoklamaya katılınır (Y9).
  let snap = readProbeCache();
  if (!snap) {
    // 1. DB connectivity — fatal in BOTH modes.
    const probed = await sharedProbe(probeDb);
    if (probed === "db_down") {
      return respond(
        { ok: false, db: "down", sync: "unknown", lastSyncAgeSec: null, reason: "db_unreachable" },
        503,
      );
    }
    snap = probed;
  }

  // 2. Scheduler heartbeat. Yaş, okuma ANINDAN itibaren geçen süre eklenerek verilir — yoksa önbellek süresince donmuş bir yaş
  //    raporlanırdı.
  let lastSyncAgeSec: number | null = null;
  let sync: Health["sync"] = "unknown";
  if (snap) {
    lastSyncAgeSec =
      snap.lastSyncAgeAtRead === null ? null : snap.lastSyncAgeAtRead + Math.round((Date.now() - snap.at) / 1000);
    sync = lastSyncAgeSec !== null && lastSyncAgeSec > SYNC_STALE_AFTER_SEC ? "stale" : snap.sync;
  }

  // 3. Verdict. Normal mode is readiness-only; strict pages on a dead scheduler.
  if (strict && sync !== "ok") {
    return respond(
      { ok: false, db: "up", sync, lastSyncAgeSec, reason: sync === "stale" ? "sync_stale" : "sync_unknown" },
      503,
    );
  }
  if (strict) {
    const queue = await strictQueueState();
    if (queue === "stalled") return respond({ ok: false, db: "up", sync, lastSyncAgeSec, queue, reason: "queue_stalled" }, 503);
    return respond({ ok: true, db: "up", sync, lastSyncAgeSec, queue }, 200);
  }
  return respond({ ok: true, db: "up", sync, lastSyncAgeSec }, 200);
}
