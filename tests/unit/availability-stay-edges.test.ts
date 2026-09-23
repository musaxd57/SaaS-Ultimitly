import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AvailabilityInput, CoverageSource, ReservationSnapshot } from "@/modules/availability/core";
import { describeStayEdges, summarizeStayEdges, formatNightTr } from "@/modules/availability/stay-edges";

// ---------------------------------------------------------------------------
// KONAKLAMA KENARLARI (müsaitlik motoru dilim 2) — host'a erken giriş / geç çıkış / uzatma
// gecelerinin durumu. Karar motorun kendisidir (`checkAvailability`); burada pinlenen:
// kenar geceleri, misafirin kendi satırının dışlanması, tek tarih kuralı, kapalı başarısız "boş",
// dürüst metin (söz yok, "müsait" yok, tek dipnot) ve mimari saflık.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-01T09:00:00Z"); // İstanbul bugünü = 2026-10-01
const FRESH: CoverageSource = { id: "src1", kind: "calendar_feed", label: "Airbnb", lastStatus: "ok", lastSuccessAt: new Date("2026-10-01T08:30:00Z") };
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);

let seq = 0;
function res(p: Partial<ReservationSnapshot> & { arrival: Date; departure: Date }): ReservationSnapshot {
  return { id: p.id ?? `r${++seq}`, status: "confirmed", origin: "host_entered", calendarSourceId: null, feedLastSeenAt: null, ...p };
}
const OWN = { id: "own", arrival: midnight("2026-10-05"), departure: midnight("2026-10-08") };
const ownRow = () => res({ id: "own", arrival: OWN.arrival, departure: OWN.departure });
function input(p: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return { propertyId: "p1", timeZone: TZ, now: NOW, reservations: [ownRow()], sources: [FRESH], loadTruncated: false, ...p };
}
function edges(i: AvailabilityInput, stay = OWN) {
  const e = describeStayEdges(i, stay);
  if (!e) throw new Error("null edges");
  return e;
}

