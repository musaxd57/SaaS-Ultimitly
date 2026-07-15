import { describe, it, expect } from "vitest";
import {
  displaySenderName,
  aiSourceLabel,
  intentLabel,
  langLabel,
  channelLabel,
  riskLabel,
  sourceLabel,
  displayableSources,
} from "@/lib/ui-labels";

// The stored senderName "GuestOps AI" is a DB-level classification marker that
// must NEVER change at the storage layer. displaySenderName maps it to the live
// brand for DISPLAY only; every other name passes through untouched.
describe("displaySenderName", () => {
  it("maps the legacy AI marker to the live brand", () => {
    expect(displaySenderName("GuestOps AI")).toBe("Lixus AI");
  });

  it("passes guest / host names through unchanged", () => {
    expect(displaySenderName("Ayşe Yılmaz")).toBe("Ayşe Yılmaz");
    expect(displaySenderName("Ev sahibi")).toBe("Ev sahibi");
    expect(displaySenderName("")).toBe("");
  });

  it("does not match case variants (only the exact marker is remapped)", () => {
    expect(displaySenderName("guestops ai")).toBe("guestops ai");
  });
});

describe("aiSourceLabel", () => {
  it("never surfaces the backend vendor name", () => {
    expect(aiSourceLabel("openai")).toBe("Lixus AI");
    expect(aiSourceLabel("fallback")).toBe("Hazır yanıt");
  });
});

describe("intentLabel", () => {
  it("returns Turkish labels and falls back to Genel", () => {
    expect(intentLabel("wifi")).toBe("Wi-Fi");
    expect(intentLabel("complaint")).toBe("Şikayet");
    expect(intentLabel("something_unknown")).toBe("Genel");
  });
});

describe("langLabel", () => {
  it("maps known codes and upper-cases unknown ones", () => {
    expect(langLabel("tr")).toBe("Türkçe");
    expect(langLabel("EN")).toBe("İngilizce");
    expect(langLabel("zz")).toBe("ZZ");
  });
});

describe("channelLabel", () => {
  it("renders friendly channel names", () => {
    expect(channelLabel("airbnb")).toBe("Airbnb");
    expect(channelLabel("booking")).toBe("Booking.com");
    expect(channelLabel("ics")).toBe("Takvim (iCal)");
  });
});

describe("riskLabel", () => {
  it("maps risk levels to Turkish", () => {
    expect(riskLabel("low")).toBe("Düşük risk");
    expect(riskLabel("high")).toBe("Yüksek risk");
    expect(riskLabel("none")).toBe("Risk yok");
  });
});

// Evidence chips ("Kullandığı bağlam") must read as Turkish labels, never as raw
// field tokens like "reservation:guestName" — that leak confused a real user.
describe("sourceLabel", () => {
  it("maps every whitelisted evidence source to a Turkish label", () => {
    expect(sourceLabel("kb:wifi")).toBe("Bilgi tabanı: Wi-Fi");
    expect(sourceLabel("property:checkInTime")).toBe("Giriş saati");
    expect(sourceLabel("property:name")).toBe("Daire adı");
    expect(sourceLabel("property:city")).toBe("Şehir");
    expect(sourceLabel("reservation:guestName")).toBe("Rezervasyon: Misafir adı");
    expect(sourceLabel("reservation:arrivalDate")).toBe("Rezervasyon: Giriş tarihi");
    expect(sourceLabel("reservation:departureDate")).toBe("Rezervasyon: Çıkış tarihi");
    expect(sourceLabel("reservation:status")).toBe("Rezervasyon: Rezervasyon durumu");
    expect(sourceLabel("history")).toBe("Önceki yazışma");
  });
});

describe("displayableSources", () => {
  it("drops only the guest-name evidence from display (kept in data for audit)", () => {
    expect(displayableSources(["kb:wifi", "reservation:guestName", "reservation:status"])).toEqual([
      "kb:wifi",
      "reservation:status",
    ]);
  });

  it("returns empty when guest-name was the only evidence (chip row hides entirely)", () => {
    expect(displayableSources(["reservation:guestName"])).toEqual([]);
  });
});
