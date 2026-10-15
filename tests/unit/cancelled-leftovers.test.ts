import { describe, it, expect } from "vitest";
import {
  summarizeLeftovers,
  OPEN_AUTO_LIFECYCLE_TASK_WHERE,
  STORAGE_PHOTO_PREFIX,
  type LeftoverRow,
} from "@/lib/tasks/cancelled-leftovers";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const row = (over: Partial<LeftoverRow> & { res?: Partial<LeftoverRow["reservation"]> } = {}): LeftoverRow => ({
  type: "cleaning",
  status: "todo",
  assigned: false,
  staffUpdates: 0,
  storagePhotos: 0,
  otherPhotos: 0,
  ...over,
  reservation: {
    id: "r1",
    organizationId: "o1",
    channel: "airbnb",
    calendarSourceId: null,
    departureDate: new Date("2026-10-20T00:00:00.000Z"),
    ...over.res,
  },
});

describe("iptal edilmiş konaklamada kalan sistem görevleri — saf sayım", () => {
  it("boş girdi → hepsi sıfır", () => {
    expect(summarizeLeftovers([], NOW)).toMatchObject({ reservations: 0, tasks: 0, organizations: 0, tasksPerOrganization: [], assigned: 0, pastStay: 0, futureStay: 0 });
  });

  it("rezervasyon / işletme tekil sayılır; tür / durum / atama / kişi izi / fotoğraf / kaynak / zaman ayrı sayılır", () => {
    const s = summarizeLeftovers(
      [
        row({ type: "checkin_prep", res: { id: "r1", calendarSourceId: "src" } }),
        row({ type: "cleaning", status: "in_progress", assigned: true, staffUpdates: 2, storagePhotos: 1, res: { id: "r1", calendarSourceId: "src" } }),
        row({ otherPhotos: 1, res: { id: "r2", organizationId: "o2", channel: "ics", departureDate: new Date("2026-10-01T00:00:00.000Z") } }),
        row({ res: { id: "r3", channel: "airbnb" } }),
      ],
      NOW,
    );
    expect(s.reservations).toBe(3);
    expect(s.tasks).toBe(4);
    expect(s.organizations).toBe(2);
    expect(s.tasksPerOrganization).toEqual([3, 1]);
    expect(s.byType).toEqual({ checkin_prep: 1, cleaning: 3 });
    expect(s.byStatus).toEqual({ todo: 3, in_progress: 1 });
    expect([s.assigned, s.withStaffUpdates, s.withStoragePhotos, s.withOtherPhotos]).toEqual([1, 1, 1, 1]);
    expect(s.bySource).toEqual({ calendar_feed: 2, file: 1, other: 1 });
    expect([s.pastStay, s.futureStay]).toEqual([1, 3]);
  });

  it("kurucu D5 aday ayrımı: yalnız başlanmamış + dokunulmamış aday; başlanmış ve dokunulmuş KORUNUR (ayrı sayılır)", () => {
    const s = summarizeLeftovers(
      [
        row(), // aday
        row({ assigned: true }), // aday, atanmış
        row({ status: "in_progress" }), // başlanmış → korunur
        row({ status: "awaiting_review", staffUpdates: 1 }), // başlanmış → korunur (bir kez sayılır)
        row({ staffUpdates: 1 }), // dokunulmuş → korunur
        row({ otherPhotos: 1 }), // fotoğraflı → korunur
      ],
      NOW,
    );
    expect([s.candidates, s.candidatesAssigned, s.protectedStarted, s.protectedTouched]).toEqual([2, 1, 2, 2]);
  });

  it("çıktıda kimlik / ad yok: yalnız sayı ve sabit anahtarlar", () => {
    const json = JSON.stringify(summarizeLeftovers([row({ res: { id: "gizli-rezervasyon-kimligi", organizationId: "gizli-isletme-kimligi" } })], NOW));
    expect(json).not.toContain("gizli-rezervasyon-kimligi");
    expect(json).not.toContain("gizli-isletme-kimligi");
  });

  it("küme tanımı: yalnız sistemin açtığı, bitmemiş giriş hazırlığı / temizlik (ev sahibinin ve mesajdan açılan görev korunur)", () => {
    expect(OPEN_AUTO_LIFECYCLE_TASK_WHERE).toEqual({ status: { not: "done" }, type: { in: ["checkin_prep", "cleaning"] }, origin: "system" });
  });

  it("depo fotoğrafı öneki sunucu modülündekiyle AYNI (betik onu import edemiyor — ayrışma burada yakalanır)", () => {
    expect(STORAGE_PHOTO_PREFIX).toBe(STORAGE_PHOTO_URL_PREFIX);
  });
});
