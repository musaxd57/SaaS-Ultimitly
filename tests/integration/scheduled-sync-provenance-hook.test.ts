import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// V0.4 — zamanlanmış senkron her geçişte provenance backfill'ini çağırır
// (bağlantı backfill'inden SONRA: önce satır doğar, sonra o satıra damgalanır) ve
// backfill hatası geçişi BLOKLAMAZ (raporlanır). V0.3'ün bağlantı backfill kancası
// testsiz kalmıştı; bu dosya ikisini birlikte davranışsal pinler.
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
vi.mock("@/lib/channels/connections", async (orig) => {
  const actual = await orig<typeof import("@/lib/channels/connections")>();
  return {
    ...actual,
    backfillChannelConnections: vi.fn(async () => ({ created: 0 })),
    backfillProvenance: vi.fn(async () => ({ connections: 0, reservations: 0, conversations: 0, messages: 0 })),
  };
});

import { runScheduledSync } from "@/lib/scheduled-sync";
import { backfillChannelConnections, backfillProvenance } from "@/lib/channels/connections";
import { reportError } from "@/lib/report-error";

const mockConn = vi.mocked(backfillChannelConnections);
const mockProv = vi.mocked(backfillProvenance);

describe("runScheduledSync × provenance backfill kancası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("her geçişte tam bir kez, bağlantı backfill'inden sonra çağrılır", async () => {
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(mockConn).toHaveBeenCalledTimes(1);
    expect(mockProv).toHaveBeenCalledTimes(1);
    expect(mockConn.mock.invocationCallOrder[0]).toBeLessThan(mockProv.mock.invocationCallOrder[0]);
  });

  it("backfill hatası geçişi bloklamaz: raporlanır, senkron yine tamamlanır", async () => {
    mockProv.mockRejectedValueOnce(new Error("boom"));
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(vi.mocked(reportError)).toHaveBeenCalledWith("provenance-backfill", expect.any(Error));
  });
});
