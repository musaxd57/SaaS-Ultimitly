import { describe, it, expect } from "vitest";
import { legacyTaskDuePrecision, resolveTaskDue, taskDueReading, taskDueWrite } from "@/lib/tasks/due-at";
import { taskCardData, taskDueDayLabel, taskDueTimeLabel, type TaskCardRow } from "@/lib/tasks/card-data";
import { taskAssignedEmail, taskDueEmailLabel } from "@/lib/email-templates";
import { evaluateStay, type StayReadinessInput } from "@/lib/readiness-list/evaluate";

// ---------------------------------------------------------------------------
// VADE HASSASİYETİ — OKUMA TEK KAYNAKTAN (`taskDueReading`, migration 98). Sütun doluysa SÜTUN kazanır; boşsa (eski kayıt) bugünkü çapa kuralı
// (tam 00:00Z / 12:00Z = saatsiz gün). Okuyucular (pano kartı, panel saati, e-posta, Girişler satırı) bu yardımcıdan karar verir.
// Çelişen satır (sütun "minute" ama değer çapada) bugünkü yazıcılarda OLUŞMAZ; burada yalnız "sütun gerçekten okunuyor mu" kanıtı için kurulur.
// ---------------------------------------------------------------------------

const IST = "Europe/Istanbul";
const NOON = new Date("2026-11-20T12:00:00.000Z"); // İstanbul 15:00 — ama tam öğle çapası
const MIDNIGHT = new Date("2026-11-20T00:00:00.000Z"); // İstanbul 03:00 — tam gece yarısı çapası
const INSTANT = new Date("2026-11-20T12:30:00.000Z"); // İstanbul 15:30

describe("eski kural (sütun yok)", () => {
  it("çapa → 'day', başka her an (1 ms dahil) → 'minute'", () => {
    expect(legacyTaskDuePrecision(NOON)).toBe("day");
    expect(legacyTaskDuePrecision(MIDNIGHT)).toBe("day");
    expect(legacyTaskDuePrecision(INSTANT)).toBe("minute");
    expect(legacyTaskDuePrecision(new Date(NOON.getTime() + 1))).toBe("minute");
  });

  it("KONTROL: sütun boş / tanınmayan → bugünkü okuma (çapa saatsiz, an saatli)", () => {
    for (const p of [null, undefined, "", "hour"]) {
      expect(taskDueReading(NOON, p, IST), String(p)).toEqual({ key: "2026-11-20", timed: false });
      expect(taskDueReading(INSTANT, p, IST), String(p)).toEqual({ key: "2026-11-20", timed: true });
    }
    expect(taskDueTimeLabel(NOON, IST)).toBeNull();
    expect(taskDueTimeLabel(INSTANT, IST)).toBe("15:30");
  });
});

