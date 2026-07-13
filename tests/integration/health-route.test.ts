import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// Hermetic: runScheduledSync must never attempt real Hospitable HTTP from a test.
vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
}));

import { GET } from "@/app/api/health/route";
import { runScheduledSync } from "@/lib/scheduled-sync";

function req(strict = false) {
  return new NextRequest(`http://localhost/api/health${strict ? "?strict=1" : ""}`);
}

/** The heartbeat row exactly as a completed scheduler pass leaves it (released lock). */
async function freshHeartbeat() {
  await prisma.systemLock.create({ data: { name: "scheduled-sync", lockedUntil: new Date(0) } });
}

/** Backdate the heartbeat with raw SQL — Prisma's @updatedAt would overwrite it. */
async function ageHeartbeat(sec: number) {
  await prisma.$executeRaw`UPDATE "SystemLock" SET "updatedAt" = ${new Date(Date.now() - sec * 1000)} WHERE "name" = 'scheduled-sync'`;
}

// ---------------------------------------------------------------------------
// /api/health contract (Codex spec):
//   normal → Railway readiness: 200 iff the app answers and the DB is reachable;
//            scheduler state NEVER fails it (deploy gaps must not flap readiness).
//   strict → ops monitor: additionally 503 when the scheduler heartbeat is
//            missing/unknown OR older than the stale threshold.
//   Both: machine-readable { ok, db, sync, lastSyncAgeSec, reason? } + no-store.
//   Skipped-but-alive scheduler passes (no orgs, Hospitable 402, lock held by a
//   concurrent run) still count as healthy — the probe measures "scheduler ran",
//   never external-service health.
// ---------------------------------------------------------------------------
describe("GET /api/health", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("DB up + fresh heartbeat → normal AND strict 200, honest body, no-store", async () => {
    await freshHeartbeat();

    for (const strict of [false, true]) {
      const res = await GET(req(strict));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.db).toBe("up");
      expect(body.sync).toBe("ok");
      expect(typeof body.lastSyncAgeSec).toBe("number");
      expect(body.lastSyncAgeSec).toBeLessThan(60);
      expect(body.reason).toBeUndefined();
    }
  });

  it("DB down → normal AND strict 503 with reason, no-store", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("conn refused"));
    try {
      for (const strict of [false, true]) {
        const res = await GET(req(strict));
        expect(res.status).toBe(503);
        expect(res.headers.get("cache-control")).toBe("no-store");
        const body = await res.json();
        expect(body).toMatchObject({ ok: false, db: "down", sync: "unknown", lastSyncAgeSec: null, reason: "db_unreachable" });
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("heartbeat row missing → normal 200 (readiness lenient), strict 503 sync_unknown", async () => {
    const normal = await GET(req(false));
    expect(normal.status).toBe(200);
    const nb = await normal.json();
    expect(nb).toMatchObject({ ok: true, db: "up", sync: "unknown", lastSyncAgeSec: null });

    const strict = await GET(req(true));
    expect(strict.status).toBe(503);
    const sb = await strict.json();
    expect(sb).toMatchObject({ ok: false, db: "up", sync: "unknown", lastSyncAgeSec: null, reason: "sync_unknown" });
  });

  it("heartbeat read failure while DB is up → normal 200, strict 503 sync_unknown", async () => {
    await freshHeartbeat();
    // Real failure injection instead of vi.spyOn: Prisma's proxy-backed model
    // delegates don't restore reliably after mockRestore, which poisoned every
    // later test. Hiding the table makes the heartbeat read genuinely throw
    // while SELECT 1 still succeeds; the rename-back fully restores state.
    await prisma.$executeRaw`ALTER TABLE "SystemLock" RENAME TO "SystemLock_hidden"`;
    try {
      expect((await GET(req(false))).status).toBe(200);
      const strict = await GET(req(true));
      expect(strict.status).toBe(503);
      expect((await strict.json()).reason).toBe("sync_unknown");
    } finally {
      await prisma.$executeRaw`ALTER TABLE "SystemLock_hidden" RENAME TO "SystemLock"`;
    }
  });

  it("heartbeat older than 15 min → normal 200 (sync visible as stale), strict 503 sync_stale", async () => {
    await freshHeartbeat();
    await ageHeartbeat(16 * 60);

    const normal = await GET(req(false));
    expect(normal.status).toBe(200);
    const nb = await normal.json();
    expect(nb.ok).toBe(true);
    expect(nb.sync).toBe("stale");
    expect(nb.lastSyncAgeSec).toBeGreaterThan(15 * 60);

    const strict = await GET(req(true));
    expect(strict.status).toBe(503);
    const sb = await strict.json();
    expect(sb).toMatchObject({ ok: false, db: "up", sync: "stale", reason: "sync_stale" });
  });

  it("heartbeat just inside the threshold → strict still 200 (boundary)", async () => {
    await freshHeartbeat();
    await ageHeartbeat(14 * 60);
    expect((await GET(req(true))).status).toBe(200);
  });

  it("recent intentionally-skipped scheduler pass (zero orgs, zero work) → strict 200", async () => {
    // No orgs in the DB → the pass acquires the lock, does nothing, releases.
    // That IS the healthy signal: the scheduler ran, even though it skipped all work.
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(totals.organizations).toBe(0);

    const res = await GET(req(true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sync).toBe("ok");
    expect(body.lastSyncAgeSec).toBeLessThan(60);
  });

  it("sync currently RUNNING on another replica (lock held into the future) → strict 200", async () => {
    // A concurrent holder just acquired the lock (updatedAt = now, lockedUntil future).
    // A run in progress is alive, not stale.
    await prisma.systemLock.create({
      data: { name: "scheduled-sync", lockedUntil: new Date(Date.now() + 60_000), holder: "other" },
    });
    const res = await GET(req(true));
    expect(res.status).toBe(200);
    expect((await res.json()).sync).toBe("ok");
  });
});
