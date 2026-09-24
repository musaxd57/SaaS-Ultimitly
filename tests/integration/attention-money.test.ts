import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// V2 PARA ETKİSİ — uçtan uca (09-24; DB gerçek). Pinlenen:
//  · çift rezervasyon satırı ev sahibinin aralığıyla ARALIK tahmini taşır; aralık yoksa "bilinmiyor";
//    birebir kopya satırda tutar YOK;
//  · aralık rotası org kapsamlı (başka kiracının mülkü 404, hiçbir şey yazılmaz), geçersiz girdi 400,
//    denetim kaydı değer TAŞIMAZ; kaldırma satırı emekliye ayırır;
//  · aralık "Mülk Hafızası" kartının KB olguları arasında görünmez; veri dışa aktarımında görünür.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { loadNightlyRates, setNightlyRate } from "@/modules/intelligence/money/rates";
import { getPropertyMemory } from "@/modules/intelligence";
import { buildOrganizationDataExport } from "@/lib/data-export";
import { PUT, DELETE } from "@/app/api/properties/[id]/nightly-rate/route";

const NOW = new Date("2026-10-01T09:00:00Z");
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function reservation(propertyId: string, arrival: string, departure: string, status = "confirmed") {
  return prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status, channel: "manual" },
  });
}

const owner = (organizationId: string): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role: "owner",
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
});

const put = (id: string, body: unknown) =>
  PUT(new NextRequest(`http://localhost/api/properties/${id}/nightly-rate`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const del = (id: string) => DELETE(new NextRequest(`http://localhost/api/properties/${id}/nightly-rate`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

describe("Dikkat Gerektirenler — çift rezervasyon satırında para etkisi", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 aralık varken: çakışan gece × alt fiyat … en uzun konaklama × üst fiyat (tahmini); güven orta", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // 3–7 Ekim (4 gece) ve 5–9 Ekim (4 gece) → çakışma 5–7 Ekim (2 gece).
    await reservation(propertyId, "2026-10-03", "2026-10-07");
    await reservation(propertyId, "2026-10-05", "2026-10-09");
    await setNightlyRate(orgId, propertyId, "u1", { low: 2000, high: 3500, currency: "TRY" }, new Date("2026-09-20T00:00:00Z"));
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item).toMatchObject({
      kind: "calendar_conflict",
      money: { kind: "estimate", low: 4000, high: 14_000, currency: "TRY", confidence: "medium", evidence: { overlapNights: 2, stayNights: 4 } },
    });
  });

  it("aralık YOKSA satır yine görünür, tutar 'bilinmiyor (aralık yok)' — sayı YOK", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, "2026-10-03", "2026-10-07");
    await reservation(propertyId, "2026-10-05", "2026-10-09");
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item.money).toEqual({ kind: "unknown", reason: "no_rate" });
  });

  it("birebir aynı tarihli iki kayıt (muhtemelen aynı konaklama) → tutar YOK, aralık olsa da", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, "2026-10-10", "2026-10-12");
    await reservation(propertyId, "2026-10-10", "2026-10-12");
    await setNightlyRate(orgId, propertyId, "u1", { low: 2000, high: 3500, currency: "TRY" }, new Date("2026-09-20T00:00:00Z"));
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item.money).toEqual({ kind: "unknown", reason: "duplicate_likely" });
  });

  it("onay bekleyen talep → güven DÜŞÜK", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, "2026-10-03", "2026-10-07");
    await reservation(propertyId, "2026-10-05", "2026-10-09", "pending");
    await setNightlyRate(orgId, propertyId, "u1", { low: 2000, high: 3500, currency: "EUR" }, new Date("2026-09-20T00:00:00Z"));
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item.money).toMatchObject({ kind: "estimate", confidence: "low", currency: "EUR" });
  });

  it("🚨 kiracı sınırı: başka org'un aynı mülke benzer kaydı BU org'un satırını fiyatlamaz", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await reservation(a.propertyId, "2026-10-03", "2026-10-07");
    await reservation(a.propertyId, "2026-10-05", "2026-10-09");
    await setNightlyRate(b.orgId, b.propertyId, "u1", { low: 2000, high: 3500, currency: "TRY" });
    expect((await loadNightlyRates(a.orgId, [b.propertyId])).size).toBe(0);
    const [item] = await findAttentionItems(a.orgId, { now: NOW });
    expect(item.money).toEqual({ kind: "unknown", reason: "no_rate" });
  });
});

describe("PUT/DELETE /api/properties/[id]/nightly-rate", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("geçerli aralık yazılır; denetim kaydı DEĞER taşımaz; kart olgularında görünmez; dışa aktarımda görünür", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    const res = await put(propertyId, { low: 1800, high: 4200, currency: "TRY" });
    expect(res.status).toBe(200);
    const rates = await loadNightlyRates(orgId, [propertyId]);
    expect(rates.get(propertyId)).toMatchObject({ low: 1800, high: 4200, currency: "TRY" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.nightly_rate_set" } });
    expect(String(audit.metadataJson)).not.toMatch(/1800|4200/);
    const memory = await getPropertyMemory(orgId, propertyId);
    expect(memory.facts.some((f) => f.category === "pricing")).toBe(false);
    const exported = await buildOrganizationDataExport(orgId);
    expect(exported?.hostEnteredFacts).toHaveLength(1);
    expect(exported?.hostEnteredFacts[0]).toMatchObject({ propertyId, category: "pricing" });
  });

  it("geçersiz girdi 400 ve hiçbir şey yazılmaz (alt ≥ üst, ondalık, bilinmeyen para birimi, tavan üstü)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    for (const body of [
      { low: 3000, high: 3000, currency: "TRY" },
      { low: 2000.5, high: 3000, currency: "TRY" },
      { low: 2000, high: 3000, currency: "XXX" },
      { low: 2000, high: 2_000_000, currency: "TRY" },
      { low: -5, high: 10, currency: "TRY" },
      {},
    ]) {
      expect((await put(propertyId, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.propertyMemory.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("🚨 başka kiracının mülk kimliği → 404, hiçbir şey yazılmaz (varlık sızdırılmaz)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    session = owner(b.orgId);
    expect((await put(a.propertyId, { low: 1800, high: 4200, currency: "TRY" })).status).toBe(404);
    expect((await del(a.propertyId)).status).toBe(404);
    expect(await prisma.propertyMemory.count()).toBe(0);
    // Anti-vakum: kendi mülküne aynı istek çalışır.
    session = owner(a.orgId);
    expect((await put(a.propertyId, { low: 1800, high: 4200, currency: "TRY" })).status).toBe(200);
  });

  it("kaldırma satırı emekliye ayırır (tarihçe kalır, tahmin artık yapılmaz)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = owner(orgId);
    await put(propertyId, { low: 1800, high: 4200, currency: "TRY" });
    expect((await del(propertyId)).status).toBe(200);
    expect((await loadNightlyRates(orgId, [propertyId])).size).toBe(0);
    expect(await prisma.propertyMemory.count({ where: { organizationId: orgId, status: "retired" } })).toBe(1);
  });
});
