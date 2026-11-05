import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// İstek kimliği talebinin (`claimOutboundRequest`, Codex 11-05) her dalı — veritabanı taklidiyle (arıza dalları gerçek PostgreSQL'de
// kurulamaz). Davranışın uçtan uca hâli: tests/integration/host-send-request-idempotency.test.ts.
// ---------------------------------------------------------------------------

const lock = vi.hoisted(() => ({
  updateMany: vi.fn(async (_args?: unknown) => ({ count: 1 })),
  deleteMany: vi.fn(async (_args?: unknown) => ({ count: 0 })),
  create: vi.fn(async (_args?: unknown) => ({})),
  findUnique: vi.fn(async (_args?: unknown): Promise<{ holder: string | null } | null> => null),
}));
vi.mock("@/lib/db", () => ({ prisma: { systemLock: lock } }));

import { claimOutboundRequest, extendOutboundRequest } from "@/lib/outbound-claim";
import { OUTBOUND_REQUEST_CLAIM_PREFIX, OUTBOUND_SEND_CLAIM_PREFIX } from "@/lib/outbound-claim-name";

const p2002 = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });

describe("claimOutboundRequest — dallar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lock.create.mockImplementation(async () => ({}));
    lock.findUnique.mockImplementation(async () => null);
  });

  it("🚨 ilk talep alınır; ad kendi öneki + konuşma ile başlar, sahibi yolu söyler; doğrudan yolda da 2 dk DOĞAR (çöken süreç 24 sa kilit bırakmaz — Opus F1)", async () => {
    const t0 = Date.now();
    expect(await claimOutboundRequest("conv1", "manual:conv1:req:r1", "direct")).toEqual({ result: "claimed" });
    const data = (lock.create.mock.calls[0][0] as { data: { name: string; lockedUntil: Date; holder: string } }).data;
    expect(data.name.startsWith(`${OUTBOUND_REQUEST_CLAIM_PREFIX}conv1:`)).toBe(true);
    expect(data.name.startsWith(OUTBOUND_SEND_CLAIM_PREFIX)).toBe(false);
    expect(data.holder).toBe("direct");
    expect(data.lockedUntil.getTime() - t0).toBeLessThanOrEqual(120_000 + 1_000);
    expect(data.lockedUntil.getTime() - t0).toBeGreaterThanOrEqual(120_000 - 1_000);
    // Süresi dolan talepler (yalnız kendi öneki) önce süpürülür.
    expect(lock.deleteMany).toHaveBeenCalledWith({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX }, lockedUntil: { lt: expect.any(Date) } } });
  });

  it("kuyruk yolunun talebi de KISA (2 dk): kalıcı kayıt kuyruk satırıdır, çöken yazım 24 saatlik asılı talep bırakmaz", async () => {
    const t0 = Date.now();
    expect(await claimOutboundRequest("conv1", "k", "queue")).toEqual({ result: "claimed" });
    const data = (lock.create.mock.calls[0][0] as { data: { lockedUntil: Date; holder: string } }).data;
    expect(data.holder).toBe("queue");
    expect(data.lockedUntil.getTime() - t0).toBeLessThanOrEqual(120_000 + 1_000);
    expect(data.lockedUntil.getTime() - t0).toBeGreaterThanOrEqual(120_000 - 1_000);
  });

  it("aynı kimlik başka bir yol tarafından tutuluyorsa sahibini söyler", async () => {
    lock.create.mockRejectedValue(p2002());
    lock.findUnique.mockResolvedValue({ holder: "queue" });
    expect(await claimOutboundRequest("conv1", "k", "direct")).toEqual({ result: "held", by: "queue" });
    lock.findUnique.mockResolvedValue({ holder: "direct" });
    expect(await claimOutboundRequest("conv1", "k", "queue")).toEqual({ result: "held", by: "direct" });
  });

  it("tanınmayan sahip ya da arada bırakılmış talep → sahibi bilinmeyen 'tutuluyor' (güvenli taraf)", async () => {
    lock.create.mockRejectedValue(p2002());
    lock.findUnique.mockResolvedValue({ holder: "baska" });
    expect(await claimOutboundRequest("conv1", "k", "queue")).toEqual({ result: "held", by: null });
    lock.findUnique.mockResolvedValue(null);
    expect(await claimOutboundRequest("conv1", "k", "queue")).toEqual({ result: "held", by: null });
  });

  it("kesin başarıdan sonra talep 24 saate uzar (yalnız kendi adı); uzatma hatası gönderimi düşürmez", async () => {
    const t0 = Date.now();
    await extendOutboundRequest("conv1", "manual:conv1:req:r1");
    const args = lock.updateMany.mock.calls[0][0] as { where: { name: string }; data: { lockedUntil: Date } };
    expect(args.where.name.startsWith(`${OUTBOUND_REQUEST_CLAIM_PREFIX}conv1:`)).toBe(true);
    expect(args.data.lockedUntil.getTime() - t0).toBeGreaterThanOrEqual(24 * 60 * 60_000 - 1_000);
    lock.updateMany.mockRejectedValueOnce(new Error("db down (test)"));
    await expect(extendOutboundRequest("conv1", "k")).resolves.toBeUndefined();
  });

  it("talep deposu hatası (yazma ya da sahip okuması) → 'unavailable' (gönderim reddedilir)", async () => {
    lock.create.mockRejectedValue(new Error("db down (test)"));
    expect(await claimOutboundRequest("conv1", "k", "direct")).toEqual({ result: "unavailable" });
    lock.create.mockRejectedValue(p2002());
    lock.findUnique.mockRejectedValue(new Error("db down (test)"));
    expect(await claimOutboundRequest("conv1", "k", "direct")).toEqual({ result: "unavailable" });
  });

  it("süpürme hatası talebi engellemez", async () => {
    lock.deleteMany.mockRejectedValueOnce(new Error("db down (test)"));
    expect(await claimOutboundRequest("conv1", "k", "queue")).toEqual({ result: "claimed" });
  });
});
