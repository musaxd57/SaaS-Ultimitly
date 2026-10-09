import { describe, it, expect } from "vitest";
import { availabilityToolResult, AVAILABILITY_TOOL, AVAILABILITY_TOOL_VERSION } from "@/lib/ai/tools/availability-tool";
import { mayStateAsFact, TOOL_STATUSES } from "@/lib/ai/tools/contract";
import type { AvailabilityInput, CoverageSource, ReservationSnapshot } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// ④ Müsaitlik aracı — motorun kararının `VerifiedToolResult` eşlemesi (SAF). Talimat 09-07: "stale/error/uncertain results
// must never become a definite answer"; başka kiracının mülkü "yok"tur, asla "müsait" değil.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T09:00:00Z");
const TZ = "Europe/Istanbul";
const H = 3_600_000;

const feed = (over: Partial<CoverageSource> = {}): CoverageSource => ({
  id: "src-1",
  kind: "calendar_feed",
  label: "Airbnb",
  lastStatus: "ok",
  lastSuccessAt: new Date(NOW.getTime() - H),
  ...over,
});
const hostStay = (from: string, to: string): ReservationSnapshot => ({
  id: "res-1",
  arrival: new Date(`${from}T00:00:00Z`),
  departure: new Date(`${to}T00:00:00Z`),
  status: "confirmed",
  origin: "host_entered",
  calendarSourceId: null,
  feedLastSeenAt: null,
});
const input = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  propertyId: "p1",
  timeZone: TZ,
  now: NOW,
  reservations: [],
  sources: [feed()],
  loadTruncated: false,
  loadedRange: { from: "2026-10-01", to: "2026-12-31" },
  ...over,
});
const run = (i: AvailabilityInput, from = "2026-10-20", to = "2026-10-22") =>
  availabilityToolResult("org-A", "p1", { kind: "loaded", input: i }, { from, to }, NOW);

describe("müsaitlik aracı — durum eşlemesi", () => {
  it("taze kaynak + boş geceler → ok / available / verified; kesin söylenebilir", () => {
    const r = run(input());
    expect(r).toMatchObject({ tool: AVAILABILITY_TOOL, status: "ok", scope: { organizationId: "org-A", propertyId: "p1" } });
    expect(r.value).toMatchObject({ verdict: "available", certainty: "verified", nights: 2, freeNights: 2, blockedNights: 0 });
    expect(mayStateAsFact(r, r.scope)).toBe(true);
  });

  it("host'un kendi girişi geceyi kapatıyor → ok / unavailable", () => {
    const r = run(input({ reservations: [hostStay("2026-10-19", "2026-10-23")] }));
    expect(r.status).toBe("ok");
    expect(r.value).toMatchObject({ verdict: "unavailable", certainty: "verified", blockedNights: 2 });
  });

  it("🚨 bayat kaynak → stale; kesin cevap DEĞİL", () => {
    const r = run(input({ sources: [feed({ lastSuccessAt: new Date(NOW.getTime() - 10 * H) })] }));
    expect(r.status).toBe("stale");
    expect(r.reasons).toContain("source_stale");
    expect(mayStateAsFact(r, r.scope)).toBe(false);
  });

  it("🚨 hiç kaynak yok → uncertain (kayıt yokluğu boşluk kanıtı değildir)", () => {
    const r = run(input({ sources: [] }));
    expect(r.status).toBe("uncertain");
    expect(r.reasons).toContain("no_coverage_sources");
    expect(r.value?.verdict).toBe("unknown");
    expect(mayStateAsFact(r, r.scope)).toBe(false);
  });

  it("🚨 kaynak hatası → uncertain", () => {
    const r = run(input({ sources: [feed({ lastStatus: "error", lastSuccessAt: null })] }));
    expect(r.status).toBe("uncertain");
    expect(r.reasons).toContain("source_error");
  });

  it("🚨 yalnız kanıtsız işgal (bayat köprü satırı) → uncertain, 'dolu' kesin söylenmez", () => {
    const ghost: ReservationSnapshot = { ...hostStay("2026-10-19", "2026-10-23"), origin: "channel_unattributed" };
    const r = run(input({ reservations: [ghost] }));
    expect(r.value).toMatchObject({ verdict: "unavailable", certainty: "unverified" });
    expect(r.status).toBe("uncertain");
    expect(mayStateAsFact(r, r.scope)).toBe(false);
  });

  it("geçersiz aralık → invalid_request, değer yok", () => {
    const r = run(input(), "2026-10-22", "2026-10-20");
    expect(r).toMatchObject({ status: "invalid_request", value: null, reasons: ["from_not_before_to"] });
  });

  it("🚨 mülk bu kiracıda yok → not_found, değer yok (asla 'müsait' değil)", () => {
    const r = availabilityToolResult("org-B", "p1", { kind: "property_not_found" }, { from: "2026-10-20", to: "2026-10-22" }, NOW);
    expect(r).toMatchObject({ status: "not_found", value: null, scope: { organizationId: "org-B", propertyId: "p1" } });
    expect(mayStateAsFact(r, r.scope)).toBe(false);
  });

  it("değer PII / iç kimlik taşımaz (kapalı alan kümesi)", () => {
    const r = run(input({ reservations: [hostStay("2026-10-19", "2026-10-23")] }));
    expect(Object.keys(r.value ?? {}).sort()).toEqual(
      ["blockedNights", "certainty", "conflictCount", "engineVersion", "freeNights", "from", "nights", "to", "unknownNights", "verdict"].sort(),
    );
    expect(JSON.stringify(r)).not.toContain("res-1");
  });
});

