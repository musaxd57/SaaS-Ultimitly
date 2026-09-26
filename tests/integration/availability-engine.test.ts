import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { loadAvailabilityInputs, RESERVATION_LOAD_CAP_PER_PROPERTY } from "@/modules/availability/load";
import { checkAvailability, describeNights } from "@/modules/availability/core";
import { findUpcomingConflicts, CONFLICT_HORIZON_NIGHTS } from "@/modules/availability/conflicts";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// MÜSAİTLİK MOTORU — YÜKLEYİCİ + İLK TÜKETİCİ (panel "Dikkat Gerektirenler"). Gerçek PG.
// Kiracı sınırı davranışsal (değişmez 16), kişisel veri/sır seçilmez, köken KANITLI alanlardan,
// çakışma yalnız TESPİT (hiçbir satır değişmez), sakin günde satır yok.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-01T09:00:00Z"); // İstanbul bugün = 2026-10-01
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);
const GUEST_SENTINEL = "Gizli Misafir Adı 7731";

async function reservation(
  propertyId: string,
  p: { arrival: Date; departure: Date; status?: string; channel?: string; calendarSourceId?: string; sourceReference?: string; ingestedAt?: Date },
) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: GUEST_SENTINEL,
      guestEmail: "gizli@example.com",
      arrivalDate: p.arrival,
      departureDate: p.departure,
      status: p.status ?? "confirmed",
      channel: p.channel ?? "manual",
      calendarSourceId: p.calendarSourceId ?? null,
      sourceReference: p.sourceReference ?? null,
      ingestedAt: p.ingestedAt ?? null,
    },
  });
}

