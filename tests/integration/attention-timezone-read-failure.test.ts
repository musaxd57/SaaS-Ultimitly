import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { seedRequestPathOrg } from "../helpers/request-path-fixture";
import { stayDay } from "../helpers/stay-dates";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";

vi.mock("@/lib/alert-state", async (orig) => ({
  ...(await orig<typeof import("@/lib/alert-state")>()),
  alertOnTransition: vi.fn().mockResolvedValue(undefined),
}));

import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { alertOnTransition } from "@/lib/alert-state";

// ---------------------------------------------------------------------------
// "Dikkat" — SAAT DİLİMİ TEK OKUMA, ARIZA YALITIMI AYNI (optimizasyon turu 11-19). İşletmenin saat dilimi artık bir istekte en çok bir kez
// okunur ve tüketiciler sonucu paylaşır. Eskiden her tüketici kendi okumasını yapardı: yeniden etkinleşme bacağının okuması düşerse yalnız o
// satır türü kaybolur, çıkış günü kendi okumasıyla çalışırdı. Paylaşılan okuma bu yalıtımı bozmamalı: BAŞARISIZ okuma saklanmaz, sonraki
// tüketici yeniden dener. Prisma temsilcisine casus kurulduğu için ayrı dosya.
// ---------------------------------------------------------------------------

const NOW = new Date();

describe("findAttentionItems: saat dilimi okuması bir bacakta düşerse", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(alertOnTransition).mockResolvedValue(undefined as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("yeniden etkinleşme bacağının okuması düşer → yalnız o satır yok; çıkış günü / cevapsız satırlar yeniden okumayla gelir", async () => {
    const f = await seedRequestPathOrg({ properties: 1, now: NOW });
    await prisma.reservation.create({
      data: { id: "re-1", propertyId: f.propertyIds[0], guestName: "İptal", arrivalDate: stayDay(2, NOW), departureDate: stayDay(5, NOW), status: "cancelled", channel: "airbnb", sourceReference: "RE-1" },
    });
    await prisma.ingestEvent.create({
      data: { organizationId: f.orgId, provider: "hospitable", entityType: "reservation", entityId: "re-1", kind: "reservation.updated", changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]), occurredAt: new Date(NOW.getTime() - 3_600_000) },
    });
    const baseline = await findAttentionItems(f.orgId, { now: NOW });
    expect(baseline.some((i) => i.kind === "channel_reactivation")).toBe(true);
    expect(baseline.some((i) => i.kind === "unanswered_aging")).toBe(true);

    // Okuma sırası: (1) müsaitlik bacağının kendi okuması (tur başında), (2) yeniden etkinleşme bacağının saat dilimi okuması (olay
    // okumasından sonra) — yalnız (2) düşer.
    const real = prisma.organization.findUnique.bind(prisma.organization);
    let calls = 0;
    const spy = vi.spyOn(prisma.organization, "findUnique").mockImplementation(((args: Parameters<typeof real>[0]) => {
      calls++;
      return calls === 2 ? Promise.reject(new Error("geçici okuma hatası")) : real(args);
    }) as never);
    const items = await findAttentionItems(f.orgId, { now: NOW }).finally(() => spy.mockRestore());
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(items.some((i) => i.kind === "channel_reactivation")).toBe(false);
    expect(items.filter((i) => i.kind !== "channel_reactivation")).toEqual(baseline.filter((i) => i.kind !== "channel_reactivation"));
  });
});
