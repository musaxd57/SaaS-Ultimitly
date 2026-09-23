import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addNights,
  calendarDateOf,
  checkAvailability,
  describeNights,
  nightsBetween,
  parseNightKey,
  statusClassOf,
  todayKey,
  type AvailabilityInput,
  type CoverageSource,
  type ReservationSnapshot,
} from "@/modules/availability/core";
import { dateKeyInTimeZone } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// MÜSAİTLİK MOTORU — SAF ÇEKİRDEK. Gece semantiği, tek tarih kuralı, kapalı başarısız "boş",
// çakışma olgusu (birleştirme YOK), metamorfik özellikler ve mimari pin.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-01T09:00:00Z"); // İstanbul 12:00, bugün = 2026-10-01
const FRESH_FEED: CoverageSource = {
  id: "src1",
  kind: "calendar_feed",
  label: "Airbnb",
  lastStatus: "ok",
  lastSuccessAt: new Date("2026-10-01T08:30:00Z"),
};

let seq = 0;
function res(p: Partial<ReservationSnapshot> & { arrival: Date; departure: Date }): ReservationSnapshot {
  return {
    id: p.id ?? `r${++seq}`,
    status: "confirmed",
    origin: "host_entered",
    calendarSourceId: null,
    feedLastSeenAt: null,
    ...p,
  };
}
/** Tarih yazma biçimleri: köprü/elle giriş gece yarısı UTC, iCal tarih değeri öğlen UTC. */
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);

function input(p: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return { propertyId: "p1", timeZone: TZ, now: NOW, reservations: [], sources: [FRESH_FEED], loadTruncated: false, ...p };
}
function nightsOf(i: AvailabilityInput, from: string, to: string) {
  const r = describeNights(i, { from, to });
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}
const stateMap = (i: AvailabilityInput, from: string, to: string) =>
  Object.fromEntries(nightsOf(i, from, to).nights.map((n) => [n.night, n.state]));

describe("gece anahtarı ve takvim aritmetiği", () => {
  it("geçersiz takvim günü reddedilir, geçerli döner", () => {
    expect(parseNightKey("2026-02-30")).toBeNull();
    expect(parseNightKey("2026-2-3")).toBeNull();
    expect(parseNightKey("çöp")).toBeNull();
    expect(parseNightKey("2028-02-29")).toBe("2028-02-29");
  });

  it("artık gün, ay ve yıl devri saf takvim aritmetiğiyle", () => {
    expect(addNights("2028-02-28", 1)).toBe("2028-02-29");
    expect(addNights("2028-02-29", 1)).toBe("2028-03-01");
    expect(addNights("2026-12-31", 1)).toBe("2027-01-01");
    expect(nightsBetween("2026-10-01", "2026-10-05")).toBe(4);
    expect(nightsBetween("2026-10-05", "2026-10-01")).toBe(-4);
  });

  it("DST'li dilimde gece yürüyüşü günü atlamaz (Berlin 2026-03-29 ve 2026-10-25)", () => {
    expect(addNights("2026-03-28", 1)).toBe("2026-03-29");
    expect(addNights("2026-03-29", 1)).toBe("2026-03-30");
    expect(addNights("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("'bugün' mülk diliminde: 22:30Z İstanbul'da ertesi gün", () => {
    expect(todayKey(new Date("2026-10-01T22:30:00Z"), TZ)).toBe("2026-10-02");
    expect(todayKey(new Date("2026-10-01T22:30:00Z"), "UTC")).toBe("2026-10-01");
  });
});

describe("tek tarih kuralı (çapa)", () => {
  it("gece yarısı UTC ve öğlen UTC 'yalnız tarih' sayılır — her dilimde aynı gün", () => {
    for (const tz of [TZ, "America/New_York", "Pacific/Auckland", "UTC"]) {
      expect(calendarDateOf(midnight("2026-10-05"), tz)).toEqual({ key: "2026-10-05", anchor: "utc_midnight" });
      expect(calendarDateOf(noon("2026-10-05"), tz)).toEqual({ key: "2026-10-05", anchor: "utc_noon" });
    }
  });

  it("çapa TAM olmalı: milisaniye bile taşıyan değer GERÇEK ANDIR (New York'ta önceki gün)", () => {
    // Mutasyon turu (09-24): milisaniye koşulu silinince hiçbir test düşmüyordu — İstanbul'da
    // 00:00:00.123Z zaten aynı güne düşer; ayırt edici dilim batıdakidir.
    expect(calendarDateOf(new Date("2026-03-10T00:00:00.123Z"), "America/New_York")).toEqual({ key: "2026-03-09", anchor: "instant" });
    expect(calendarDateOf(new Date("2026-03-10T00:00:00.000Z"), "America/New_York")).toEqual({ key: "2026-03-10", anchor: "utc_midnight" });
  });

  it("gerçek an mülk diliminde okunur (TZID'li iCal)", () => {
    // İstanbul 2026-10-05 01:30 = 2026-10-04 22:30Z → gün İstanbul'a göre 10-05.
    expect(calendarDateOf(new Date("2026-10-04T22:30:00Z"), TZ)).toEqual({ key: "2026-10-05", anchor: "instant" });
  });

  it("🚨 karışık yazım: köprü çıkışı (00:00Z) ile iCal girişi (12:00Z) aynı gün → DEVİR, çakışma DEĞİL", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), origin: "channel_unattributed" }),
        res({ id: "b", arrival: noon("2026-10-05"), departure: noon("2026-10-07"), origin: "calendar_feed", calendarSourceId: "src1" }),
      ],
    });
    const r = nightsOf(i, "2026-10-03", "2026-10-07");
    expect(r.conflicts).toEqual([]);
    expect(r.nights.map((n) => n.state)).toEqual(["booked", "booked", "booked", "booked"]);
  });
});

