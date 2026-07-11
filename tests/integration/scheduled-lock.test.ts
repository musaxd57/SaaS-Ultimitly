import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// Hospitable is "configured" so runScheduledSync proceeds to the lock stage,
// but listProperties returns nothing so the run is a fast no-op.
vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
}));

import { runScheduledSync, withSyncLock } from "@/lib/scheduled-sync";

describe("runScheduledSync cross-instance lock", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("runs and releases the lock so the next run can acquire it again", async () => {
    const first = await runScheduledSync();
    expect(first.ok).toBe(true);

    const lock = await prisma.systemLock.findUnique({ where: { name: "scheduled-sync" } });
    expect(lock).not.toBeNull();
    // Released → lockedUntil reset to the epoch (free).
    expect(lock!.lockedUntil.getTime()).toBe(0);

    const second = await runScheduledSync();
    expect(second.ok).toBe(true);
  });

  it("a held lock blocks a concurrent run", async () => {
    // Simulate another replica holding the lock into the future.
    await prisma.systemLock.create({
      data: { name: "scheduled-sync", lockedUntil: new Date(Date.now() + 60_000) },
    });

    const res = await runScheduledSync();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("locked");
  });

  it("fencing: a run whose lock was taken over (TTL lapse) does not release the new owner's lock", async () => {
    await withSyncLock(async () => {
      // Simulate another replica re-acquiring after our TTL lapsed: overwrite the
      // holder token and push the expiry into the future while we're still "running".
      await prisma.systemLock.update({
        where: { name: "scheduled-sync" },
        data: { holder: "other-run", lockedUntil: new Date(Date.now() + 60_000) },
      });
    });
    // Our releaseLock(originalHolder) must be a no-op — the takeover lock stands,
    // instead of being yanked back to the epoch (which would have let a third run
    // barge in while "other-run" is still going).
    const lock = await prisma.systemLock.findUnique({ where: { name: "scheduled-sync" } });
    expect(lock!.holder).toBe("other-run");
    expect(lock!.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("deep-sweep cadence (SystemLock-shared)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("one deep per window across replicas/restarts: first run claims, second stays narrow, expiry re-claims", async () => {
    await runScheduledSync(); // first ever run claims the deep slot
    const row1 = await prisma.systemLock.findUnique({ where: { name: "deep-sync-cadence" } });
    expect(row1).not.toBeNull();
    expect(row1!.lockedUntil.getTime()).toBeGreaterThan(Date.now()); // next deep scheduled

    await runScheduledSync(); // inside the window → narrow, cadence untouched
    const row2 = await prisma.systemLock.findUnique({ where: { name: "deep-sync-cadence" } });
    expect(row2!.lockedUntil.getTime()).toBe(row1!.lockedUntil.getTime());

    // Window elapses (as it would after HOSPITABLE_DEEP_EVERY_MIN) → next run re-claims.
    await prisma.systemLock.update({ where: { name: "deep-sync-cadence" }, data: { lockedUntil: new Date(0) } });
    await runScheduledSync();
    const row3 = await prisma.systemLock.findUnique({ where: { name: "deep-sync-cadence" } });
    expect(row3!.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });
});
