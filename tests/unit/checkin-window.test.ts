import { describe, it, expect } from "vitest";
import { checkinLatestArrivalDay, checkinWindowOpensAt } from "@/lib/checkin-window";
import { CHECKIN_LEAD_DAYS, CHECKIN_SEND_HOUR } from "@/lib/lifecycle-window";

// GM-1 (kurucu 11-26: "gece 3'de gitmesin, 4 gün önceden alınmışsa saat tam 10'da gitmiş olsun"). Saf kural; saat sabit.
const IST = "Europe/Istanbul"; // +03:00, DST yok
const NY = "America/New_York"; // Aralık'ta −05:00
const utc = (s: string) => new Date(s);

describe("giriş bilgisi penceresi — saf kural", () => {
  it("sabitler: 4 gün önce, saat 10", () => {
    expect([CHECKIN_LEAD_DAYS, CHECKIN_SEND_HOUR]).toEqual([4, 10]);
  });

  it("🚨 gece yarısı saklanan varış (1 Aralık 00:00Z): pencere 27 Kasım İstanbul 10:00'da açılır (03:00'te DEĞİL)", () => {
    expect(checkinWindowOpensAt(utc("2026-12-01T00:00:00.000Z"), IST).toISOString()).toBe("2026-11-27T07:00:00.000Z");
  });

  it("öğlen saklanan varış ve gerçek an da AYNI günün 10:00'ı (varış saatinden bağımsız)", () => {
    expect(checkinWindowOpensAt(utc("2026-12-01T12:00:00.000Z"), IST).toISOString()).toBe("2026-11-27T07:00:00.000Z");
    // 1 Aralık 15:00 İstanbul = 12:00:00.001Z değil gerçek an: 12:30Z → yerel gün 1 Aralık
    expect(checkinWindowOpensAt(utc("2026-12-01T12:30:00.000Z"), IST).toISOString()).toBe("2026-11-27T07:00:00.000Z");
    // 1 Aralık 01:00 İstanbul = 30 Kasım 22:00Z → yerel gün YİNE 1 Aralık
    expect(checkinWindowOpensAt(utc("2026-11-30T22:00:00.000Z"), IST).toISOString()).toBe("2026-11-27T07:00:00.000Z");
  });

  it("New York: 27 Kasım yerel 10:00 = 15:00Z", () => {
    expect(checkinWindowOpensAt(utc("2026-12-01T00:00:00.000Z"), NY).toISOString()).toBe("2026-11-27T15:00:00.000Z");
  });

  it("🚨 saat 10:00'dan ÖNCE en geç varış günü bugün + 3; 10:00'da bugün + 4 (sınır dakikası dahil)", () => {
    expect(checkinLatestArrivalDay(utc("2026-11-27T00:05:00.000Z"), IST)).toBe("2026-11-30"); // 03:05 yerel
    expect(checkinLatestArrivalDay(utc("2026-11-27T06:59:59.999Z"), IST)).toBe("2026-11-30"); // 09:59:59 yerel
    expect(checkinLatestArrivalDay(utc("2026-11-27T07:00:00.000Z"), IST)).toBe("2026-12-01"); // 10:00:00 yerel
    expect(checkinLatestArrivalDay(utc("2026-11-27T20:59:00.000Z"), IST)).toBe("2026-12-01"); // 23:59 yerel
    expect(checkinLatestArrivalDay(utc("2026-11-27T21:00:00.000Z"), IST)).toBe("2026-12-01"); // 28 Kasım 00:00 yerel → bugün+3 yine 1 Aralık
  });

  it("iki işlev aynı kuralı söyler: pencere açılmışsa varış günü 'en geç gün'ü aşmaz (bir hafta, saat saat)", () => {
    const arrival = utc("2026-12-01T00:00:00.000Z");
    const opens = checkinWindowOpensAt(arrival, IST).getTime();
    for (let t = Date.parse("2026-11-24T00:00:00Z"); t < Date.parse("2026-12-01T00:00:00Z"); t += 20 * 60_000) {
      const open = t >= opens;
      expect(checkinLatestArrivalDay(new Date(t), IST) >= "2026-12-01", new Date(t).toISOString()).toBe(open);
    }
  });
});
