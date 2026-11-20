import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Otomatik gönderim durduruldu" yüklemi ÇÖKERSE (kurucu 11-20 sabah B-1): "iki dairede kayıtlı" satırı yine görünür, durdurma cümlesi
// YAZILMAZ (okunamayan şey için söz / iddia yok) ve arıza sessiz kalmaz (geçiş tabanlı alarm). Modül taklidi AYRI dosyada: gerçek yüklem
// testlerine sızmasın (`attention-booking-two-properties-failure.test.ts` emsali).
// ---------------------------------------------------------------------------

vi.mock("@/lib/booking-conflict-auto-send", () => ({
  autoSendStoppedByConflict: vi.fn(async () => {
    throw new Error("yüklem çöktü");
  }),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { autoSendStoppedByConflict } from "@/lib/booking-conflict-auto-send";
import { reportError } from "@/lib/report-error";

describe("durdurma yüklemi arızası", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 yüklem fırlatınca satır yine gelir, `autoSendStopped` YOK; arıza alarm üretir", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
    for (const name of ["Lale 3", "Lale 5"]) {
      const p = await prisma.property.create({ data: { organizationId: org.id, name, createdAt: PROPERTY_EXISTED_BEFORE } });
      await prisma.reservation.create({
        data: { propertyId: p.id, guestName: "Ada", arrivalDate: stayDay(3), departureDate: stayDay(6), status: "confirmed", sourceReference: "HM-1", channel: "airbnb" },
      });
    }
    const rows = (await findAttentionItems(org.id, { now: new Date() })).filter((i) => i.kind === "booking_two_properties");
    // KONTROL: taklit gerçekten çağrıldı ve gerçekten fırlattı (test vakumlu değil).
    expect(vi.mocked(autoSendStoppedByConflict)).toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].autoSendStopped).toBeUndefined();
    await vi.waitFor(() =>
      expect(vi.mocked(reportError).mock.calls.map((c) => c[0])).toContain("attention booking_two_properties stopped"),
    );
  });
});
