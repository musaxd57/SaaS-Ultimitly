import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { checkoutTimesFor } from "@/lib/tasks/checkout-times";
import { taskCardData } from "@/lib/tasks/card-data";

// ---------------------------------------------------------------------------
// Kurucu 11-05 gece: "temizlik var çıkış günü … çıkış 12:00, sonra geç çıkış 14:00 onay aldı → orada hemen buna bağlanabilir temizlik
// saati". Görev kartı "Misafir çıkışı 14:00 · geç çıkış onaylı" der; saat hazırlık hükmüyle AYNI kuraldan TÜRETİLİR (kopya yok).
// ---------------------------------------------------------------------------

const day = (k: string) => new Date(`${k}T12:00:00Z`);

describe("temizlik kartı — misafirin çıkış saati", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "12:00" });
    orgId = made.orgId;
    propertyId = made.propertyId;
  });

  async function stay(over: Record<string, unknown> = {}) {
    return prisma.reservation.create({
      data: { propertyId, guestName: "G", arrivalDate: day("2026-11-05"), departureDate: day("2026-11-08"), status: "confirmed", channel: "airbnb", ...over },
    });
  }
  async function approveLate(reservationId: string, decidedTime: string, status = "approved") {
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId, guestIdentifier: "G", channel: "airbnb" } });
    await prisma.decisionRequest.create({
      data: { organizationId: orgId, conversationId: conv.id, messageId: `m-${decidedTime}-${status}`, reservationId, kind: "late_checkout", lang: "tr", status, decidedTime },
    });
  }

  it("🚨 kurucunun örneği: çıkış 12:00, geç çıkış 14:00 ONAYLANDI → 'Misafir çıkışı 14:00 · geç çıkış onaylı'", async () => {
    const r = await stay();
    expect((await checkoutTimesFor(orgId, [r.id])).get(r.id)).toEqual({ time: "12:00", lateApproved: false });
    await approveLate(r.id, "14:00");
    expect((await checkoutTimesFor(orgId, [r.id])).get(r.id)).toEqual({ time: "14:00", lateApproved: true });
  });

  it("KONTROL — reddedilen / bekleyen geç çıkış saati DEĞİŞTİRMEZ; onaylı saat mülk saatinden erkense mülk saati kalır", async () => {
    const r = await stay();
    await approveLate(r.id, "15:00", "declined");
    await approveLate(r.id, "16:00", "pending");
    await approveLate(r.id, "11:00");
    expect((await checkoutTimesFor(orgId, [r.id])).get(r.id)).toEqual({ time: "12:00", lateApproved: false });
  });

  it("misafirin beyanı (daha geç) saati geç çeker ama 'onaylı' DEĞİLDİR; başka işletmenin rezervasyonu okunmaz", async () => {
    const r = await stay({ guestCheckoutTime: "13:00" });
    expect((await checkoutTimesFor(orgId, [r.id])).get(r.id)).toEqual({ time: "13:00", lateApproved: false });
    const other = await makeOrgWithProperty();
    const foreign = await prisma.reservation.create({
      data: { propertyId: other.propertyId, guestName: "X", arrivalDate: day("2026-11-05"), departureDate: day("2026-11-08"), status: "confirmed", channel: "airbnb" },
    });
    expect((await checkoutTimesFor(orgId, [foreign.id])).has(foreign.id)).toBe(false);
  });

  it("kart satırı yalnız TEMİZLİK görevinde; saate ek getirilmez", () => {
    const row = {
      id: "t",
      title: "Çıkış temizliği - G",
      type: "cleaning",
      origin: "system",
      priority: "standard",
      status: "todo",
      dueAt: day("2026-11-08"),
      checklistJson: null,
      property: { name: "Lale" },
      assignedTo: null,
      updates: [],
    };
    const ctx = { canManage: true, timeZone: "Europe/Istanbul", now: new Date("2026-11-07T10:00:00Z"), latestPhotoUrl: null, checkout: { time: "14:00", lateApproved: true } };
    expect(taskCardData(row, ctx).checkoutNote).toBe("Misafir çıkışı 14:00 · geç çıkış onaylı");
    expect(taskCardData({ ...row, type: "maintenance" }, ctx).checkoutNote).toBeNull();
    expect(taskCardData(row, { ...ctx, checkout: { time: "12:00", lateApproved: false } }).checkoutNote).toBe("Misafir çıkışı 12:00");
  });
});
