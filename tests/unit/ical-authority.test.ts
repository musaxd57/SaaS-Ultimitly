import { describe, it, expect } from "vitest";
import { DIRECT_CONNECTION_CHANNEL, icalChannelOfUrl, icalWriteAuthority, standbySummary } from "@/lib/channels/ical-authority";
import { hasEmergencyCallDirective } from "@/lib/ai/hazard-evidence";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 6 — doğrudan kanal ↔ iCal sahipliğinin SAF parçaları (kurucu gereksinimi 09-08; kurucu 10-11: yalnız doğrudan kanal).
// ---------------------------------------------------------------------------

describe("icalChannelOfUrl — kanal yalnız alan adından, kesin", () => {
  it.each([
    ["https://www.airbnb.com/calendar/ical/123.ics?s=abc", "airbnb"],
    ["https://www.airbnb.com.tr/calendar/ical/123.ics", "airbnb"],
    ["https://www.airbnb.co.uk/calendar/ical/123.ics", "airbnb"],
    ["https://airbnb.de/calendar/ical/1.ics", "airbnb"],
    ["https://www.abritel.fr/icalendar/abc.ics", "vrbo"],
    ["https://www.fewo-direkt.de/icalendar/abc.ics", "vrbo"],
    ["https://www.homeaway.co.uk/icalendar/abc.ics", "vrbo"],
    ["https://admin.booking.com/hotel/hoteladmin/ical.html?t=x", "booking"],
    ["https://ical.booking.com/v1/export?t=x", "booking"],
    ["https://www.vrbo.com/icalendar/abc.ics", "vrbo"],
    ["https://www.homeaway.com/icalendar/abc.ics", "vrbo"],
    ["HTTPS://WWW.AIRBNB.COM./calendar/ical/1.ics", "airbnb"],
  ])("%s → %s", (url, channel) => expect(icalChannelOfUrl(url)).toBe(channel));

  it.each([
    "https://airbnb.com.evil.example/cal.ics",
    "https://notairbnb.com/cal.ics",
    "https://evil-airbnb.com/cal.ics",
    // Haiku 10-11: Airbnb'nin olmayan TLD'leri ve iCal dışı yol.
    "https://airbnb.xyz/calendar/ical/1.ics",
    "https://ical.airbnb.net/calendar/ical/1.ics",
    "https://www.airbnb.com/rooms/123",
    "https://airbnb.evil.com/cal.ics",
    "https://booking.com.evil.example/x",
    "https://mybooking.com/x",
    "https://calendar.google.com/calendar/ical/x/basic.ics",
    "https://example.com/airbnb.ics",
    "not a url",
    "",
  ])("🚨 tanınmayan / taklit adres → null (yetkili kalır, tahmin yok): %s", (url) => expect(icalChannelOfUrl(url)).toBeNull());
});

describe("icalWriteAuthority", () => {
  it("aynı kanalın doğrudan bağlantısı varsa YEDEK; öteki kanallar ve bilinmeyen kanal YETKİLİ", () => {
    expect(icalWriteAuthority("airbnb", ["airbnb"])).toBe("standby");
    expect(icalWriteAuthority("booking", ["airbnb"])).toBe("active");
    expect(icalWriteAuthority("vrbo", ["airbnb", "booking"])).toBe("active");
    expect(icalWriteAuthority(null, ["airbnb", "booking", "vrbo"])).toBe("active");
    expect(icalWriteAuthority("airbnb", [])).toBe("active");
  });
});

describe("doğrudan bağlantı sağlayıcıları", () => {
  it("🚨 Hospitable köprüsü doğrudan bağlantı DEĞİLDİR (kurucu 10-11: 'yalnız Airbnb Direct gelince')", () => {
    expect(Object.keys(DIRECT_CONNECTION_CHANNEL)).not.toContain("hospitable");
    expect(DIRECT_CONNECTION_CHANNEL).toEqual({ airbnb_direct: "airbnb", booking_direct: "booking", vrbo_direct: "vrbo" });
  });
  it("yedek özeti sade ve kanal adını söyler", () => {
    expect(standbySummary("airbnb")).toContain("Airbnb doğrudan bağlantısından");
    expect(standbySummary("booking")).toContain("Booking.com");
    expect(hasEmergencyCallDirective(standbySummary("vrbo"))).toBe(false);
  });
});