describe("İstanbul paritesi — tek tarih kuralı takvim sayfasıyla birebir", () => {
  // `/calendar` ve raporlar gün anahtarını org diliminde `dateKeyInTimeZone` ile üretiyor.
  // İstanbul'da (UTC+3, DST yok) çapa kuralı HER yazar biçimi için aynı günü vermeli.
  it.each([
    ["köprü / elle giriş (00:00Z)", midnight("2026-10-05")],
    ["iCal tarih değeri (12:00Z)", noon("2026-10-05")],
    ["iCal TZID İstanbul 15:00 (12:00Z)", new Date("2026-10-05T12:00:00Z")],
    ["iCal TZID İstanbul 00:30 (21:30Z önceki gün)", new Date("2026-10-04T21:30:00Z")],
    ["iCal TZID İstanbul 23:30 (20:30Z)", new Date("2026-10-05T20:30:00Z")],
  ])("%s", (_label, stored) => {
    expect(calendarDateOf(stored, TZ).key).toBe(dateKeyInTimeZone(stored, TZ));
  });
});

describe("gece semantiği — yarı açık [giriş, çıkış)", () => {
  const i = input({ reservations: [res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05") })] });

  it("çıkış gecesi boştur; giriş gecesi doludur", () => {
    expect(stateMap(i, "2026-10-02", "2026-10-06")).toEqual({
      "2026-10-02": "free",
      "2026-10-03": "booked",
      "2026-10-04": "booked",
      "2026-10-05": "free",
    });
  });

  it("çıkış günü başlayan ve giriş günü biten aralık müsait", () => {
    expect(checkAvailability(i, { from: "2026-10-05", to: "2026-10-08" })).toMatchObject({ ok: true, value: { verdict: "available", certainty: "verified" } });
    expect(checkAvailability(i, { from: "2026-10-01", to: "2026-10-03" })).toMatchObject({ ok: true, value: { verdict: "available" } });
  });

  it("uç uca iki konaklama çakışma üretmez", () => {
    const j = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05") }),
        res({ id: "b", arrival: midnight("2026-10-05"), departure: midnight("2026-10-06") }),
      ],
    });
    expect(nightsOf(j, "2026-10-01", "2026-10-10").conflicts).toEqual([]);
  });
});

