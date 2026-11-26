import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// ŞİKÂYET / ACİL UYARI GEÇİŞİ OTO-YANITTAN ÖNCE KOŞAR (ölçek turu 11-04, M-4 — pinsizdi).
//
// `scheduled-sync.ts` yorumu: "uyarı geçişi otomasyondan ÖNCE koşar — şikâyeti 'Sorunlu' işaretlemesi oto-yanıtın ikinci savunmasıdır".
// Bu kuralı yalnız döngüdeki SATIR SIRASI sağlıyordu; hiçbir test ölçmüyordu. Ölçek tasarımı geçişi bacaklara ayırmayı öneriyor
// (senkron + uyarı / model çağrıları) — ayrım bu sırayı sessizce bozarsa burası kırmızıya döner. Hospitable 402 verse de sıra aynı.
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
vi.mock("@/lib/automation", async (orig) => {
  const actual = await orig<typeof import("@/lib/automation")>();
  return {
    ...actual,
    sendDueAlerts: vi.fn(async () => ({ alerted: 0 })),
    runDueChannelAutoReplies: vi.fn(async () => ({ sent: 0, considered: 0 })),
  };
});

import { runScheduledSync } from "@/lib/scheduled-sync";
import { runDueChannelAutoReplies, sendDueAlerts } from "@/lib/automation";

const mockAlerts = vi.mocked(sendDueAlerts);
const mockAuto = vi.mocked(runDueChannelAutoReplies);

describe("runScheduledSync — uyarı geçişi oto-yanıttan önce", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("HOSPITABLE_API_TOKEN", "env-tok");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("aynı org için sendDueAlerts, runDueChannelAutoReplies'tan ÖNCE çağrılır", async () => {
    const { orgId } = await makeOrgWithProperty();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(mockAlerts).toHaveBeenCalledWith(orgId);
    expect(mockAuto).toHaveBeenCalledWith(orgId);
    const alertAt = mockAlerts.mock.invocationCallOrder[mockAlerts.mock.calls.findIndex((c) => c[0] === orgId)];
    const autoAt = mockAuto.mock.invocationCallOrder[mockAuto.mock.calls.findIndex((c) => c[0] === orgId)];
    expect(alertAt).toBeLessThan(autoAt);
  });

  it("uyarı geçişi fırlatsa da (e-posta sağlayıcısı arızası) oto-yanıt geçişi YİNE koşar ve sıra korunur", async () => {
    const { orgId } = await makeOrgWithProperty();
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    mockAlerts.mockRejectedValueOnce(new Error("smtp down"));
    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    expect(mockAuto).toHaveBeenCalledTimes(1);
    expect(mockAlerts.mock.invocationCallOrder[0]).toBeLessThan(mockAuto.mock.invocationCallOrder[0]);
  });
});