describe("yükleyici", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 kiracı sınırı: başka org'un mülkü istenirse sonuçta YOK (boş değil)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await reservation(b.propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-05") });
    const loaded = await loadAvailabilityInputs(a.orgId, { propertyIds: [b.propertyId], range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    expect(loaded!.inputs.size).toBe(0);
    expect(await findUpcomingConflicts(a.orgId, { propertyIds: [b.propertyId], now: NOW })).toEqual([]);
  });

  it("misafir adı / iletişim / rezervasyon kodu / besleme adresi girdiye TAŞINMAZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const src = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://gizli.example/feed?token=SIRRI123", lastStatus: "ok", lastSyncedAt: new Date("2026-10-01T08:00:00Z") },
    });
    await reservation(propertyId, { arrival: noon("2026-10-03"), departure: noon("2026-10-05"), calendarSourceId: src.id, sourceReference: "HMKOD9" });
    const loaded = await loadAvailabilityInputs(orgId, { range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    const json = JSON.stringify([...loaded!.inputs.values()]);
    for (const secret of [GUEST_SENTINEL, "gizli@example.com", "HMKOD9", "SIRRI123", "gizli.example"]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("köken kanıtlı alanlardan: besleme / elle giriş / bağlantısız kanal etiketi", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const src = await prisma.calendarSource.create({ data: { propertyId, label: "Booking", url: "https://x.example/a.ics" } });
    const feed = await reservation(propertyId, { arrival: noon("2026-10-03"), departure: noon("2026-10-04"), channel: "booking", calendarSourceId: src.id });
    const manual = await reservation(propertyId, { arrival: midnight("2026-10-05"), departure: midnight("2026-10-06"), channel: "manual" });
    const bridge = await reservation(propertyId, { arrival: midnight("2026-10-07"), departure: midnight("2026-10-08"), channel: "airbnb", sourceReference: "uuid-1" });
    // 🚨 Silinen takvim bağlantısının öksüzü: "manual"a çevrilmiş ama alınma damgası duruyor (inceleme 09-24).
    const orphan = await reservation(propertyId, { arrival: noon("2026-10-08"), departure: noon("2026-10-09"), channel: "manual", ingestedAt: new Date("2026-09-01T00:00:00Z") });
    const loaded = await loadAvailabilityInputs(orgId, { range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    const input = loaded!.inputs.get(propertyId)!;
    const origins = Object.fromEntries(input.reservations.map((r) => [r.id, r.origin]));
    expect(origins).toEqual({
      [feed.id]: "calendar_feed",
      [manual.id]: "host_entered",
      [bridge.id]: "channel_unattributed",
      [orphan.id]: "detached_source",
    });
    // Öksüz satır host'un kendi girişi gibi "kesin dolu" DEMEZ.
    expect(checkAvailability(input, { from: "2026-10-08", to: "2026-10-09" })).toMatchObject({ ok: true, value: { verdict: "unavailable", certainty: "unverified" } });
    expect(checkAvailability(input, { from: "2026-10-05", to: "2026-10-06" })).toMatchObject({ ok: true, value: { verdict: "unavailable", certainty: "verified" } });
    // Yükleyici yüklediği aralığı girdiye yazar (başka aralık sorusu "müsait" üretemez).
    expect(input.loadedRange).toEqual({ from: "2026-10-01", to: "2026-10-10" });
  });

  it("kaynak tazeliği: 'ok' son deneme başarıdır; 'error' ve hiç senkron olmamış başarı DEĞİLDİR; köprü bağlantısı tazeliği bilinmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: propertyId }, data: { hospitableId: "hosp-prop-1" } });
    await prisma.calendarSource.createMany({
      data: [
        { propertyId, label: "Ok", url: "https://x.example/1.ics", lastStatus: "ok", lastSyncedAt: new Date("2026-10-01T08:00:00Z") },
        { propertyId, label: "Hata", url: "https://x.example/2.ics", lastStatus: "error", lastSyncedAt: new Date("2026-10-01T08:00:00Z") },
        { propertyId, label: "Yeni", url: "https://x.example/3.ics" },
      ],
    });
    const loaded = await loadAvailabilityInputs(orgId, { range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    const sources = Object.fromEntries(loaded!.inputs.get(propertyId)!.sources.map((s) => [s.label, s]));
    expect(sources["Ok"].lastSuccessAt).toEqual(new Date("2026-10-01T08:00:00Z"));
    expect(sources["Hata"].lastSuccessAt).toBeNull();
    expect(sources["Yeni"]).toMatchObject({ lastStatus: null, lastSuccessAt: null });
    expect(sources["Kanal bağlantısı"]).toMatchObject({ kind: "channel_link", lastSuccessAt: null });
    // Sağlayıcı kimliği girdiye sızmaz.
    expect(JSON.stringify(loaded)).not.toContain("hosp-prop-1");
    // Bozuk + bilinmeyen tazelik → boş gece "bilinmiyor", asla "müsait".
    const answer = checkAvailability(loaded!.inputs.get(propertyId)!, { from: "2026-10-03", to: "2026-10-05" });
    expect(answer).toMatchObject({ ok: true, value: { verdict: "unknown" } });
  });

  it("yalnız takvim beslemesi olan mülk (kanal köprüsüne bağlı değil): taze beslemede boş gece MÜSAİT", async () => {
    // Mutasyon turu (09-24): köprü bağlantısı filtresi silinince her mülk "tazeliği bilinmeyen"
    // bir kanal kaynağı kazanıyor ve iCal-yalnız mülk bir daha asla "müsait" diyemiyordu.
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/f.ics", lastStatus: "ok", lastSyncedAt: new Date("2026-10-01T08:00:00Z") },
    });
    const loaded = await loadAvailabilityInputs(orgId, { range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    const inputs = loaded!.inputs.get(propertyId)!;
    expect(inputs.sources.map((s) => s.kind)).toEqual(["calendar_feed"]);
    expect(checkAvailability(inputs, { from: "2026-10-03", to: "2026-10-05" })).toMatchObject({ ok: true, value: { verdict: "available", certainty: "verified" } });
  });

  it("satır tavanını aşan mülk boş geceyi 'bilinmiyor' der; aynı org'un öteki mülkü etkilenmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Öteki" } });
    const rows = Array.from({ length: RESERVATION_LOAD_CAP_PER_PROPERTY + 1 }, () => ({
      propertyId,
      guestName: "x",
      arrivalDate: midnight("2026-10-02"),
      departureDate: midnight("2026-10-03"),
      status: "confirmed",
      channel: "manual",
    }));
    await prisma.reservation.createMany({ data: rows });
    const loaded = await loadAvailabilityInputs(orgId, { range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    expect(loaded!.inputs.get(propertyId)!.loadTruncated).toBe(true);
    expect(loaded!.inputs.get(other.id)!.loadTruncated).toBe(false);
  });

  it("'bugünden itibaren' org'un KENDİ diliminde: 22:30Z İstanbul'da ertesi gün", async () => {
    const { orgId } = await makeOrgWithProperty();
    const loaded = await loadAvailabilityInputs(orgId, { range: { nightsFromToday: 3 }, now: new Date("2026-10-01T22:30:00Z") });
    expect(loaded!.range).toEqual({ from: "2026-10-02", to: "2026-10-05" });
  });

  it("iptal satırı yüklenmez; aralığın ±2 gün dışındaki satırlar yüklenmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), status: "cancelled" });
    await reservation(propertyId, { arrival: midnight("2026-12-01"), departure: midnight("2026-12-05") });
    const inside = await reservation(propertyId, { arrival: midnight("2026-10-04"), departure: midnight("2026-10-06") });
    const loaded = await loadAvailabilityInputs(orgId, { range: { from: "2026-10-01", to: "2026-10-10" }, now: NOW });
    expect(loaded!.inputs.get(propertyId)!.reservations.map((r) => r.id)).toEqual([inside.id]);
  });

  it("KONTROL: yükleme salt-okumadır — hiçbir satır değişmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-06") });
    await reservation(propertyId, { arrival: midnight("2026-10-04"), departure: midnight("2026-10-08") });
    const before = await prisma.reservation.findMany({ orderBy: { id: "asc" } });
    await findUpcomingConflicts(orgId, { now: NOW });
    expect(await prisma.reservation.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});

