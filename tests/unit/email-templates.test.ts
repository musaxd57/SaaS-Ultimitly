import { describe, it, expect } from "vitest";
import { complaintEscalationEmail, reservationCreatedEmail, taskAssignedEmail } from "@/lib/email-templates";

describe("email templates escape guest/user-controlled HTML", () => {
  const xss = `<img src=x onerror="alert(1)">`;

  it("escapes a malicious guest message + identifier in the complaint email", () => {
    const html = complaintEscalationEmail(
      { id: "c1", guestIdentifier: xss, channel: "airbnb", priority: "urgent" },
      `Çok kötü! ${xss}`,
      { name: "Nuve 2", address: null, city: "İstanbul" },
      "Nuve",
    );
    // The raw, dangerous markup must NOT appear; the escaped form must.
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes a malicious guest name + notes in the reservation email", () => {
    const html = reservationCreatedEmail(
      {
        id: "r1",
        guestName: xss,
        arrivalDate: new Date(),
        departureDate: new Date(Date.now() + 86_400_000),
        channel: "airbnb",
        status: "confirmed",
        notes: xss,
      },
      { name: "Nuve 2" },
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes a malicious task title/description", () => {
    const html = taskAssignedEmail(
      { id: "t1", title: xss, type: "cleaning", priority: "urgent", status: "todo", description: xss },
      { name: xss, email: "x@y.z" },
      { name: "Nuve 2" },
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
