import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Zamanlanmış geçiş: temizlik-sonrası erken giriş yeniden kontrolü org başına, oto-yanıt geçişinden ÖNCE koşar
// (yeniden aday yapılan konuşma AYNI geçişte cevaplanabilsin) ve hatası oto-yanıtı BLOKLAMAZ ("bağlantı var mı"
// davranışsal — yüklem var, argüman yok sınıfı).
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
vi.mock("@/lib/early-checkin/recheck", () => ({
  recheckEarlyCheckinsAfterCleaning: vi.fn(async () => 0),
}));
vi.mock("@/lib/automation", async (orig) => {
  const actual = await orig<typeof import("@/lib/automation")>();
  return { ...actual, runDueChannelAutoReplies: vi.fn(async () => ({ sent: 0, considered: 0 })) };
});

import { runScheduledSync } from "@/lib/scheduled-sync";
import { recheckEarlyCheckinsAfterCleaning } from "@/lib/early-checkin/recheck";
import { runDueChannelAutoReplies } from "@/lib/automation";

const mockRecheck = vi.mocked(recheckEarlyCheckinsAfterCleaning);
const mockAuto = vi.mocked(runDueChannelAutoReplies);

describe("runScheduledSync × erken giriş yeniden kontrolü", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("HOSPITABLE_API_TOKEN", "env-tok");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("org başına bir kez, kendi org id'siyle ve oto-yanıt geçişinden ÖNCE", async () => {
    const { orgId } = await makeOrgWithProperty();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(mockRecheck).toHaveBeenCalledTimes(1);
    expect(mockRecheck).toHaveBeenCalledWith(orgId, expect.any(Date));
    expect(mockAuto).toHaveBeenCalledTimes(1);
    expect(mockRecheck.mock.invocationCallOrder[0]).toBeLessThan(mockAuto.mock.invocationCallOrder[0]);
  });

  it("🚨 yeniden kontrol düşerse oto-yanıt geçişi YİNE koşar", async () => {
    const { orgId } = await makeOrgWithProperty();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    mockRecheck.mockRejectedValueOnce(new Error("recheck boom"));
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(mockAuto).toHaveBeenCalledTimes(1);
  });
});