describe("sütun okunur", () => {
  it("🚨 'minute' çapadaki değeri de SAATLİ okur (gün işletme diliminde)", () => {
    expect(taskDueReading(NOON, "minute", IST)).toEqual({ key: "2026-11-20", timed: true });
    // New York'ta 00:00Z bir önceki günün akşamıdır: çapa kuralı UTC gününü (20), sütun işletme gününü (19) verir.
    expect(taskDueReading(MIDNIGHT, "minute", "America/New_York")).toEqual({ key: "2026-11-19", timed: true });
    expect(taskDueReading(MIDNIGHT, null, "America/New_York")).toEqual({ key: "2026-11-20", timed: false });
  });

  it("🚨 'day' gerçek anı da SAATSİZ okur", () => {
    expect(taskDueReading(INSTANT, "day", IST)).toEqual({ key: "2026-11-20", timed: false });
  });

  it("🚨 pano saati / gün yazımı / e-posta sütunu okur", () => {
    expect(taskDueTimeLabel(NOON, IST, "minute")).toBe("15:00");
    expect(taskDueTimeLabel(INSTANT, IST, "day")).toBeNull();
    expect(taskDueDayLabel(MIDNIGHT, "America/New_York", "minute")).toBe(taskDueDayLabel(new Date("2026-11-19T15:00:00Z"), "America/New_York"));
    expect(taskDueEmailLabel(NOON, IST, "minute")).toMatch(/15:00/);
    expect(taskDueEmailLabel(INSTANT, IST, "day")).not.toMatch(/\d{2}:\d{2}/);
    expect(taskDueEmailLabel(NOON, IST)).not.toMatch(/\d{2}:\d{2}/);

    // Atama e-postası görevin sütununu taşır (rota tam satırı verir).
    const mail = (dueAtPrecision: string | null) =>
      taskAssignedEmail({ id: "t1", title: "Temizlik", type: "cleaning", priority: "standard", status: "todo", dueAt: NOON, dueAtPrecision }, { name: "A", email: "a@x.z" }, { name: "Lale" }, IST);
    expect(mail("minute")).toContain("20 Kasım 2026 15:00");
    expect(mail(null)).not.toContain("15:00");
  });

  it("🚨 pano kartı: gün sayısı ve çıkış notu sütundan okunan günle", () => {
    const row = (dueAtPrecision: string | null): TaskCardRow => ({
      id: "t1", title: "Temizlik", type: "cleaning", origin: "system", priority: "standard", status: "todo", dueAt: MIDNIGHT, dueAtPrecision,
      checklistJson: null, property: { name: "Lale" }, assignedTo: null, updates: [],
    });
    const ctx = {
      canManage: true, timeZone: "America/New_York", now: new Date("2026-11-19T15:00:00Z"), latestPhotoUrl: null,
      checkout: { time: "11:00", lateApproved: false, departureKey: "2026-11-19" },
    };
    const legacy = taskCardData(row(null), ctx);
    expect(legacy.dueDays).toBe(1);
    expect(legacy.checkoutNote).toBeNull();
    const minute = taskCardData(row("minute"), ctx);
    expect(minute.dueDays).toBe(0);
    expect(minute.checkoutNote).toBe("Misafir çıkışı 11:00");
    expect(minute.dueLabel).toBe(taskDueDayLabel(new Date("2026-11-19T15:00:00Z"), "America/New_York"));
    expect(legacy.dueLabel).toBe(taskDueDayLabel(new Date("2026-11-20T15:00:00Z"), "America/New_York"));
  });

  it("🚨 Girişler satırının vade yazımı sütunu okur", () => {
    const input = (dueAtPrecision: string | null): StayReadinessInput => ({
      timeZone: IST, now: new Date("2026-11-20T06:00:00Z"),
      cleaning: { status: "not_ready", note: "open", previousKnown: true, previousCheckout: "11:00", readyMark: null, tasks: [] },
      openIssue: true, maintenanceOpen: false, overlaps: 0, commitments: [], needs: [], accessInstructions: null, checkInTime: "15:00",
      issueTasks: [{ id: "i1", title: "Musluk", kindLabel: "Bakım", assignee: null, assigneeId: null, status: "todo", touched: false, dueAt: NOON, dueAtPrecision, relation: "unlinked", priority: "standard" }],
    });
    const label = (p: string | null) => evaluateStay(input(p)).factors.find((f) => f.key === "issue")!.label;
    expect(label(null)).not.toMatch(/15:00/);
    expect(label("minute")).toMatch(/15:00/);
  });
});

describe("yazım (tek kaynak)", () => {
  it("vade yok → ikisi de null; hassasiyet verilmezse eski kural; verilirse o", () => {
    expect(taskDueWrite(null)).toEqual({ dueAt: null, dueAtPrecision: null });
    expect(taskDueWrite(NOON)).toEqual({ dueAt: NOON, dueAtPrecision: "day" });
    expect(taskDueWrite(INSTANT)).toEqual({ dueAt: INSTANT, dueAtPrecision: "minute" });
    expect(taskDueWrite(INSTANT, "day")).toEqual({ dueAt: INSTANT, dueAtPrecision: "day" });
  });

  it("🚨 formun duvar saati her zaman 'minute' (çapaya düşse de); dilim taşıyan değer eski kuraldan", () => {
    expect(resolveTaskDue({ wallClock: "2026-11-20T15:00" }, IST)).toEqual({ dueAt: new Date("2026-11-20T12:00:00.001Z"), dueAtPrecision: "minute" });
    expect(resolveTaskDue({ wallClock: "2026-11-20T15:30" }, IST)!.dueAtPrecision).toBe("minute");
    expect(resolveTaskDue(MIDNIGHT, IST)).toEqual({ dueAt: MIDNIGHT, dueAtPrecision: "day" });
    expect(resolveTaskDue(INSTANT, IST)!.dueAtPrecision).toBe("minute");
    expect(resolveTaskDue({ wallClock: "2026-02-31T10:00" }, IST)).toBeNull();
  });
});
