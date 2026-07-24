import { describe, it, expect } from "vitest";
import { buildIcalEvents } from "@/lib/export/ics";

// The public iCal feed is subscribed to by third parties (Airbnb / Booking /
// Google), so the guest's name must NOT leak in it unless the host opts in.
const reservations = [
  {
    id: "r1",
    guestName: "Ada Lovelace",
    arrivalDate: new Date("2026-07-01T00:00:00Z"),
    departureDate: new Date("2026-07-03T00:00:00Z"),
    channel: "airbnb",
    sourceReference: "ABC123",
  },
];

describe("iCal feed guest-name privacy", () => {
  it("ships ONLY busy dates by default — no name, channel, or reference (KVKK)", () => {
    const [e] = buildIcalEvents(reservations, false);
    expect(e.summary).toBe("Rezervasyon");
    expect(e.summary).not.toContain("Ada");
    // Privacy mode = pure busy/free: description carries nothing identifying.
    expect(e.description).toBe("");
    expect(e.description).not.toContain("Ada Lovelace");
    expect(e.description).not.toContain("Kanal");
    expect(e.description).not.toContain("Referans"); // booking code is semi-identifying
  });

  it("includes name + channel + reference only when the host opts in", () => {
    const [e] = buildIcalEvents(reservations, true);
    expect(e.summary).toBe("Rezervasyon — Ada Lovelace");
    expect(e.description).toContain("Misafir: Ada Lovelace");
    expect(e.description).toContain("Kanal: airbnb");
    expect(e.description).toContain("Referans: ABC123");
  });
});