describe("durum sınıfları", () => {
  it("confirmed/completed dolu · pending tutuluyor · cancelled yok sayılır · tanınmayan İŞGAL EDER", () => {
    expect(statusClassOf("confirmed")).toBe("booked");
    expect(statusClassOf("completed")).toBe("booked");
    expect(statusClassOf("pending")).toBe("held");
    expect(statusClassOf("cancelled")).toBe("ignored");
    expect(statusClassOf("inquiry")).toBe("unrecognized");
  });

  it("iptal edilmiş rezervasyon geceyi işgal etmez ve çakışma üretmez", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05") }),
        res({ id: "b", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), status: "cancelled" }),
      ],
    });
    const r = nightsOf(i, "2026-10-03", "2026-10-05");
    expect(r.conflicts).toEqual([]);
    expect(r.nights[0].claims.map((c) => c.reservationId)).toEqual(["a"]);
  });

  it("yalnız talep (pending) → 'held'; tanınmayan durum → 'booked' (güvenli yön)", () => {
    const i = input({
      reservations: [
        res({ arrival: midnight("2026-10-03"), departure: midnight("2026-10-04"), status: "pending" }),
        res({ arrival: midnight("2026-10-04"), departure: midnight("2026-10-05"), status: "garip" }),
      ],
    });
    expect(stateMap(i, "2026-10-03", "2026-10-05")).toEqual({ "2026-10-03": "held", "2026-10-04": "booked" });
  });
});

describe("kapalı başarısız 'boş' — kanıt yoksa 'bilinmiyor'", () => {
  it("kapsama kaynağı yoksa boş gece 'unknown(no_coverage_sources)' — asla 'free'", () => {
    const r = nightsOf(input({ sources: [] }), "2026-10-03", "2026-10-04");
    expect(r.nights[0]).toMatchObject({ state: "unknown", unknownReasons: ["no_coverage_sources"] });
    expect(checkAvailability(input({ sources: [] }), { from: "2026-10-03", to: "2026-10-04" })).toMatchObject({
      ok: true,
      value: { verdict: "unknown", certainty: "unverified" },
    });
  });

  it.each([
    [{ lastStatus: "error" as const }, "source_error"],
    [{ lastStatus: null, lastSuccessAt: null }, "source_never_synced"],
    [{ lastSuccessAt: new Date("2026-09-30T00:00:00Z") }, "source_stale"],
  ])("tek bozuk kaynak (%j) → '%s'", (patch, reason) => {
    const r = nightsOf(input({ sources: [FRESH_FEED, { ...FRESH_FEED, id: "src2", ...patch }] }), "2026-10-03", "2026-10-04");
    expect(r.nights[0].state).toBe("unknown");
    expect(r.nights[0].unknownReasons).toContain(reason);
  });

  it("kanal bağlantısı tazeliği KAYDEDİLMİYORSA boş gece bilinmiyor (bugünkü köprü)", () => {
    const link: CoverageSource = { id: "link", kind: "channel_link", label: "Kanal", lastStatus: null, lastSuccessAt: null };
    const r = nightsOf(input({ sources: [link] }), "2026-10-03", "2026-10-04");
    expect(r.nights[0].unknownReasons).toEqual(["source_freshness_unrecorded"]);
  });

  it("satır tavanına çarpıldıysa boş görünen gece 'unknown(load_truncated)'; dolu gece dolu kalır", () => {
    const i = input({ loadTruncated: true, reservations: [res({ arrival: midnight("2026-10-03"), departure: midnight("2026-10-04") })] });
    expect(stateMap(i, "2026-10-03", "2026-10-05")).toEqual({ "2026-10-03": "booked", "2026-10-04": "unknown" });
  });

  it("ters kayıt aradaki geceleri 'boş' dedirtmez; sıfır gecelik kayıt işgal etmez ama raporlanır", () => {
    const i = input({
      reservations: [
        res({ id: "inv", arrival: midnight("2026-10-06"), departure: midnight("2026-10-04") }),
        res({ id: "zero", arrival: midnight("2026-10-08"), departure: midnight("2026-10-08") }),
      ],
    });
    const r = nightsOf(i, "2026-10-03", "2026-10-09");
    expect(Object.fromEntries(r.nights.map((n) => [n.night, n.state]))).toMatchObject({
      "2026-10-03": "free",
      "2026-10-04": "unknown",
      "2026-10-05": "unknown",
      "2026-10-06": "free",
      // İnceleme 09-24: sıfır gecelik kayıt hangi geceyi kastettiği bilinemediği için o geceyi
      // "boş" dedirtmez (eskiden "free" idi — kapalı başarısız kuralının delinmesi).
      "2026-10-08": "unknown",
    });
    expect(r.anomalies).toEqual([
      { reservationId: "inv", kind: "inverted" },
      { reservationId: "zero", kind: "zero_nights" },
    ]);
  });
});

