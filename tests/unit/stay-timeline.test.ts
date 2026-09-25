import { describe, it, expect } from "vitest";
import { clockLine, formatDayTr, stayTimeline, timelineLine } from "@/lib/ai/stay-timeline";

// ---------------------------------------------------------------------------
// ZAMAN VE KONAKLAMA EVRESİ (Konuşma Anlama Durumu v1, dilim A — 09-25). İstemin "Zaman bağlamı" satırı eskiden sunucu
// saatini ham tarih damgasıyla kıyaslıyordu (ajan + kod ölçtü): YALNIZ TARİH saklanan rezervasyonda İstanbul'da çıkış
// sabahı 03:00'ten itibaren "Konaklama tamamlandı (check-out gerçekleşti)", varıştan önceki akşam "Girişe 0 gün kaldı".
// Kural: günler `calendarDateOf` (tek tarih kuralı), "bugün" org diliminde, gün farkı TAKVİM günü.
// ---------------------------------------------------------------------------

const IST = "Europe/Istanbul"; // UTC+3, yaz saati yok
const STD = { checkInTime: "15:00", checkOutTime: "11:00" };
const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`);
const res = (arrival: string, departure: string, status = "confirmed") => ({
  status,
  arrivalDate: dateOnly(arrival),
  departureDate: dateOnly(departure),
});

describe("stayTimeline — takvim günü kuralı + org dilimi", () => {
  it("🚨 çıkış SABAHI (yerel 03:30, yalnız tarih kaydı): 'tamamlandı' DEĞİL, çıkış günü BUGÜN", () => {
    const now = new Date("2026-09-26T00:30:00.000Z"); // İstanbul 26.09 03:30
    const t = stayTimeline({ now, timeZone: IST, reservation: res("2026-09-23", "2026-09-26") });
    expect(t.today).toBe("2026-09-26");
    expect(t.stage).toBe("departure_today");
    const line = timelineLine(t, STD);
    expect(line).toContain("Çıkış günü BUGÜN");
    expect(line).not.toContain("tamamlandı");
  });

  it("🚨 varıştan önceki AKŞAM (yerel 21:00): 'girişe 0 gün' DEĞİL, giriş YARIN", () => {
    const now = new Date("2026-09-25T18:00:00.000Z"); // İstanbul 25.09 21:00
    const t = stayTimeline({ now, timeZone: IST, reservation: res("2026-09-26", "2026-09-29") });
    expect(t.stage).toBe("arrival_tomorrow");
    expect(t.daysToArrival).toBe(1);
    expect(timelineLine(t, STD)).toContain("Giriş YARIN: 26.09.2026 Cumartesi");
  });

  it("gece yarısını geçen UTC anı org diliminde yeni güne düşer (bugün/yarın anahtarı)", () => {
    const now = new Date("2026-09-25T21:30:00.000Z"); // İstanbul 26.09 00:30
    const t = stayTimeline({ now, timeZone: IST, reservation: null });
    expect(t.today).toBe("2026-09-26");
    expect(t.tomorrow).toBe("2026-09-27");
    expect(t.hhmm).toBe("00:30");
    expect(t.stage).toBe("no_reservation");
    expect(timelineLine(t, STD)).toBe("(rezervasyon yok)");
  });

  it("bütün evreler (tek konaklama, farklı günler)", () => {
    const r = res("2026-09-23", "2026-09-27");
    const at = (key: string) => stayTimeline({ now: new Date(`${key}T09:00:00.000Z`), timeZone: IST, reservation: r }).stage;
    expect(at("2026-09-20")).toBe("pre_arrival");
    expect(at("2026-09-22")).toBe("arrival_tomorrow");
    expect(at("2026-09-23")).toBe("arrival_today");
    expect(at("2026-09-24")).toBe("in_stay");
    expect(at("2026-09-25")).toBe("in_stay");
    expect(at("2026-09-26")).toBe("departure_tomorrow");
    expect(at("2026-09-27")).toBe("departure_today");
    expect(at("2026-09-28")).toBe("post_stay");
  });

  it("gün farkı takvim günüdür (saat yuvarlaması DEĞİL)", () => {
    const t = stayTimeline({ now: new Date("2026-09-20T20:59:00.000Z"), timeZone: IST, reservation: res("2026-09-23", "2026-09-27") });
    expect(t.daysToArrival).toBe(3); // İstanbul 20.09 23:59 → 23.09 = 3 gün
    expect(timelineLine(t, STD)).toBe("Giriş henüz yapılmadı: giriş 23.09.2026 Çarşamba (3 gün sonra).");
  });

  it("öğle çapası (12:00Z) ve anlık değer: anlık değer MÜLK diliminde güne çevrilir", () => {
    const noon = { status: "confirmed", arrivalDate: new Date("2026-09-23T12:00:00.000Z"), departureDate: new Date("2026-09-27T12:00:00.000Z") };
    expect(stayTimeline({ now: new Date("2026-09-23T06:00:00.000Z"), timeZone: IST, reservation: noon }).stage).toBe("arrival_today");
    // 26.09 21:30Z = İstanbul 27.09 00:30 → çıkış günü 27.09.
    const instant = { status: "confirmed", arrivalDate: new Date("2026-09-23T13:00:00.000Z"), departureDate: new Date("2026-09-26T21:30:00.000Z") };
    const t = stayTimeline({ now: new Date("2026-09-27T06:00:00.000Z"), timeZone: IST, reservation: instant });
    expect(t.departure).toBe("2026-09-27");
    expect(t.stage).toBe("departure_today");
  });

  it("yaz saati geçişi olan dilimde takvim günü kayması yok (America/New_York, 1 Kasım 2026)", () => {
    const r = res("2026-10-31", "2026-11-03");
    const t = stayTimeline({ now: new Date("2026-11-02T04:30:00.000Z"), timeZone: "America/New_York", reservation: r });
    expect(t.today).toBe("2026-11-01"); // NY 01.11 23:30 (EST)
    expect(t.stage).toBe("in_stay");
    expect(t.daysToDeparture).toBe(2);
  });

  it("iptal edilmiş rezervasyon: tarihler geçerli konaklama olarak sunulmaz", () => {
    const t = stayTimeline({ now: new Date("2026-09-24T09:00:00.000Z"), timeZone: IST, reservation: res("2026-09-23", "2026-09-27", "cancelled") });
    expect(t.cancelled).toBe(true);
    expect(timelineLine(t, STD)).toMatch(/^Rezervasyon İPTAL edilmiş/);
  });
});

describe("biçim — gün adı, saat satırı", () => {
  it("formatDayTr: tarih + Türkçe gün adı", () => {
    expect(formatDayTr("2026-09-25")).toBe("25.09.2026 Cuma");
    expect(formatDayTr("2026-09-27")).toBe("27.09.2026 Pazar");
    expect(formatDayTr("2026-01-01")).toBe("01.01.2026 Perşembe");
  });

  it("clockLine: bugün + yerel saat + dilim + yarın", () => {
    const t = stayTimeline({ now: new Date("2026-09-25T07:40:00.000Z"), timeZone: IST, reservation: null });
    expect(clockLine(t)).toBe("Bugün: 25.09.2026 Cuma, saat 10:40 (Europe/Istanbul) · Yarın: 26.09.2026 Cumartesi");
  });

  it("evre satırları standart saati içerir (giriş/çıkış günü)", () => {
    const r = res("2026-09-23", "2026-09-27");
    const line = (key: string) => timelineLine(stayTimeline({ now: new Date(`${key}T09:00:00.000Z`), timeZone: IST, reservation: r }), STD);
    expect(line("2026-09-23")).toBe("Giriş BUGÜN: 23.09.2026 Çarşamba (standart giriş saati 15:00).");
    expect(line("2026-09-26")).toBe("Misafir şu an konaklamakta. Çıkış YARIN: 27.09.2026 Pazar (standart çıkış saati 11:00).");
    expect(line("2026-09-24")).toBe("Misafir şu an konaklamakta. Çıkış 27.09.2026 Pazar (3 gün sonra).");
    expect(line("2026-09-28")).toBe("Konaklama tamamlandı (çıkış tarihi 27.09.2026 Pazar geçti).");
  });
});
