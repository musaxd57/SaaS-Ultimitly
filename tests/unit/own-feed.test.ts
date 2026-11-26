import { describe, it, expect } from "vitest";
import { isOwnExportFeedUrl, isOwnExportUid, OWN_EXPORT_UID_SUFFIX } from "@/lib/export/own-feed";
import { buildIcalEvents } from "@/lib/export/ics";

// Tur 7 CAL-1 (kurucu onayı 11-05): Lixus'un kendi takvim bağlantısı içe aktarma kaynağı olamaz. Kontrol METİNDE "lixus" aramaz;
// ayrıştırılmış adresin gerçek alan adı + dışa aktarım yolu (Codex).
describe("Lixus'un kendi takvim beslemesi", () => {
  it("🚨 bütün Lixus dağıtımlarının dışa aktarım yolu (www'lu / www'suz, sonda eğik çizgi) kendi beslememizdir", () => {
    for (const u of [
      "https://www.lixusai.com/api/calendar/abc123",
      "https://lixusai.com/api/calendar/abc123/",
      "https://WWW.LIXUSAI.COM/api/calendar/abc123?x=1",
      "https://www.lixusai.eu/api/calendar/abc123",
    ]) {
      expect(isOwnExportFeedUrl(u), u).toBe(true);
    }
  });

  it("KONTROL: adında 'lixus' geçen başka alan adı, alt alan hilesi, iç uç ve başka yol kendi beslememiz DEĞİL", () => {
    for (const u of [
      "https://lixus-ev.com/api/calendar/abc123",
      "https://www.lixusai.com.evil.example/api/calendar/abc123",
      "https://evil.example/?u=https://www.lixusai.com/api/calendar/abc123",
      "https://www.lixusai.com/api/calendar/sync",
      "https://www.lixusai.com/calendar/abc123",
      "https://www.airbnb.com/calendar/ical/123.ics?s=abc",
      "bozuk adres",
    ]) {
      expect(isOwnExportFeedUrl(u), u).toBe(false);
    }
  });

  it("dışa aktarılan etkinliğin kimliği kendi kimliğimiz olarak tanınır; başka kimlik tanınmaz", () => {
    const [ev] = buildIcalEvents(
      [{ id: "res1", guestName: null, arrivalDate: new Date("2026-11-10T00:00:00Z"), departureDate: new Date("2026-11-12T00:00:00Z"), channel: null, sourceReference: null } as never],
      false,
      "Europe/Istanbul",
    );
    expect(ev.uid).toBe(`res1${OWN_EXPORT_UID_SUFFIX}`);
    expect(isOwnExportUid(ev.uid)).toBe(true);
    expect(isOwnExportUid("abc@airbnb.com")).toBe(false);
    expect(isOwnExportUid(null)).toBe(false);
  });
});
