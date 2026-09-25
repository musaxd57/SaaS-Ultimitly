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
    // İnceleme 09-25 (test boşluğu): İstanbul'da 12:00Z iki kuralda da aynı güne düşer → ayırt etmez. Auckland'da (UTC+12)
    // 12:00Z yerel ERTESİ gün 00:00'dır: öğle çapası YALNIZ TARİH (23'ü) kalmalı, anlık değer yerel güne (24'ü) dönmeli.
    const AKL = "Pacific/Auckland";
    const nowAkl = new Date("2026-09-23T20:00:00.000Z"); // Auckland 24.09 08:00
    const anchored = stayTimeline({ now: nowAkl, timeZone: AKL, reservation: noon });
    expect(anchored.arrival).toBe("2026-09-23");
    expect(anchored.stage).toBe("in_stay");
    const instantAkl = { status: "confirmed", arrivalDate: new Date("2026-09-23T13:00:00.000Z"), departureDate: new Date("2026-09-27T13:00:00.000Z") };
    const shifted = stayTimeline({ now: nowAkl, timeZone: AKL, reservation: instantAkl });
    expect(shifted.arrival).toBe("2026-09-24");
    expect(shifted.stage).toBe("arrival_today");
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
    // Geçişin iki yanı (02:00 EDT → 01:00 EST, 06:00Z): aynı yerel gün, iki farklı saat farkı.
    for (const [iso, hhmm] of [["2026-11-01T05:30:00.000Z", "01:30"], ["2026-11-01T06:30:00.000Z", "01:30"]] as const) {
      const x = stayTimeline({ now: new Date(iso), timeZone: "America/New_York", reservation: r });
      expect(x.today, iso).toBe("2026-11-01");
      expect(x.hhmm, iso).toBe(hhmm);
      expect(x.daysToDeparture, iso).toBe(2);
    }
  });

  it("🚨 geçersiz tarih istemi ÇÖKERTMEZ → rezervasyon yokmuş gibi (inceleme 09-25)", () => {
    const bad = { status: "confirmed", arrivalDate: "yarın", departureDate: new Date("2026-09-27T00:00:00.000Z") };
    const t = stayTimeline({ now: new Date("2026-09-24T09:00:00.000Z"), timeZone: IST, reservation: bad });
    expect(t.stage).toBe("no_reservation");
    expect(timelineLine(t, STD)).toBe("(rezervasyon yok)");
  });

  it("🚨 iptal edilmiş rezervasyon: tarihler geçerli konaklama olarak sunulmaz — 'şu an konaklamakta' / 'tamamlandı' YOK", () => {
    const r = res("2026-09-23", "2026-09-27", "cancelled");
    for (const day of ["2026-09-24", "2026-09-28"]) {
      const t = stayTimeline({ now: new Date(`${day}T09:00:00.000Z`), timeZone: IST, reservation: r });
      expect(t.cancelled).toBe(true);
      const line = timelineLine(t, STD);
      expect(line).toBe("Rezervasyon İPTAL edilmiş — bu tarihler geçerli bir konaklama değildir (planlanan giriş 23.09.2026 Çarşamba, çıkış 27.09.2026 Pazar).");
    }
  });

  it("🚨 onaylanmamış (beklemede / tanınmayan) rezervasyon: plan olarak yazılır, 'konaklamakta' DENMEZ; tamamlanmış onaylı gibi", () => {
    for (const status of ["pending", "inquiry"]) {
      const t = stayTimeline({ now: new Date("2026-09-24T09:00:00.000Z"), timeZone: IST, reservation: res("2026-09-23", "2026-09-27", status) });
      expect(t.unconfirmed, status).toBe(true);
      const line = timelineLine(t, STD);
      expect(line, status).toMatch(/^Rezervasyon henüz ONAYLANMADI: planlanan giriş 23\.09\.2026 Çarşamba, çıkış 27\.09\.2026 Pazar\./);
      expect(line, status).not.toContain("konaklamakta");
    }
    const done = stayTimeline({ now: new Date("2026-09-28T09:00:00.000Z"), timeZone: IST, reservation: res("2026-09-23", "2026-09-27", "completed") });
    expect(done.unconfirmed).toBe(false);
    expect(timelineLine(done, STD)).toBe("Konaklama tamamlandı (çıkış tarihi 27.09.2026 Pazar geçti).");
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

  it("gece yarısından sonra (00:00–04:59) 'yarın' uyarısı; gündüz yok", () => {
    const night = stayTimeline({ now: new Date("2026-09-25T21:30:00.000Z"), timeZone: IST, reservation: null }); // 26.09 00:30
    expect(clockLine(night)).toContain('Gece yarısı yeni geçti: misafirin "yarın" demesi çoğu zaman BUGÜNÜ (26.09.2026 Cumartesi) kasteder');
    const at5 = stayTimeline({ now: new Date("2026-09-26T02:00:00.000Z"), timeZone: IST, reservation: null }); // 05:00
    expect(clockLine(at5)).not.toContain("Gece yarısı");
  });

  it("bugünün standart saati GEÇTİYSE söylenir (çıkış/giriş günü); çelişen saat (null) hiç yazılmaz", () => {
    const r = res("2026-09-23", "2026-09-27");
    const line = (iso: string, std: { checkInTime: string | null; checkOutTime: string | null } = STD) =>
      timelineLine(stayTimeline({ now: new Date(iso), timeZone: IST, reservation: r }), std);
    expect(line("2026-09-27T10:00:00.000Z")).toBe("Çıkış günü BUGÜN: 27.09.2026 Pazar (standart çıkış saati 11:00 — bugün bu saat GEÇTİ).");
    expect(line("2026-09-27T07:59:00.000Z")).toBe("Çıkış günü BUGÜN: 27.09.2026 Pazar (standart çıkış saati 11:00)."); // 10:59
    expect(line("2026-09-23T13:00:00.000Z")).toBe("Giriş BUGÜN: 23.09.2026 Çarşamba (standart giriş saati 15:00 — bugün bu saat GEÇTİ).");
    // Yarınki saat için "geçti" denmez.
    expect(line("2026-09-26T20:00:00.000Z")).toBe("Misafir şu an konaklamakta. Çıkış YARIN: 27.09.2026 Pazar (standart çıkış saati 11:00).");
    // Bilgi tabanıyla çelişen saat (P4-b): satır saati tekrar etmez.
    expect(line("2026-09-27T07:00:00.000Z", { checkInTime: "15:00", checkOutTime: null })).toBe("Çıkış günü BUGÜN: 27.09.2026 Pazar.");
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