describe("panel — çakışan rezervasyon satırı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sakin gün (çakışma yok, uç uca devir var) → HİÇ satır yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Karışık yazım: köprü çıkışı gece yarısı UTC, besleme girişi öğlen UTC — aynı gün DEVİR.
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), channel: "airbnb" });
    await reservation(propertyId, { arrival: noon("2026-10-05"), departure: noon("2026-10-07"), channel: "booking" });
    expect(await findAttentionItems(orgId, { now: NOW })).toEqual([]);
  });

  it("🚨 aynı gecelere iki farklı rezervasyon (en az biri kanıtlı) → yüksek öncelikli satır, doğru geceler ve takvim bağlantısı", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-07"), channel: "manual" });
    await reservation(propertyId, { arrival: noon("2026-10-05"), departure: noon("2026-10-09"), channel: "booking" });
    const items = await findAttentionItems(orgId, { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "calendar_conflict",
      certainty: "observed",
      propertyId,
      severity: 97,
      nights: { from: "2026-10-05", to: "2026-10-07" },
      possibleDuplicate: false,
      heldRequest: false,
      conflictCount: 1,
      href: `/calendar?property=${propertyId}&month=2026-10`,
    });
    expect(JSON.stringify(items)).not.toContain(GUEST_SENTINEL);
  });

  it("yalnız kanıtsız iddialar (bağlantısı kanıtsız kanal satırları) → ÇIKARIM, daha alçak öncelik", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-07"), channel: "airbnb" });
    await reservation(propertyId, { arrival: noon("2026-10-05"), departure: noon("2026-10-09"), channel: "booking" });
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item).toMatchObject({ kind: "calendar_conflict", certainty: "inferred", severity: 70 });
  });

  it("onay bekleyen talep dolu gecelerle çakışırsa 'talep' olarak söylenir, kesin çift rezervasyon DEĞİL", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-07"), channel: "manual" });
    await reservation(propertyId, { arrival: midnight("2026-10-05"), departure: midnight("2026-10-09"), channel: "manual", status: "pending" });
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item).toMatchObject({ kind: "calendar_conflict", heldRequest: true, severity: 70 });
  });

  it("🚨 mülk başına TEK satır: aynı mülkteki birden çok çakışma kartı doldurmaz; en önemlisi gösterilir + sayı", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // İki birebir kopya (45) + bir gerçek çakışma (97) aynı mülkte.
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), channel: "manual" });
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), channel: "manual" });
    await reservation(propertyId, { arrival: midnight("2026-10-10"), departure: midnight("2026-10-12"), channel: "manual" });
    await reservation(propertyId, { arrival: midnight("2026-10-10"), departure: midnight("2026-10-12"), channel: "manual" });
    await reservation(propertyId, { arrival: midnight("2026-10-20"), departure: midnight("2026-10-24"), channel: "manual" });
    await reservation(propertyId, { arrival: midnight("2026-10-22"), departure: midnight("2026-10-26"), channel: "manual" });
    const items = await findAttentionItems(orgId, { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: 97, possibleDuplicate: false, conflictCount: 3, nights: { from: "2026-10-22", to: "2026-10-24" } });
  });

  it("birebir aynı tarihli iki satır → 'aynı rezervasyon olabilir', daha alçak öncelik", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-10"), departure: midnight("2026-10-12"), channel: "airbnb" });
    await reservation(propertyId, { arrival: noon("2026-10-10"), departure: noon("2026-10-12"), channel: "airbnb" });
    const [item] = await findAttentionItems(orgId, { now: NOW });
    expect(item).toMatchObject({ kind: "calendar_conflict", possibleDuplicate: true, severity: 45 });
  });

  it("iptal edilmiş satır ve ufuk dışı çakışma satır üretmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-06") });
    await reservation(propertyId, { arrival: midnight("2026-10-04"), departure: midnight("2026-10-08"), status: "cancelled" });
    // Bugün 2026-10-01 + 60 gece = 2026-11-30; bu çakışma ufkun dışında.
    expect(CONFLICT_HORIZON_NIGHTS).toBe(60);
    const beyond = "2026-12-15";
    await reservation(propertyId, { arrival: midnight(beyond), departure: midnight("2027-01-31") });
    await reservation(propertyId, { arrival: midnight(beyond), departure: midnight("2027-01-31") });
    expect(await findAttentionItems(orgId, { now: NOW })).toEqual([]);
  });

  it("geçmişteki çakışma bugünün dikkati değildir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-09-20"), departure: midnight("2026-09-25"), status: "completed" });
    await reservation(propertyId, { arrival: midnight("2026-09-22"), departure: midnight("2026-09-26"), status: "completed" });
    expect(await findAttentionItems(orgId, { now: NOW })).toEqual([]);
  });

  it("başka org'un çakışması bu org'un panelinde görünmez", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await reservation(b.propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-06") });
    await reservation(b.propertyId, { arrival: midnight("2026-10-04"), departure: midnight("2026-10-08") });
    expect(await findAttentionItems(a.orgId, { now: NOW })).toEqual([]);
    expect((await findAttentionItems(b.orgId, { now: NOW })).map((i) => i.kind)).toEqual(["calendar_conflict"]);
  });

  it("motor çıktısı panel satırıyla birebir: gece raporu aynı çakışmayı söyler", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await reservation(propertyId, { arrival: midnight("2026-10-03"), departure: midnight("2026-10-07") });
    await reservation(propertyId, { arrival: midnight("2026-10-05"), departure: midnight("2026-10-09") });
    const loaded = await loadAvailabilityInputs(orgId, { range: { nightsFromToday: CONFLICT_HORIZON_NIGHTS }, now: NOW });
    const report = describeNights(loaded!.inputs.get(propertyId)!, loaded!.range);
    expect(report.ok && report.value.conflicts.map((c) => [c.from, c.to])).toEqual([["2026-10-05", "2026-10-07"]]);
  });
});
