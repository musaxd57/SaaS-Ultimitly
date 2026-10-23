import { describe, it, expect } from "vitest";
import {
  checkAvailability,
  describeNights,
  type AvailabilityInput,
  type CoverageSource,
  type ReservationSnapshot,
} from "@/modules/availability/core";
import { describeStayEdges, summarizeStayEdges } from "@/modules/availability/stay-edges";

// ---------------------------------------------------------------------------
// F16 (09-26): KISMİ OKUNAN KAYNAK "BOŞ" KANITI DEĞİLDİR.
//
// Senkron eksik okumayı (tavan, tekrarlayan etkinlik, okunamayan kayıt, yarım dosya) artık `partial`
// yazıyor. Motor böyle bir kaynakla — ne kadar taze olursa olsun — hiçbir geceye "boş" demez (kayıp
// rezervasyon okunamayan kısımda olabilir). O okumada GÖRÜLEN satır ise görülmüştür: "dolu" hükmü
// doğrulanmış kalır. İki yön birlikte sınanır: aynı veri `ok` kaynakla "müsait" der.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-01T09:00:00Z");
const READ_AT = new Date("2026-10-01T08:30:00Z");
const feed = (lastStatus: CoverageSource["lastStatus"]): CoverageSource => ({
  id: "src1",
  kind: "calendar_feed",
  label: "Airbnb",
  lastStatus,
  lastSuccessAt: READ_AT,
});
const seenRow: ReservationSnapshot = {
  id: "r1",
  arrival: new Date("2026-10-05T12:00:00Z"),
  departure: new Date("2026-10-07T12:00:00Z"),
  status: "confirmed",
  origin: "calendar_feed",
  calendarSourceId: "src1",
  feedLastSeenAt: new Date("2026-10-01T08:29:00Z"), // o okumanın başında damgalandı
};
const input = (source: CoverageSource, reservations: ReservationSnapshot[] = [seenRow]): AvailabilityInput => ({
  propertyId: "p1",
  timeZone: TZ,
  now: NOW,
  reservations,
  sources: [source],
  loadTruncated: false,
});

describe("müsaitlik motoru: kısmi kaynak", () => {
  it("🚨 taze ama KISMİ kaynakta boş gece 'bilinmiyor (source_incomplete)' — asla 'müsait'", () => {
    const r = describeNights(input(feed("partial")), { from: "2026-10-02", to: "2026-10-03" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.nights[0]).toMatchObject({ state: "unknown", unknownReasons: ["source_incomplete"] });
    expect(r.value.sources[0].state).toBe("incomplete");
    expect(checkAvailability(input(feed("partial")), { from: "2026-10-02", to: "2026-10-04" })).toMatchObject({
      ok: true,
      value: { verdict: "unknown", certainty: "unverified" },
    });
  });

  it("aynı veri TAM okunmuş kaynakla 'müsait (doğrulanmış)' — kural yalnız kısmi okumayı keser", () => {
    expect(checkAvailability(input(feed("ok")), { from: "2026-10-02", to: "2026-10-04" })).toMatchObject({
      ok: true,
      value: { verdict: "available", certainty: "verified" },
    });
  });

  it("kısmi okumada GÖRÜLEN satır görülmüştür: dolu gece 'dolu (doğrulanmış)' kalır", () => {
    expect(checkAvailability(input(feed("partial")), { from: "2026-10-05", to: "2026-10-06" })).toMatchObject({
      ok: true,
      value: { verdict: "unavailable", certainty: "verified" },
    });
  });

  it("kısmi kaynak bayatlasa da nedeni 'eksik okuma' olarak kalır (iki neden birbirini gizlemez: ikisi de boş DEMEZ)", () => {
    const stale: CoverageSource = { ...feed("partial"), lastSuccessAt: new Date("2026-09-25T00:00:00Z") };
    const r = describeNights(input(stale), { from: "2026-10-02", to: "2026-10-03" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.nights[0]).toMatchObject({ state: "unknown", unknownReasons: ["source_incomplete"] });
  });
});

describe("host metni", () => {
  it("dipnot eksik okumayı sade dille söyler", () => {
    const stay = { id: "cur", arrival: new Date("2026-10-10T12:00:00Z"), departure: new Date("2026-10-12T12:00:00Z") };
    const edges = describeStayEdges(input(feed("partial"), []), stay);
    if (!edges) throw new Error("kenar yok");
    expect(summarizeStayEdges(edges).footer).toContain("Takvimin bir kısmı okunamadı.");
    // Tam okunmuş kaynakla aynı konaklamada dipnot YOK (kenarlar kanıtla boş).
    const full = describeStayEdges(input(feed("ok"), []), stay);
    if (!full) throw new Error("kenar yok");
    expect(summarizeStayEdges(full).footer).toBeNull();
  });
});