describe("describeStayEdges — kenar geceleri", () => {
  it("taze kapsama + komşu yok: iki kenar da 'boş' (doğrulanmış), sonraki rezervasyon yok, dipnot yok", () => {
    const e = edges(input());
    expect(e.arrival).toBe("2026-10-05");
    expect(e.departure).toBe("2026-10-08");
    expect(e.beforeArrival).toMatchObject({ night: "2026-10-04", verdict: "available", certainty: "verified" });
    expect(e.afterDeparture).toMatchObject({ night: "2026-10-08", verdict: "available", certainty: "verified" });
    expect(e.nextKnown).toBeNull();
    expect(e.overlap).toBeNull();
    const s = summarizeStayEdges(e);
    expect(s.footer).toBeNull();
    expect(s.lines.map((l) => l.text)).toEqual([
      "Erken giriş: 4 Eki gecesi bağlı takvimlerinizde boş.",
      "Geç çıkış / uzatma: 8 Eki gecesi bağlı takvimlerinizde boş.",
      "Çıkıştan sonraki 14 gecede kayıtlı rezervasyon yok.",
    ]);
  });

  it("misafirin KENDİ satırı kenar/örtüşme sayılmaz (kendisiyle çakışmaz)", () => {
    const e = edges(input());
    expect(e.overlap).toBeNull();
    // KONTROL: aynı satır başka kimlikle gelirse (ikinci kaynak) örtüşme OLARAK görünür.
    const dup = edges(input({ reservations: [ownRow(), res({ id: "dup", arrival: OWN.arrival, departure: OWN.departure })] }));
    expect(dup.overlap).toEqual({ firstNight: "2026-10-05", nights: 3 });
  });

  it("önceki misafir giriş günü çıkıyor → erken giriş gecesi DOLU (doğrulanmış)", () => {
    const e = edges(input({ reservations: [ownRow(), res({ arrival: midnight("2026-10-02"), departure: midnight("2026-10-05") })] }));
    expect(e.beforeArrival).toMatchObject({ verdict: "unavailable", certainty: "verified", blockedBy: "booked" });
    expect(summarizeStayEdges(e).lines[0]).toEqual({ tone: "warn", text: "Erken giriş: 4 Eki gecesi dolu." });
  });

  it("🚨 tek tarih kuralı: önceki çıkış iCal öğlen çapası, bu giriş gece yarısı çapası → yine aynı gün devir", () => {
    const e = edges(input({ reservations: [ownRow(), res({ arrival: noon("2026-10-02"), departure: noon("2026-10-05") })] }));
    expect(e.beforeArrival.verdict).toBe("unavailable");
  });

  it("sonraki misafir çıkış günü giriyor → geç çıkış/uzatma DOLU ve 'çıkış günü başlıyor'", () => {
    const e = edges(input({ reservations: [ownRow(), res({ arrival: midnight("2026-10-08"), departure: midnight("2026-10-10") })] }));
    expect(e.afterDeparture).toMatchObject({ verdict: "unavailable", blockedBy: "booked" });
    expect(e.nextKnown).toMatchObject({ night: "2026-10-08", gapNights: 0, kind: "booked", basis: "host_asserted" });
    expect(summarizeStayEdges(e).lines.map((l) => l.text)).toContain("Sonraki kayıtlı rezervasyon çıkış günü başlıyor.");
  });

  it("sonraki rezervasyon 12 Eki → arada 4 gece", () => {
    const e = edges(input({ reservations: [ownRow(), res({ arrival: midnight("2026-10-12"), departure: midnight("2026-10-14") })] }));
    expect(e.nextKnown).toMatchObject({ night: "2026-10-12", gapNights: 4 });
    expect(summarizeStayEdges(e).lines.at(-1)?.text).toBe("Sonraki kayıtlı rezervasyon: 12 Eki — arada 4 gece.");
  });

  it("onay bekleyen talep 'dolu' değil 'onay bekleyen talep' diye söylenir", () => {
    const e = edges(input({ reservations: [ownRow(), res({ status: "pending", arrival: midnight("2026-10-08"), departure: midnight("2026-10-09") })] }));
    expect(e.afterDeparture).toMatchObject({ verdict: "unavailable", blockedBy: "held" });
    expect(e.nextKnown?.kind).toBe("held");
    const texts = summarizeStayEdges(e).lines.map((l) => l.text);
    expect(texts).toContain("Geç çıkış / uzatma: 8 Eki gecesi onay bekleyen bir talep var.");
    expect(texts).toContain("Sonraki kayıtlı rezervasyon çıkış günü başlıyor (onay bekleyen talep).");
  });

  it("iptal edilmiş satır hiçbir kenarı doldurmaz", () => {
    const e = edges(input({ reservations: [ownRow(), res({ status: "cancelled", arrival: midnight("2026-10-08"), departure: midnight("2026-10-10") })] }));
    expect(e.afterDeparture.verdict).toBe("available");
    expect(e.nextKnown).toBeNull();
  });

  it("konaklamanın kendi gecelerinde başka rezervasyon → örtüşme satırı (en üstte, uyarı)", () => {
    const e = edges(input({ reservations: [ownRow(), res({ arrival: midnight("2026-10-06"), departure: midnight("2026-10-07") })] }));
    expect(e.overlap).toEqual({ firstNight: "2026-10-06", nights: 1 });
    expect(summarizeStayEdges(e).lines[0]).toEqual({ tone: "warn", text: "Bu konaklamanın 6 Eki gecesinde başka bir rezervasyon da var." });
    const two = edges(input({ reservations: [ownRow(), res({ arrival: midnight("2026-10-05"), departure: midnight("2026-10-07") })] }));
    expect(summarizeStayEdges(two).lines[0].text).toBe("Bu konaklamanın 2 gecesinde başka bir rezervasyon da var (ilki 5 Eki).");
  });

  it("sıfır / ters konaklama → null (dürüst söylenecek bir şey yok)", () => {
    expect(describeStayEdges(input(), { id: "own", arrival: midnight("2026-10-05"), departure: midnight("2026-10-05") })).toBeNull();
    expect(describeStayEdges(input(), { id: "own", arrival: midnight("2026-10-08"), departure: midnight("2026-10-05") })).toBeNull();
  });

  it("içerideki misafir (giriş geçmişte): erken giriş SORULAMAZ → satır yok; çıkış gecesi yine değerlendirilir", () => {
    const stay = { id: "own", arrival: midnight("2026-09-28"), departure: midnight("2026-10-03") };
    const e = edges(input({ reservations: [res({ id: "own", arrival: stay.arrival, departure: stay.departure })] }), stay);
    expect(e.beforeArrival.verdict).toBe("not_applicable");
    expect(e.afterDeparture).toMatchObject({ night: "2026-10-03", verdict: "available" });
    expect(summarizeStayEdges(e).lines.some((l) => l.text.startsWith("Erken giriş"))).toBe(false);
  });
});

