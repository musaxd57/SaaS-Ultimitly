import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { queueHealth } from "@/lib/outbox/health";

// Kuyruk sağlığı — gönderilebilirlik okuması düşerse (Haiku gece-4): sayılar yine döner, yalnız o alan "bilinmiyor" işaretlenir (eskiden tek
// hata operatör panelindeki iki kuyruğun bütün sayılarını "okunamadı" yapıyordu). Prisma'ya spyOn sonraki testlere sızar → AYRI dosya (CLAUDE.md).

beforeEach(async () => {
  await resetDb();
});

describe("queueHealth — okuma arızası", () => {
  it("gönderilebilirlik sorgusu düşer → durum sayıları döner, claimableUnknown işaretli", async () => {
    const { orgId } = await makeOrgWithProperty();
    await prisma.messageOutbox.create({ data: { organizationId: orgId, channel: "airbnb", body: "x", idempotencyKey: "u1", status: "pending" } });
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("okuma düştü"));
    try {
      const h = await queueHealth(new Date());
      const m = h.find((q) => q.queue === "message")!;
      expect(m.byStatus).toEqual({ pending: 1 });
      expect(m.claimableUnknown).toBe(true);
      expect(m.claimableLagMs).toBeNull();
      expect(h.find((q) => q.queue === "email")!.claimableUnknown).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("KONTROL: okuma sağlamken işaret yok", async () => {
    const h = await queueHealth(new Date());
    expect(h.every((q) => q.claimableUnknown === undefined)).toBe(true);
  });
});
