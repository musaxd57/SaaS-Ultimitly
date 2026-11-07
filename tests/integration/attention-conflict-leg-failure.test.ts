import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { findUpcomingConflicts } from "@/modules/availability/conflicts";

// ---------------------------------------------------------------------------
// "Dikkat Gerektirenler": müsaitlik motoru bacağı ÇÖKERSE kartın geri kalanı DÜŞMEZ.
//
// Mutasyon turu (09-24): `findUpcomingConflicts(...).catch(() => [])` silindiğinde hiçbir test
// düşmüyordu — motorun arızası bütün kartı (bozuk besleme, cevapsız misafir, tekrar eden arıza)
// 500'e çevirirdi. Modül taklidi AYRI dosyada: aynı dosyadaki gerçek motor testlerine sızmasın.
// ---------------------------------------------------------------------------

vi.mock("@/modules/availability/conflicts", () => ({
  CONFLICT_HORIZON_NIGHTS: 60,
  findUpcomingConflicts: vi.fn(async () => {
    throw new Error("motor çöktü");
  }),
}));

describe("müsaitlik bacağı arızası", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("motor fırlatınca bozuk besleme satırı yine gelir; çakışma satırı yoktur", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/f.ics", lastStatus: "error", lastSyncedAt: new Date() },
    });
    const items = await findAttentionItems(orgId, { now: new Date() });
    // KONTROL: taklit gerçekten çağrıldı ve gerçekten fırlattı (test vakumlu değil).
    expect(vi.mocked(findUpcomingConflicts)).toHaveBeenCalled();
    expect(items.map((i) => i.kind)).toEqual(["feed_broken"]);
  });
});