describe("kapalı başarısız — kanıt yoksa 'boş' DENMEZ", () => {
  it("bağlı takvim yok → 'kayıtlı rezervasyon yok' + TEK dipnot (neden + ne yapmalı)", () => {
    const e = edges(input({ sources: [] }));
    expect(e.beforeArrival).toMatchObject({ verdict: "unknown", certainty: "unverified" });
    const s = summarizeStayEdges(e);
    expect(s.lines.map((l) => l.text)).toEqual([
      "Erken giriş: 4 Eki gecesi kayıtlı rezervasyon yok.",
      "Geç çıkış / uzatma: 8 Eki gecesi kayıtlı rezervasyon yok.",
      "Çıkıştan sonraki 14 gecede kayıtlı rezervasyon yok.",
    ]);
    expect(s.footer).toBe("Bu daireye bağlı bir takvim yok. Misafire söz vermeden önce kanal takviminden kontrol edin.");
  });

  it("köprü tazeliği kaydedilmemiş (kurucunun bugünkü kurulumu) → dürüst 'bilmiyoruz'", () => {
    const bridge: CoverageSource = { id: "link", kind: "channel_link", label: "Kanal", lastStatus: null, lastSuccessAt: null };
    const s = summarizeStayEdges(edges(input({ sources: [bridge] })));
    expect(s.footer).toBe("Rezervasyonların en son ne zaman güncellendiğini bilmiyoruz. Misafire söz vermeden önce kanal takviminden kontrol edin.");
  });

  it("yalnız kanıtsız iddia (bayat köprü satırı) → 'dolu' ama 'kayıt güncel olmayabilir' + dipnot", () => {
    const e = edges(input({ reservations: [ownRow(), res({ origin: "channel_unattributed", arrival: midnight("2026-10-08"), departure: midnight("2026-10-09") })] }));
    expect(e.afterDeparture).toMatchObject({ verdict: "unavailable", certainty: "unverified" });
    const s = summarizeStayEdges(e);
    expect(s.lines).toContainEqual({ tone: "warn", text: "Geç çıkış / uzatma: 8 Eki gecesi dolu (kayıt güncel olmayabilir)." });
    expect(s.footer).toBe("Kayıtların güncel olduğundan emin değiliz. Misafire söz vermeden önce kanal takviminden kontrol edin.");
  });

  it("girdi başka bir aralık için yüklenmişse kenar 'boş' OLAMAZ (outside_loaded_range)", () => {
    const e = edges(input({ loadedRange: { from: "2026-10-05", to: "2026-10-08" } }));
    expect(e.beforeArrival.verdict).toBe("unknown");
    expect(e.beforeArrival.reasons).toContain("outside_loaded_range");
    expect(e.afterDeparture.verdict).toBe("unknown");
  });

  it("🚨 metin hiçbir durumda söz vermez: 'müsait', 'kiralanabilir', 'uzatabilirsiniz' YOK", () => {
    const variants = [
      input(),
      input({ sources: [] }),
      input({ reservations: [ownRow(), res({ arrival: midnight("2026-10-08"), departure: midnight("2026-10-10") })] }),
      input({ reservations: [ownRow(), res({ status: "pending", arrival: midnight("2026-10-02"), departure: midnight("2026-10-05") })] }),
    ];
    for (const v of variants) {
      const s = summarizeStayEdges(edges(v));
      const all = [...s.lines.map((l) => l.text), s.footer ?? ""].join(" ").toLocaleLowerCase("tr");
      expect(all).not.toMatch(/müsait|kiralanabilir|uzatabilirsiniz|kalabilirsiniz|girebilirsiniz/);
    }
  });
});

describe("biçim + mimari", () => {
  it("gece etiketi Türkçe kısa ay", () => {
    expect(formatNightTr("2026-10-04")).toBe("4 Eki");
    expect(formatNightTr("2027-01-31")).toBe("31 Oca");
  });

  it("modül SAF: yalnız motor çekirdeğini içe aktarır (DB / sağlayıcı / server-only yok)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/modules/availability/stay-edges.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports).toEqual(["./core"]);
  });
});
