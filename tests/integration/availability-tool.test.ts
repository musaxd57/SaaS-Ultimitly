import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { runAvailabilityTool } from "@/lib/ai/tools/availability-tool-load";

// ---------------------------------------------------------------------------
// ④ Müsaitlik aracı × gerçek PostgreSQL — kiracı sınırı ve kapalı başarısızlık (talimat 09-07 değişmez 16: tenant
// isolation her yeni yolda DAVRANIŞSAL test).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T09:00:00Z");
const range = { from: "2026-10-20", to: "2026-10-22" };

async function freshFeed(propertyId: string, over: { lastStatus?: string; lastSyncedAt?: Date | null } = {}) {
  await prisma.calendarSource.create({
    data: {
      propertyId,
      label: "Airbnb",
      url: "https://example.com/cal.ics",
      lastStatus: over.lastStatus ?? "ok",
      lastSyncedAt: over.lastSyncedAt === undefined ? new Date(NOW.getTime() - 3_600_000) : over.lastSyncedAt,
    },
  });
}

describe("runAvailabilityTool", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("taze takvim + boş geceler → ok / available", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId);
    const r = await runAvailabilityTool(orgId, { propertyId, ...range }, NOW);
    expect(r.status).toBe("ok");
    expect(r.value).toMatchObject({ verdict: "available", certainty: "verified", nights: 2 });
  });

  it("🚨 BAŞKA kiracının mülkü → not_found, değer yok; o mülk boş olsa da 'müsait' sızmaz", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await freshFeed(a.propertyId);
    const r = await runAvailabilityTool(b.orgId, { propertyId: a.propertyId, ...range }, NOW);
    expect(r).toMatchObject({ status: "not_found", value: null, scope: { organizationId: b.orgId, propertyId: a.propertyId } });
  });

  it("KONTROL: aynı mülk kendi kiracısıyla sorulunca bulunur (kapı her şeyi reddetmiyor)", async () => {
    const a = await makeOrgWithProperty();
    await freshFeed(a.propertyId);
    expect((await runAvailabilityTool(a.orgId, { propertyId: a.propertyId, ...range }, NOW)).status).toBe("ok");
  });

  it("host'un elle girdiği konaklama → ok / unavailable", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId);
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Misafir",
        arrivalDate: new Date("2026-10-19T00:00:00Z"),
        departureDate: new Date("2026-10-23T00:00:00Z"),
        channel: "manual",
        status: "confirmed",
      },
    });
    const r = await runAvailabilityTool(orgId, { propertyId, ...range }, NOW);
    expect(r.status).toBe("ok");
    expect(r.value).toMatchObject({ verdict: "unavailable", blockedNights: 2 });
    expect(JSON.stringify(r)).not.toContain("Misafir");
  });

  it("🚨 takvim okuması hatalı → uncertain; kesin cevap yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId, { lastStatus: "error" });
    const r = await runAvailabilityTool(orgId, { propertyId, ...range }, NOW);
    expect(r.status).toBe("uncertain");
    expect(r.reasons).toContain("source_error");
  });

  it("🚨 takvim 10 saattir okunmadı → stale", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId, { lastSyncedAt: new Date(NOW.getTime() - 10 * 3_600_000) });
    expect((await runAvailabilityTool(orgId, { propertyId, ...range }, NOW)).status).toBe("stale");
  });

  it("bozuk tarih → invalid_request (fırlatmaz)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const r = await runAvailabilityTool(orgId, { propertyId, from: "20-10-2026", to: "2026-10-22" }, NOW);
    expect(r).toMatchObject({ status: "invalid_request", value: null });
  });
});
