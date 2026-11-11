import { describe, it, expect } from "vitest";
import { complaintEscalationEmail, reservationCreatedEmail, taskAssignedEmail, taskDueEmailLabel } from "@/lib/email-templates";

describe("email templates escape guest/user-controlled HTML", () => {
  const xss = `<img src=x onerror="alert(1)">`;

  it("escapes a malicious guest message + identifier in the complaint email", () => {
    const html = complaintEscalationEmail(
      { id: "c1", guestIdentifier: xss, channel: "airbnb", priority: "urgent" },
      `Çok kötü! ${xss}`,
      { name: "Lale 2", address: null, city: "İstanbul" },
      "Lale",
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
      { name: "Lale 2" },
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes a malicious task title/description", () => {
    const html = taskAssignedEmail(
      { id: "t1", title: xss, type: "cleaning", priority: "urgent", status: "todo", description: xss },
      { name: xss, email: "x@y.z" },
      { name: "Lale 2" },
      "Europe/Istanbul",
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("görev atama e-postası — vade İŞLETMENİN saat diliminde (Codex 11-10 X5)", () => {
  const task = (dueAt: Date | null) => ({ id: "t1", title: "Temizlik", type: "cleaning", priority: "standard", status: "todo", dueAt });
  const who = { name: "Ayşe", email: "a@b.c" };
  const prop = { name: "Lale 2" };

  it("🚨 İstanbul'da 15:00 olan vade e-postada 15:00 yazılır — sunucunun dilimi (UTC) 12:00 yazdırmaz", () => {
    const html = taskAssignedEmail(task(new Date("2026-11-07T12:00:30.000Z")), who, prop, "Europe/Istanbul");
    expect(html).toContain("7 Kasım 2026 15:00"); // ⬅️ ESKİDE "7 Kasım 2026 12:00"
    expect(html).not.toContain("12:00");
  });

  it("dilim işletmeye göre değişir: aynı an New York'ta 07:00, Tokyo'da 21:00", () => {
    const due = new Date("2026-11-07T12:00:30.000Z");
    expect(taskDueEmailLabel(due, "America/New_York")).toBe("7 Kasım 2026 07:00");
    expect(taskDueEmailLabel(due, "Asia/Tokyo")).toBe("7 Kasım 2026 21:00");
  });

  it("gün sınırı: UTC 22:30 İstanbul'da ERTESİ gün 01:30'dur — gün de dilime göre yazılır", () => {
    expect(taskDueEmailLabel(new Date("2026-11-07T22:30:00.000Z"), "Europe/Istanbul")).toBe("8 Kasım 2026 01:30");
  });

  it("🚨 yalnız-tarih vadesi (gün çapası) SAAT UYDURMAZ: yalnız gün yazılır", () => {
    // Takvimden / dosyadan gelen vade öğle çapasıyla, elle girilen gün gece yarısı çapasıyla saklanır — ikisi de "o gün" demektir.
    expect(taskDueEmailLabel(new Date("2026-11-07T12:00:00.000Z"), "Europe/Istanbul")).toBe("7 Kasım 2026"); // ⬅️ ESKİDE "7 Kasım 2026 12:00"
    expect(taskDueEmailLabel(new Date("2026-11-07T00:00:00.000Z"), "America/New_York")).toBe("7 Kasım 2026"); // batı diliminde gün geri kaymaz
    const html = taskAssignedEmail(task(new Date("2026-11-07T12:00:00.000Z")), who, prop, "Europe/Istanbul");
    expect(html).toContain("7 Kasım 2026");
    expect(html).not.toMatch(/7 Kasım 2026 \d\d:\d\d/);
  });

  it("vade yoksa 'SON TARİH' satırı hiç yazılmaz", () => {
    expect(taskAssignedEmail(task(null), who, prop, "Europe/Istanbul")).not.toContain("SON TARİH");
  });
});

describe("deneme e-postaları süreyi çağırandan alır (gece-4 S2-11)", () => {
  it("varsayılan 14 gün (bugünkü metin aynen); TRIAL_DAYS değişirse metin de değişir", async () => {
    const { trialEndingSoonEmail, trialEndedEmail } = await import("@/lib/email-templates");
    expect(trialEndingSoonEmail(1, "https://x/settings")).toContain("14 günlük ücretsiz Pro denemeniz");
    expect(trialEndedEmail("https://x/settings")).toContain("14 günlük Pro denemeniz doldu.");
    expect(trialEndingSoonEmail(1, "https://x/settings", 7)).toContain("7 günlük ücretsiz Pro denemeniz");
    expect(trialEndedEmail("https://x/settings", 7)).toContain("7 günlük Pro denemeniz doldu.");
    expect(trialEndingSoonEmail(1, "https://x/settings", 14)).toBe(trialEndingSoonEmail(1, "https://x/settings"));
  });
});
