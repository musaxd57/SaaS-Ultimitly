import { describe, it, expect } from "vitest";
import { turnoverBandLines } from "@/lib/turnover-band";

// ---------------------------------------------------------------------------
// Tur 5 (11-05, ölçüldü, çürütücüyle yeniden üretildi): konuşma kartındaki "Devir günü" bandı giriş tarafını konaklama başladıktan
// sonra da gösteriyor, iki uç da devirse yalnız giriş satırını basıyordu → asıl yapılacak iş ("çıkış günü yeni misafir giriyor")
// konaklama boyunca görünmüyordu. Kullanıcı kararı: bant yalnız HÂLÂ YAPILACAK İŞ için. Metinler aynen.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const base = {
  stayIsOver: false,
  // Hospitable tarih-yalnız çapa (D 00:00Z): 1 Kasım girişi.
  arrivalDate: new Date("2026-11-01T00:00:00Z"),
  previousSameDay: true,
  nextSameDay: true,
  timeZone: TZ,
  checkInTime: "15:00",
  checkOutTime: "11:00",
  previousLateCheckout: null,
  nextEarlyCheckin: null,
};
const IN = "Devir günü: giriş günü önceki misafir çıkıyor (standart çıkış 11:00).";
const OUT = "Devir günü: çıkış günü yeni misafir giriyor (standart giriş 15:00).";

describe("Devir günü bandı — yalnız hâlâ yapılacak iş", () => {
  it("🚨 konaklamanın ortasında (5 Kasım) iki uç da devir → yalnız ÇIKIŞ satırı (giriş günü geçti)", () => {
    expect(turnoverBandLines({ ...base, now: new Date("2026-11-05T09:00:00Z") })).toEqual([OUT]);
  });

  it("🚨 giriş GÜNÜ (1 Kasım öğlen, İstanbul) iki uç da devir → İKİ satır (önce giriş)", () => {
    expect(turnoverBandLines({ ...base, now: new Date("2026-11-01T09:00:00Z") })).toEqual([IN, OUT]);
  });

  it("girişten önce yalnız giriş devri → yalnız giriş satırı; onaylı geç çıkış saati yazılır", () => {
    expect(
      turnoverBandLines({ ...base, nextSameDay: false, previousLateCheckout: "13:00", now: new Date("2026-10-30T09:00:00Z") }),
    ).toEqual(["Devir günü: giriş günü önceki misafir çıkıyor (onaylı geç çıkış: 13:00)."]);
  });

  it("KONTROL: konaklama bitti → bant yok", () => {
    expect(turnoverBandLines({ ...base, stayIsOver: true, now: new Date("2026-11-09T09:00:00Z") })).toEqual([]);
  });

  it("KONTROL: hiç devir yok → bant yok", () => {
    expect(turnoverBandLines({ ...base, previousSameDay: false, nextSameDay: false, now: new Date("2026-11-01T09:00:00Z") })).toEqual([]);
  });
});