describe("karar ve kesinlik", () => {
  it("host'un kendi girdiği rezervasyon → unavailable + verified", () => {
    const i = input({ reservations: [res({ arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), origin: "host_entered" })] });
    expect(checkAvailability(i, { from: "2026-10-04", to: "2026-10-06" })).toMatchObject({ ok: true, value: { verdict: "unavailable", certainty: "verified" } });
  });

  it("yalnız kanıtsız iddia (bayat köprü / hayalet besleme satırı) → unavailable + UNVERIFIED", () => {
    const i = input({
      reservations: [res({ arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), origin: "channel_unattributed" })],
    });
    expect(checkAvailability(i, { from: "2026-10-04", to: "2026-10-06" })).toMatchObject({ ok: true, value: { verdict: "unavailable", certainty: "unverified" } });
  });

  it("besleme satırı yalnız kaynağın SON başarılı okumasında görüldüyse 'fresh'", () => {
    // 🚨 Gerçek sıralama (inceleme 09-24): senkron `feedLastSeenAt`i koşunun BAŞINDA, `lastSyncedAt`i
    // SONUNDA yazar → görülme anı son başarıdan hep biraz ÖNCEDİR. Eski test ikisini eşit veriyordu
    // (veritabanında hiç olmayan durum) ve "fresh" yolu gerçekte hiç çalışmıyordu.
    const seen = res({
      arrival: noon("2026-10-03"),
      departure: noon("2026-10-05"),
      origin: "calendar_feed",
      calendarSourceId: "src1",
      feedLastSeenAt: new Date("2026-10-01T08:29:59.588Z"), // koşu başı, son başarıdan 412 ms önce
    });
    const r = nightsOf(input({ reservations: [seen] }), "2026-10-03", "2026-10-04");
    expect(r.nights[0].claims[0].basis).toBe("fresh");
    const stale = { ...seen, feedLastSeenAt: new Date("2026-09-20T00:00:00Z") };
    expect(nightsOf(input({ reservations: [stale] }), "2026-10-03", "2026-10-04").nights[0].claims[0].basis).toBe("unconfirmed");
    // Bir ÖNCEKİ koşuda (kadans 15 dk) görülüp son koşuda görülmeyen satır taze DEĞİL.
    const previousRun = { ...seen, feedLastSeenAt: new Date("2026-10-01T08:14:00Z") };
    expect(nightsOf(input({ reservations: [previousRun] }), "2026-10-03", "2026-10-04").nights[0].claims[0].basis).toBe("unconfirmed");
  });

  it.each([
    [{ from: "2026-02-30", to: "2026-10-05" }, "bad_date"],
    [{ from: "2026-10-05", to: "2026-10-05" }, "from_not_before_to"],
    [{ from: "2026-10-05", to: "2026-12-31" }, "too_many_nights"],
    [{ from: "2027-09-20", to: "2027-10-10" }, "beyond_horizon"],
    [{ from: "2026-09-29", to: "2026-10-02" }, "starts_in_past"],
  ])("geçersiz aralık %j → %s (fırlatmaz)", (range, reason) => {
    expect(checkAvailability(input(), range)).toEqual({ ok: false, reason });
  });

  it("🚨 bir gece boş, bir gece bilinmiyorsa karar 'müsait' DEĞİL 'bilinmiyor'", () => {
    // Mutasyon turu (09-24): "her gece boş" şartı "bir gece boş"a gevşetilince hiçbir test düşmüyordu.
    const i = input({ reservations: [res({ id: "inv", arrival: midnight("2026-10-05"), departure: midnight("2026-10-04") })] });
    expect(stateMap(i, "2026-10-03", "2026-10-05")).toEqual({ "2026-10-03": "free", "2026-10-04": "unknown" });
    expect(checkAvailability(i, { from: "2026-10-03", to: "2026-10-05" })).toMatchObject({ ok: true, value: { verdict: "unknown", certainty: "unverified" } });
  });

  it("🚨 yüklenen aralığın DIŞINDAKİ boş gece 'müsait' değil 'bilinmiyor' (başka aralık için yüklenmiş girdi)", () => {
    const i = input({ loadedRange: { from: "2026-10-01", to: "2026-10-10" } });
    expect(stateMap(i, "2026-10-08", "2026-10-12")).toEqual({
      "2026-10-08": "free",
      "2026-10-09": "free",
      "2026-10-10": "unknown",
      "2026-10-11": "unknown",
    });
    expect(nightsOf(i, "2026-10-10", "2026-10-11").nights[0].unknownReasons).toEqual(["outside_loaded_range"]);
    expect(checkAvailability(i, { from: "2026-10-12", to: "2026-10-14" })).toMatchObject({ ok: true, value: { verdict: "unknown" } });
  });

  it("host görünümü (describeNights) geçmiş geceleri kabul eder", () => {
    expect(describeNights(input(), { from: "2026-09-20", to: "2026-09-22" }).ok).toBe(true);
  });
});

