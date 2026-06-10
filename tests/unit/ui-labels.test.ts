import { describe, it, expect } from "vitest";
import {
  displaySenderName,
  aiSourceLabel,
  intentLabel,
  langLabel,
  channelLabel,
  riskLabel,
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
