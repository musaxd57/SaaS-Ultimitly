import { describe, it, expect } from "vitest";
import { taskCardData, type TaskCardRow } from "@/lib/tasks/card-data";

// ---------------------------------------------------------------------------
// Görev kartının GÜNÜ (tarih etiketi + "Bugün / Bu hafta" süzgeci + WhatsApp temizlik listesi) tek tarih kuralıyla
// (`calendarDateOf`, 09-26). Yaşam döngüsü vadesi rezervasyon TARİHİDİR ("yalnız tarih" çapası D 00:00Z / D 12:00Z). Ham
// "an → yerel gün" New York'ta kartı bir gün ERKEN gösteriyordu ("25 Eyl", "Dün"); İstanbul'da ikisi birebir aynı.
// ---------------------------------------------------------------------------

const row = (dueAt: string | null): TaskCardRow => ({
  id: "t1",
  title: "Çıkış temizliği - Deneme",
  type: "cleaning",
  origin: "system",
  priority: "standard",
  status: "todo",
  dueAt: dueAt ? new Date(dueAt) : null,
  checklistJson: null,
  property: { name: "Daire 1" },
  assignedTo: null,
  updates: [],
});
const card = (dueAt: string | null, timeZone: string, now: string) =>
  taskCardData(row(dueAt), { canManage: true, timeZone, now: new Date(now), latestPhotoUrl: null });

describe("taskCardData — vadenin günü", () => {
  it("🚨 New York: bugünün 00:00Z çapası BUGÜN (eskisi '25 Eyl' / dün diyordu)", () => {
    const c = card("2026-09-26T00:00:00.000Z", "America/New_York", "2026-09-26T15:00:00Z");
    expect({ label: c.dueLabel, days: c.dueDays }).toEqual({ label: "26 Eyl 2026", days: 0 });
  });

  it("🚨 Auckland: dünün 12:00Z çapası DÜN (bugün değil)", () => {
    const c = card("2026-09-25T12:00:00.000Z", "Pacific/Auckland", "2026-09-26T03:00:00Z");
    expect({ label: c.dueLabel, days: c.dueDays }).toEqual({ label: "25 Eyl 2026", days: -1 });
  });

  it("gerçek an org gününde okunur (New York 25 Eylül 23:30 = dün)", () => {
    const c = card("2026-09-26T03:30:00.000Z", "America/New_York", "2026-09-26T15:00:00Z");
    expect({ label: c.dueLabel, days: c.dueDays }).toEqual({ label: "25 Eyl 2026", days: -1 });
  });

  it("İstanbul: çapa, gece yarısı sınırı ve gerçek an eskisiyle BİREBİR", () => {
    const now = "2026-09-26T15:00:00Z"; // İstanbul 26 Eylül 18:00
    const expected: [string, string, number][] = [
      ["2026-09-26T00:00:00.000Z", "26 Eyl 2026", 0],
      ["2026-09-26T12:00:00.000Z", "26 Eyl 2026", 0],
      ["2026-09-25T20:59:59.999Z", "25 Eyl 2026", -1], // İstanbul 25 Eylül 23:59
      ["2026-09-25T21:00:00.000Z", "26 Eyl 2026", 0], // İstanbul 26 Eylül 00:00
      ["2026-09-27T00:00:00.000Z", "27 Eyl 2026", 1],
    ];
    for (const [dueAt, label, days] of expected) {
      const c = card(dueAt, "Europe/Istanbul", now);
      expect({ label: c.dueLabel, days: c.dueDays }, dueAt).toEqual({ label, days });
    }
  });

  it("'bugün' ORG gününe göre: İstanbul 27 Eylül 01:30'da (UTC hâlâ 26'sı) 27 Eylül vadesi BUGÜN", () => {
    const c = card("2026-09-27T00:00:00.000Z", "Europe/Istanbul", "2026-09-26T22:30:00Z");
    expect({ label: c.dueLabel, days: c.dueDays }).toEqual({ label: "27 Eyl 2026", days: 0 });
  });

  it("vadesiz görev → etiket ve gün yok", () => {
    const c = card(null, "Europe/Istanbul", "2026-09-26T15:00:00Z");
    expect({ label: c.dueLabel, days: c.dueDays }).toEqual({ label: null, days: null });
  });
});
