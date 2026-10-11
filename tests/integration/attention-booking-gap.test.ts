import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// V2 BOŞLUK SATIRI (hazır yama; anahtar `ATTENTION_GAP_ENABLED` KAPALI) — uçtan uca, gerçek PostgreSQL. Pinlenen:
//  · anahtar kapalıyken satır YOK (bugünkü pano birebir);
//  · açıkken iki kesin konaklama arasındaki 1–2 boş gece mülk başına TEK satır (en yakını + sayı), olası gelir aralığı;
//  · kapsama kaynağı bayat / yoksa boşluk iddiası YOK (bilinmeyen gece "boş" sayılmaz);
//  · satır risk satırlarının altında sıralanır; başka kiracının boşluğu görünmez.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { findAttentionItems, GAP_SEVERITY_LATER, GAP_SEVERITY_SOON } from "@/modules/intelligence/incidents/attention";
import { setNightlyRate } from "@/modules/intelligence/money/rates";

const NOW = new Date("2026-10-01T09:00:00Z"); // İstanbul 12:00
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function stay(propertyId: string, arrival: string, departure: string, status = "confirmed") {
  return prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status, channel: "manual" },
  });
}
/** Taze takvim bağlantısı: "boş" hükmü için kapsama şart. */
async function freshFeed(propertyId: string, syncedAt = new Date("2026-10-01T08:30:00Z")) {
  return prisma.calendarSource.create({
    data: { propertyId, label: "Airbnb", url: "https://example.com/a.ics", lastStatus: "ok", lastSyncedAt: syncedAt },
  });
}

describe("Dikkat Gerektirenler — yetim boşluk satırı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ATTENTION_GAP_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 KAPALI anahtarda satır YOK (bugünkü pano birebir)", async () => {
    vi.stubEnv("ATTENTION_GAP_ENABLED", "");
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId);
    await stay(propertyId, "2026-10-05", "2026-10-08");
    await stay(propertyId, "2026-10-09", "2026-10-12");
    expect((await findAttentionItems(orgId, { now: NOW })).filter((i) => i.kind === "booking_gap")).toEqual([]);
  });

  it("🚨 iki konaklama arası 1 gece + aralık → satır: geceler, olası gelir (güven düşük), yakın boşluk önemi", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId);
    await stay(propertyId, "2026-10-03", "2026-10-06");
    await stay(propertyId, "2026-10-07", "2026-10-10");
    await setNightlyRate(orgId, propertyId, "u1", { low: 4000, high: 5200, currency: "TRY" }, new Date("2026-09-20T00:00:00Z"));
    const gaps = (await findAttentionItems(orgId, { now: NOW })).filter((i) => i.kind === "booking_gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      certainty: "observed",
      propertyId,
      nights: { from: "2026-10-06", to: "2026-10-07" },
      gapCount: 1,
      severity: GAP_SEVERITY_SOON,
      money: { kind: "estimate", low: 4000, high: 5200, currency: "TRY", confidence: "low" },
    });
    expect(gaps[0].href).toBe(`/calendar?property=${encodeURIComponent(propertyId)}&month=2026-10`);
  });

  it("mülk başına TEK satır: en yakın boşluk + toplam sayı; uzak boşluk düşük önem; aralık yoksa tutar 'bilinmiyor'", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId);
    await stay(propertyId, "2026-10-12", "2026-10-15");
    await stay(propertyId, "2026-10-17", "2026-10-20"); // 15–16 boş (2 gece)
    await stay(propertyId, "2026-10-21", "2026-10-24"); // 20 boş (1 gece)
    const gaps = (await findAttentionItems(orgId, { now: NOW })).filter((i) => i.kind === "booking_gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ nights: { from: "2026-10-15", to: "2026-10-17" }, gapCount: 2, severity: GAP_SEVERITY_LATER });
    expect(gaps[0].money).toEqual({ kind: "unknown", reason: "no_rate" });
  });

  it("🚨 kapsama bayat ya da hiç yok → boşluk iddiası YOK; üç gece ve üstü boşluk yetim değil", async () => {
    const stale = await makeOrgWithProperty();
    await freshFeed(stale.propertyId, new Date("2026-09-20T08:30:00Z"));
    await stay(stale.propertyId, "2026-10-05", "2026-10-08");
    await stay(stale.propertyId, "2026-10-09", "2026-10-12");
    expect((await findAttentionItems(stale.orgId, { now: NOW })).filter((i) => i.kind === "booking_gap")).toEqual([]);

    const none = await makeOrgWithProperty();
    await stay(none.propertyId, "2026-10-05", "2026-10-08");
    await stay(none.propertyId, "2026-10-09", "2026-10-12");
    expect((await findAttentionItems(none.orgId, { now: NOW })).filter((i) => i.kind === "booking_gap")).toEqual([]);

    const wide = await makeOrgWithProperty();
    await freshFeed(wide.propertyId);
    await stay(wide.propertyId, "2026-10-05", "2026-10-08");
    await stay(wide.propertyId, "2026-10-11", "2026-10-14");
    expect((await findAttentionItems(wide.orgId, { now: NOW })).filter((i) => i.kind === "booking_gap")).toEqual([]);
  });

  it("satır risk satırlarının (çakışma) ALTINDA; başka kiracının boşluğu görünmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await freshFeed(propertyId);
    await stay(propertyId, "2026-10-03", "2026-10-06");
    await stay(propertyId, "2026-10-07", "2026-10-10");
    await stay(propertyId, "2026-10-08", "2026-10-09"); // çakışma
    const other = await makeOrgWithProperty();
    await freshFeed(other.propertyId);
    await stay(other.propertyId, "2026-10-03", "2026-10-06");
    await stay(other.propertyId, "2026-10-07", "2026-10-10");

    const items = await findAttentionItems(orgId, { now: NOW });
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf("calendar_conflict")).toBeLessThan(kinds.indexOf("booking_gap"));
    expect(items.filter((i) => i.kind === "booking_gap").every((i) => i.propertyId === propertyId)).toBe(true);
  });
});
