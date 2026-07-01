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

import { runScheduledSync } from "@/lib/scheduled-sync";

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
});
