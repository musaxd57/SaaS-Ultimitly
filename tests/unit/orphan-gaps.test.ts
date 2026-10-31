import { describe, it, expect } from "vitest";
import {
  describeNights,
  type AvailabilityInput,
  type CoverageSource,
  type NightEvidence,
  type NightState,
  type ReservationSnapshot,
} from "@/modules/availability/core";
import { findOrphanGaps, ORPHAN_GAP_MAX_NIGHTS } from "@/modules/availability/gaps";

// ---------------------------------------------------------------------------
// YETİM BOŞLUK (V2 boşluk satırı) — saf dedektör. Tahmin YOK: yalnız motorun gece durumları; bilinmeyen gece iddiayı keser; onay
// bekleyen talep komşu sayılmaz. Tutar YOK (kurucu 10-11: gerçek fiyat Airbnb Direct takviminden gelince).
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-01T09:00:00Z"); // İstanbul 12:00, bugün = 2026-10-01
const FRESH: CoverageSource = { id: "src1", kind: "calendar_feed", label: "Airbnb", lastStatus: "ok", lastSuccessAt: new Date("2026-10-01T08:30:00Z") };
const STALE: CoverageSource = { ...FRESH, lastSuccessAt: new Date("2026-09-20T08:30:00Z") };

let seq = 0;
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
function res(arrival: string, departure: string, p: Partial<ReservationSnapshot> = {}): ReservationSnapshot {
  return { id: `r${++seq}`, status: "confirmed", origin: "host_entered", calendarSourceId: null, feedLastSeenAt: null, arrival: midnight(arrival), departure: midnight(departure), ...p };
}
function nights(reservations: ReservationSnapshot[], sources: CoverageSource[] = [FRESH], from = "2026-10-01", to = "2026-10-31") {
  const input: AvailabilityInput = { propertyId: "p1", timeZone: TZ, now: NOW, reservations, sources, loadTruncated: false };
  const r = describeNights(input, { from, to });
  if (!r.ok) throw new Error(r.reason);
  return r.value.nights;
}
/** Sentetik gece dizisi: "B" booked · "F" free · "H" held · "U" unknown; 2026-10-01'den başlar. */
function synth(pattern: string, basis: "fresh" | "unconfirmed" = "fresh"): NightEvidence[] {
  const map: Record<string, NightState> = { B: "booked", F: "free", H: "held", U: "unknown" };
  return [...pattern].map((ch, i) => ({
    night: `2026-10-${String(i + 1).padStart(2, "0")}`,
    state: map[ch],
    claims: ch === "B" || ch === "H" ? [{ reservationId: `x${i}`, origin: "calendar_feed", statusClass: ch === "B" ? "booked" : "held", basis }] : [],
    unknownReasons: ch === "U" ? ["source_stale"] : [],
  }));
}

describe("findOrphanGaps — saf", () => {
  it("🚨 iki kesin konaklama arasında 1 ve 2 gecelik boşluk bulunur; [from, to) to = sonraki konaklamanın ilk gecesi", () => {
    expect(findOrphanGaps(synth("BBFBB"), { fromNight: "2026-10-01" })).toEqual([
      { from: "2026-10-03", to: "2026-10-04", nights: 1, confirmed: true },
    ]);
    expect(findOrphanGaps(synth("BFFB"), { fromNight: "2026-10-01" })).toEqual([
      { from: "2026-10-02", to: "2026-10-04", nights: 2, confirmed: true },
    ]);
  });

  it("KONTROL: üç gece ve üstü boşluk yetim değildir (satılabilir sıradan boşluk)", () => {
    expect(ORPHAN_GAP_MAX_NIGHTS).toBe(2);
    expect(findOrphanGaps(synth("BFFFB"), { fromNight: "2026-10-01" })).toEqual([]);
  });

  it("🚨 bilinmeyen (bayat kaynak) gece boşluğun içinde ya da kenarında → iddia YOK", () => {
    expect(findOrphanGaps(synth("BFUB"), { fromNight: "2026-10-01" })).toEqual([]);
    expect(findOrphanGaps(synth("UFB"), { fromNight: "2026-10-01" })).toEqual([]);
    expect(findOrphanGaps(synth("BFU"), { fromNight: "2026-10-01" })).toEqual([]);
  });

  it("🚨 onay bekleyen talep (held) komşu SAYILMAZ — talep reddedilirse boşluk yetim değil", () => {
    expect(findOrphanGaps(synth("HFB"), { fromNight: "2026-10-01" })).toEqual([]);
    expect(findOrphanGaps(synth("BFH"), { fromNight: "2026-10-01" })).toEqual([]);
  });

  it("aralığın kenarındaki boşluk (komşu görülmüyor) sayılmaz; `fromNight` öncesi başlayan sayılmaz", () => {
    expect(findOrphanGaps(synth("FB"), { fromNight: "2026-10-01" })).toEqual([]);
    expect(findOrphanGaps(synth("BF"), { fromNight: "2026-10-01" })).toEqual([]);
    expect(findOrphanGaps(synth("BFBFB"), { fromNight: "2026-10-03" })).toEqual([
      { from: "2026-10-04", to: "2026-10-05", nights: 1, confirmed: true },
    ]);
  });

  it("komşulardan biri yalnız kanıtsız iddiaysa (`unconfirmed`) boşluk bulunur ama `confirmed: false`", () => {
    expect(findOrphanGaps(synth("BFB", "unconfirmed"), { fromNight: "2026-10-01" })).toEqual([
      { from: "2026-10-02", to: "2026-10-03", nights: 1, confirmed: false },
    ]);
  });

  it("birden çok boşluk sırayla; bitişik ikinci aday ilkini bozmaz", () => {
    expect(findOrphanGaps(synth("BFBFFBFFFB"), { fromNight: "2026-10-01" }).map((g) => [g.from, g.nights])).toEqual([
      ["2026-10-02", 1],
      ["2026-10-04", 2],
    ]);
  });
});

describe("findOrphanGaps × motor (uçtan uca, saf)", () => {
  it("🚨 ev sahibinin iki konaklaması arasında 1 gece: motorun gece durumlarından bulunur", () => {
    const n = nights([res("2026-10-05", "2026-10-08"), res("2026-10-09", "2026-10-12")]);
    expect(findOrphanGaps(n, { fromNight: "2026-10-01" })).toEqual([{ from: "2026-10-08", to: "2026-10-09", nights: 1, confirmed: true }]);
  });

  it("🚨 kapsama kaynağı BAYAT → geceler bilinmiyor → boşluk iddiası yok (yanlış fırsat gösterilmez)", () => {
    const n = nights([res("2026-10-05", "2026-10-08"), res("2026-10-09", "2026-10-12")], [STALE]);
    expect(findOrphanGaps(n, { fromNight: "2026-10-01" })).toEqual([]);
  });

  it("iptal edilmiş komşu konaklama boşluğu kapatmaz / açmaz (iptal satırı sayılmaz)", () => {
    const n = nights([res("2026-10-05", "2026-10-08"), res("2026-10-09", "2026-10-12", { status: "cancelled" })]);
    expect(findOrphanGaps(n, { fromNight: "2026-10-01" })).toEqual([]);
  });
});
