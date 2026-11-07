import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// V1 — zamanlanmış geçiş intelligence bacağını org başına, senkron/otomasyondan SONRA çağırır
// ve hatası PMS akışını BLOKLAMAZ ("AI bozulsa PMS çalışır"). Retention bloğu (deep geçiş)
// sinyal purge'ünü çağırır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
vi.mock("@/modules/intelligence", async (orig) => {
  const actual = await orig<typeof import("@/modules/intelligence")>();
  return {
    ...actual,
    runIntelligencePass: vi.fn(async () => ({ processed: 0, signals: 0, patternsUpserted: 0 })),
    purgeExpiredSignals: vi.fn(async () => ({ deleted: 0 })),
  };
});

import { runScheduledSync } from "@/lib/scheduled-sync";
import { runIntelligencePass } from "@/modules/intelligence";
import { reportError } from "@/lib/report-error";

const mockPass = vi.mocked(runIntelligencePass);

describe("runScheduledSync × intelligence bacağı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("HOSPITABLE_API_TOKEN", "env-tok");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("işlenen her org için tam bir kez çağrılır (kendi org id'siyle)", async () => {
    const { orgId } = await makeOrgWithProperty();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(mockPass).toHaveBeenCalledTimes(1);
    expect(mockPass).toHaveBeenCalledWith(orgId);
  });

  it("intelligence hatası geçişi bloklamaz: raporlanır, geçiş ok döner", async () => {
    const { orgId } = await makeOrgWithProperty();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    mockPass.mockRejectedValueOnce(new Error("intelligence boom"));
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(vi.mocked(reportError)).toHaveBeenCalledWith(`intelligence-pass org:${orgId}`, expect.any(Error));
  });
});