describe("çakışma — OLGU, birleştirme DEĞİL (değişmez 6)", () => {
  it("iki farklı konaklama aynı geceleri işgal ederse tek aralık, olgularıyla", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-07"), origin: "host_entered" }),
        res({ id: "b", arrival: noon("2026-10-05"), departure: noon("2026-10-09"), origin: "calendar_feed", calendarSourceId: "src1" }),
      ],
    });
    expect(nightsOf(i, "2026-10-01", "2026-10-12").conflicts).toEqual([
      { from: "2026-10-05", to: "2026-10-07", reservationIds: ["a", "b"], facts: { identicalSpan: false, sameOrigin: false, anyHeld: false, allUnconfirmed: false } },
    ]);
  });

  it("aynı tarihli iki satır → identicalSpan (aynı konaklama iki kaynaktan gelmiş olabilir) — yine de İKİSİ DE sayılır", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05"), origin: "channel_unattributed" }),
        res({ id: "b", arrival: noon("2026-10-03"), departure: noon("2026-10-05"), origin: "calendar_feed", calendarSourceId: "src1", status: "pending" }),
      ],
    });
    const r = nightsOf(i, "2026-10-01", "2026-10-10");
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].facts).toEqual({ identicalSpan: true, sameOrigin: false, anyHeld: true, allUnconfirmed: true });
    expect(r.nights.find((n) => n.night === "2026-10-03")!.claims).toHaveLength(2);
  });

  it("iddia kümesi değişince aralık bölünür (üç konaklama zinciri)", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-08") }),
        res({ id: "b", arrival: midnight("2026-10-04"), departure: midnight("2026-10-05") }),
        res({ id: "c", arrival: midnight("2026-10-06"), departure: midnight("2026-10-07") }),
      ],
    });
    expect(nightsOf(i, "2026-10-01", "2026-10-10").conflicts.map((c) => [c.from, c.to, c.reservationIds])).toEqual([
      ["2026-10-04", "2026-10-05", ["a", "b"]],
      ["2026-10-06", "2026-10-07", ["a", "c"]],
    ]);
  });

  it("🚨 arada boşluk OLMADAN iddia kümesi değişirse de aralık bölünür (a∩b bitişik b∩c)", () => {
    // Mutasyon turu (09-24): yalnız "iki kiralık arasında boş gece" zinciri sınanıyordu; küme
    // değişimini değil yalnız boşluğu kapatan bir kural da o testi geçiyordu.
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05") }),
        res({ id: "b", arrival: midnight("2026-10-04"), departure: midnight("2026-10-06") }),
        res({ id: "c", arrival: midnight("2026-10-05"), departure: midnight("2026-10-07") }),
      ],
    });
    expect(nightsOf(i, "2026-10-01", "2026-10-10").conflicts.map((c) => [c.from, c.to, c.reservationIds])).toEqual([
      ["2026-10-04", "2026-10-05", ["a", "b"]],
      ["2026-10-05", "2026-10-06", ["b", "c"]],
    ]);
  });

  it("aynı girişli ama farklı çıkışlı iki satır 'birebir aynı tarih' DEĞİLDİR", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-05") }),
        res({ id: "b", arrival: midnight("2026-10-03"), departure: midnight("2026-10-06") }),
      ],
    });
    expect(nightsOf(i, "2026-10-01", "2026-10-10").conflicts[0].facts.identicalSpan).toBe(false);
  });

  it("aralığın sonuna kadar süren çakışma aralık bitişinde kapanır", () => {
    const i = input({
      reservations: [
        res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-20") }),
        res({ id: "b", arrival: midnight("2026-10-03"), departure: midnight("2026-10-20") }),
      ],
    });
    expect(nightsOf(i, "2026-10-05", "2026-10-08").conflicts.map((c) => [c.from, c.to])).toEqual([["2026-10-05", "2026-10-08"]]);
  });
});