describe("inceleme 10-09 (Haiku) — ek vakalar", () => {
  const feedStay = (from: string, to: string): ReservationSnapshot => ({
    ...hostStay(from, to),
    origin: "calendar_feed",
    calendarSourceId: "src-1",
    feedLastSeenAt: new Date(NOW.getTime() - 10 * H),
  });

  it("🚨 P1: BAYAT kaynağın son okumasında görülen rezervasyon kesin 'dolu' DEĞİL → stale", () => {
    const stale = feed({ lastSuccessAt: new Date(NOW.getTime() - 10 * H) });
    const x = run(input({ sources: [stale], reservations: [feedStay("2026-10-19", "2026-10-23")] }));
    expect(x.value?.verdict).toBe("unavailable");
    expect(x.status).toBe("stale");
    expect(mayStateAsFact(x, x.scope)).toBe(false);
  });

  it("KONTROL: kaynak bayat olsa da ev sahibinin KENDİ girişi kesin 'dolu'dur → ok", () => {
    const stale = feed({ lastSuccessAt: new Date(NOW.getTime() - 10 * H) });
    expect(run(input({ sources: [stale], reservations: [hostStay("2026-10-19", "2026-10-23")] })).status).toBe("ok");
  });

  it("KONTROL: taze kaynağın son okumasında görülen rezervasyon → ok / unavailable", () => {
    const fresh = feed({ lastSuccessAt: new Date(NOW.getTime() - H) });
    const stay = { ...feedStay("2026-10-19", "2026-10-23"), feedLastSeenAt: new Date(NOW.getTime() - H) };
    expect(run(input({ sources: [fresh], reservations: [stay] }))).toMatchObject({ status: "ok", value: { verdict: "unavailable" } });
  });

  it("🚨 ev sahibi gecesi + BAYAT besleme gecesi: karar kesin 'dolu' ama besleme geceleri doğrulanmamış sayılır (tur 4)", () => {
    const stale = feed({ lastSuccessAt: new Date(NOW.getTime() - 10 * H) });
    const hostNight = hostStay("2026-10-19", "2026-10-20");
    const feedNights = { ...feedStay("2026-10-20", "2026-10-22"), id: "res-2" };
    const x = availabilityToolResult("org-A", "p1", { kind: "loaded", input: input({ sources: [stale], reservations: [hostNight, feedNights] }) }, { from: "2026-10-19", to: "2026-10-22" }, NOW);
    expect(x.status).toBe("ok");
    expect(x.value).toMatchObject({ verdict: "unavailable", blockedNights: 1, unknownNights: 2 });
    expect(x.reasons).toContain("night_counts_partially_unverified");
  });

  it("çakışma varsa gerekçede conflict_present", () => {
    const a = hostStay("2026-10-19", "2026-10-23");
    const b = { ...hostStay("2026-10-20", "2026-10-21"), id: "res-2" };
    expect(run(input({ reservations: [a, b] })).reasons).toContain("conflict_present");
  });

  it("sürüm = araç SÖZLEŞMESİNİN sürümü (motor sürümü değerde ayrıca)", () => {
    const x = run(input());
    expect(x.toolVersion).toBe(AVAILABILITY_TOOL_VERSION);
    expect(x.value?.engineVersion).toBe(1);
  });

  it.each([
    ["geçmiş aralık", "2026-10-01", "2026-10-03", "starts_in_past"],
    ["62 geceden uzun", "2026-10-20", "2026-12-31", "too_many_nights"],
    ["ufuk ötesi", "2027-11-01", "2027-11-03", "beyond_horizon"],
  ])("%s → invalid_request (%s)", (_n, from, to, reason) => {
    expect(run(input({ loadedRange: { from: "2026-01-01", to: "2028-01-01" } }), from, to)).toMatchObject({
      status: "invalid_request",
      reasons: [reason],
    });
  });

  it("🚨 kesin bilgi BAŞKA mülk için söylenemez (beklenen kapsam verilirse karşılaştırılır)", () => {
    const x = run(input());
    expect(mayStateAsFact(x, { organizationId: "org-A", propertyId: "p1" })).toBe(true);
    expect(mayStateAsFact(x, { organizationId: "org-A", propertyId: "p2" })).toBe(false);
    expect(mayStateAsFact(x, { organizationId: "org-B", propertyId: "p1" })).toBe(false);
  });
});

describe("mayStateAsFact — tek kural: yalnız ok", () => {
  it.each(TOOL_STATUSES)("%s", (status) => {
    expect(mayStateAsFact({ status, value: {}, scope: { organizationId: "o", propertyId: "p" } }, { organizationId: "o", propertyId: "p" })).toBe(status === "ok");
  });
  it("ok ama değer yok → söylenemez", () => {
    expect(mayStateAsFact({ status: "ok", value: null, scope: { organizationId: "o", propertyId: "p" } }, { organizationId: "o", propertyId: "p" })).toBe(false);
  });
});
