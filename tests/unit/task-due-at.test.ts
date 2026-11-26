import { describe, it, expect } from "vitest";
import { isZonelessWallClock, zonelessWallClockToUtc } from "@/lib/timezone";
import { resolveTaskDueAt } from "@/lib/tasks/due-at";
import { taskSchema, taskUpdateSchema } from "@/lib/validators";
import { taskDueTimeLabel, taskDueDayLabel } from "@/lib/tasks/card-data";

// ---------------------------------------------------------------------------
// E5 (Codex 11-17): görev formunun dilimsiz saati İŞLETMENİN diliminde okunur. Beklenen anlar SABİT UTC değerleridir → test sürecin dilimine
// bağlı değildir (eski kod sürecin dilimini okuyordu: UTC süreçte kırmızı, UTC+3 süreçte tesadüfen yeşil olurdu).
// ---------------------------------------------------------------------------

describe("dilimsiz duvar saati → işletme diliminde an", () => {
  it("İstanbul 15:00 → 12:00Z; New York 15:00 (kış) → 20:00Z", () => {
    expect(zonelessWallClockToUtc("2026-11-20T15:00", "Europe/Istanbul")!.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(zonelessWallClockToUtc("2026-11-20T15:00", "America/New_York")!.toISOString()).toBe("2026-11-20T20:00:00.000Z");
    expect(zonelessWallClockToUtc("2026-11-20T15:00:30", "Europe/Istanbul")!.toISOString()).toBe("2026-11-20T12:00:30.000Z");
  });

  it("🚨 yaz saati boşluğu (Berlin 29 Mart 02:30 yok) → bir saat sonrası (03:30 yaz saati = 01:30Z)", () => {
    expect(zonelessWallClockToUtc("2026-03-29T02:30", "Europe/Berlin")!.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("🚨 yaz saati çift saati (Berlin 25 Ekim 02:30 iki kez) → İKİNCİ okuma (kış saati, 01:30Z)", () => {
    expect(zonelessWallClockToUtc("2026-10-25T02:30", "Europe/Berlin")!.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("takvimde olmayan değer null; dilim taşıyan / başka biçim dilimsiz sayılmaz", () => {
    expect(zonelessWallClockToUtc("2026-02-31T10:00", "Europe/Istanbul")).toBeNull();
    expect(zonelessWallClockToUtc("2026-11-20T24:00", "Europe/Istanbul")).toBeNull();
    expect(zonelessWallClockToUtc("0099-11-20T10:00", "Europe/Istanbul")).toBeNull();
    expect(isZonelessWallClock("2026-11-20T15:00")).toBe(true);
    expect(isZonelessWallClock("2026-11-20T15:00Z")).toBe(false);
    expect(isZonelessWallClock("2026-11-20T15:00+03:00")).toBe(false);
    expect(isZonelessWallClock("2026-11-20")).toBe(false);
  });
});

describe("resolveTaskDueAt — çapa çakışması ve gösterimle gidiş-dönüş", () => {
  it("🚨 İstanbul 15:00 tam 12:00Z'ye (saatsiz gün çapası) düşer → 1 ms ileri; kart saati 15:00, günü aynı", () => {
    const at = resolveTaskDueAt({ wallClock: "2026-11-20T15:00" }, "Europe/Istanbul")!;
    expect(at.toISOString()).toBe("2026-11-20T12:00:00.001Z");
    expect(taskDueTimeLabel(at, "Europe/Istanbul")).toBe("15:00");
    expect(taskDueDayLabel(at, "Europe/Istanbul")).toBe(taskDueDayLabel(new Date("2026-11-20T09:00:00Z"), "Europe/Istanbul"));
  });

  it("İstanbul 03:00 (tam 00:00Z) da saat olarak kalır", () => {
    const at = resolveTaskDueAt({ wallClock: "2026-11-20T03:00" }, "Europe/Istanbul")!;
    expect(at.toISOString()).toBe("2026-11-20T00:00:00.001Z");
    expect(taskDueTimeLabel(at, "Europe/Istanbul")).toBe("03:00");
  });

  it("KONTROL — çapaya düşmeyen saat kaydırılmaz; mutlak an (Z) olduğu gibi döner (çapada olsa bile)", () => {
    expect(resolveTaskDueAt({ wallClock: "2026-11-20T15:30" }, "Europe/Istanbul")!.toISOString()).toBe("2026-11-20T12:30:00.000Z");
    const z = new Date("2026-11-20T12:00:00Z");
    expect(resolveTaskDueAt(z, "Europe/Istanbul")).toBe(z);
  });
});

describe("görev şemaları — vade", () => {
  const base = { propertyId: "p1", title: "Temizlik" };
  it("dilimsiz değer ana çevrilmez ({ wallClock }); dilim taşıyan Date olur; boş dize vade yok", () => {
    expect(taskSchema.parse({ ...base, dueAt: "2026-11-20T15:00" }).dueAt).toEqual({ wallClock: "2026-11-20T15:00" });
    const z = taskSchema.parse({ ...base, dueAt: "2026-11-20T15:00Z" }).dueAt;
    expect(z instanceof Date && z.toISOString()).toBe("2026-11-20T15:00:00.000Z");
    expect(taskSchema.parse({ ...base, dueAt: "" }).dueAt).toBeUndefined();
    expect(taskSchema.parse(base).dueAt).toBeUndefined();
    expect(taskUpdateSchema.parse({ dueAt: "2026-11-21T09:30" }).dueAt).toEqual({ wallClock: "2026-11-21T09:30" });
    expect(taskUpdateSchema.parse({}).dueAt).toBeUndefined();
  });

  it("takvimde olmayan / saklanamaz duvar saati 'Geçersiz tarih'; güncellemede boş dize bugünkü gibi ret", () => {
    const bad = taskSchema.safeParse({ ...base, dueAt: "2026-02-31T10:00" });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0].message).toBe("Geçersiz tarih");
    expect(taskSchema.safeParse({ ...base, dueAt: "1899-12-31T10:00" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ dueAt: "" }).success).toBe(false);
    expect(taskSchema.safeParse({ ...base, dueAt: "bozuk" }).success).toBe(false);
  });
});