describe("metamorfik özellikler", () => {
  const base = [
    res({ id: "a", arrival: midnight("2026-10-03"), departure: midnight("2026-10-06"), origin: "channel_unattributed" }),
    res({ id: "b", arrival: noon("2026-10-05"), departure: noon("2026-10-08"), origin: "calendar_feed", calendarSourceId: "src1" }),
    res({ id: "c", arrival: midnight("2026-10-10"), departure: midnight("2026-10-12"), status: "pending" }),
  ];

  it("girdi sırası sonucu değiştirmez", () => {
    const a = nightsOf(input({ reservations: base }), "2026-10-01", "2026-10-15");
    const b = nightsOf(input({ reservations: [...base].reverse() }), "2026-10-01", "2026-10-15");
    expect(b).toEqual(a);
  });

  it("iddia eklemek hiçbir geceyi dolu→boş çeviremez", () => {
    const before = stateMap(input({ reservations: base }), "2026-10-01", "2026-10-15");
    const after = stateMap(input({ reservations: [...base, res({ arrival: midnight("2026-10-13"), departure: midnight("2026-10-14") })] }), "2026-10-01", "2026-10-15");
    for (const [night, s] of Object.entries(before)) {
      if (s === "booked" || s === "held") expect(after[night], night).not.toBe("free");
    }
  });

  it("kaynağı bayatlatmak hiçbir şeyi 'free' yapmaz", () => {
    const stale = { ...FRESH_FEED, lastSuccessAt: new Date("2026-09-01T00:00:00Z") };
    const r = nightsOf(input({ reservations: base, sources: [stale] }), "2026-10-01", "2026-10-15");
    expect(r.nights.some((n) => n.state === "free")).toBe(false);
  });

  it("iptal satırı eklemek hiçbir şeyi değiştirmez", () => {
    const a = nightsOf(input({ reservations: base }), "2026-10-01", "2026-10-15");
    const b = nightsOf(input({ reservations: [...base, res({ id: "x", arrival: midnight("2026-10-01"), departure: midnight("2026-10-15"), status: "cancelled" })] }), "2026-10-01", "2026-10-15");
    expect(b).toEqual(a);
  });

  it("çıktıda kişisel veri / kaynak adresi yok (girdide hiç taşınmaz)", () => {
    const json = JSON.stringify(nightsOf(input({ reservations: base }), "2026-10-01", "2026-10-15"));
    expect(json).not.toMatch(/https?:\/\//);
    expect(Object.keys(base[0]).sort()).toEqual(["arrival", "calendarSourceId", "departure", "feedLastSeenAt", "id", "origin", "status"]);
  });
});

describe("mimari pin — çekirdek saf", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/modules/availability/core.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  it("veritabanı / sağlayıcı / server-only importu yok; yalnız saat dilimi yardımcısı", () => {
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/timezone"]);
    expect(src).not.toMatch(/hospitable|server-only|prisma/i);
  });

  it("saat dışarıdan verilir: argümansız `new Date()` / `Date.now()` yok", () => {
    expect(src).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });
});
