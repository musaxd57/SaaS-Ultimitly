import { describe, it, expect } from "vitest";
import { taskDueTimeLabel } from "@/lib/tasks/card-data";

// Vadenin SAATİ yalnız gerçek bir anda anlamlıdır (167a). Yaşam döngüsü görevinin vadesi rezervasyon TARİHİDİR ("yalnız
// tarih" çapası, `calendarDateOf`): saatini göstermek İstanbul'da "Çıkış temizliği · 03:00" yazıyordu.

describe("taskDueTimeLabel", () => {
  it("yalnız-tarih çapası (00:00Z / 12:00Z) → saat YOK, her dilimde", () => {
    for (const tz of ["Europe/Istanbul", "America/New_York", "Pacific/Auckland", "UTC"]) {
      expect(taskDueTimeLabel(new Date("2026-09-26T00:00:00.000Z"), tz), tz).toBeNull();
      expect(taskDueTimeLabel(new Date("2026-09-26T12:00:00.000Z"), tz), tz).toBeNull();
    }
  });

  it("gerçek an → org diliminde saat (İstanbul 07:30Z = 10:30; New York 14:30Z = 10:30)", () => {
    expect(taskDueTimeLabel(new Date("2026-09-26T07:30:00.000Z"), "Europe/Istanbul")).toBe("10:30");
    expect(taskDueTimeLabel(new Date("2026-09-26T14:30:00.000Z"), "America/New_York")).toBe("10:30");
    // Tam saate 1 ms kala da gerçek andır (çapa yalnız TAM 00:00:00.000 / 12:00:00.000).
    expect(taskDueTimeLabel(new Date("2026-09-26T11:59:59.999Z"), "UTC")).toBe("11:59");
  });

  it("vade yok → null", () => {
    expect(taskDueTimeLabel(null, "Europe/Istanbul")).toBeNull();
  });
});
