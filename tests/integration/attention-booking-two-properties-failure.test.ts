import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Dikkat Gerektirenler": "iki dairede kayıtlı" bacağı ÇÖKERSE kartın geri kalanı DÜŞMEZ ve arıza sessiz kalmaz (geçiş tabanlı alarm).
// Modül taklidi AYRI dosyada: aynı dosyadaki gerçek sorgu testlerine sızmasın (`attention-conflict-leg-failure.test.ts` emsali).
// ---------------------------------------------------------------------------

vi.mock("@/lib/booking-property-conflict", async (orig) => ({
  ...(await orig<typeof import("@/lib/booking-property-conflict")>()),
  activeBookingConflicts: vi.fn(async () => {
    throw new Error("sorgu çöktü");
  }),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { activeBookingConflicts } from "@/lib/booking-property-conflict";
import { reportError } from "@/lib/report-error";

describe("iki dairede kayıtlı bacağı arızası", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sorgu fırlatınca bozuk besleme satırı yine gelir; arıza alarm üretir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/f.ics", lastStatus: "error", lastSyncedAt: new Date() },
    });
    const items = await findAttentionItems(orgId, { now: new Date() });
    // KONTROL: taklit gerçekten çağrıldı ve gerçekten fırlattı (test vakumlu değil).
    expect(vi.mocked(activeBookingConflicts)).toHaveBeenCalled();
    expect(items.map((i) => i.kind)).toEqual(["feed_broken"]);
    await vi.waitFor(() =>
      expect(vi.mocked(reportError).mock.calls.map((c) => c[0])).toContain("attention booking_two_properties"),
    );
  });
});
