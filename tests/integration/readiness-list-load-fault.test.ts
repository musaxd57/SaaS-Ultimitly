import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { todayKey, addNights } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// Giriş hazırlığı listesi — bir konaklamanın hükmü okunamazsa sayfa DÜŞMEZ: o satır "okunamadı" (bilinmiyor; asla yeşil değil) olur,
// hata raporlanır, diğer satırlar normal hesaplanır. Arıza taklidi ayrı dosyada (modül taklidi diğer testlere sızmasın).
// ---------------------------------------------------------------------------

const failFor = new Set<string>();
/** Çekirdeğin dayanak kümesine YABANCI kimlik sokar (gerçekte çekirdek mülk kapsamlı okur; burada yükleyicinin KENDİ org süzgeci sınanır). */
const injectBasis = vi.hoisted(() => ({ issue: [] as string[], note: [] as string[], overlap: [] as string[] }));
vi.mock("@/lib/early-checkin/load", async (orig) => {
  const actual = await orig<typeof import("@/lib/early-checkin/load")>();
  return {
    ...actual,
    loadEarlyCheckinFacts: vi.fn(async (args: Parameters<typeof actual.loadEarlyCheckinFacts>[0]) => {
      if (args.reservationId && failFor.has(args.reservationId)) throw new Error("db hiccup (test)");
      const out = await actual.loadEarlyCheckinFacts(args);
      if (!out) return out;
      return {
        ...out,
        basisIds: {
          ...out.basisIds,
          issueTaskIds: [...out.basisIds.issueTaskIds, ...injectBasis.issue],
          noteTaskIds: [...out.basisIds.noteTaskIds, ...injectBasis.note],
          overlapReservationIds: [...out.basisIds.overlapReservationIds, ...injectBasis.overlap],
        },
      };
    }),
  };
});
const reported = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async (ctx: string) => {
    reported.calls.push(ctx);
    return "reported";
  }),
}));

import { loadArrivalReadiness } from "@/lib/readiness-list/load";

const TZ = "Europe/Istanbul";
const TODAY = todayKey(new Date(), TZ);
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);
/** Bugün, İstanbul saatiyle HH:MM (UTC+3, yaz saati yok) — günün başı gece yarısından hemen sonra da "bugün" kalır. */
const istanbulToday = (hh: number, mm: number) => new Date(new Date(`${TODAY}T00:00:00Z`).getTime() + ((hh - 3) * 60 + mm) * 60_000);

describe("giriş hazırlığı listesi — bir konaklamanın arızası", () => {
  beforeEach(async () => {
    await resetDb();
    failFor.clear();
    reported.calls.length = 0;
    injectBasis.issue = [];
    injectBasis.note = [];
    injectBasis.overlap = [];
  });

  it("🚨 dayanak okuması da kendi org süzgecinden geçer: başka işletmenin görevi / notu / konaklaması kimliği sızsa bile GÖSTERİLMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
    const ayse = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse-f@example.test", passwordHash: "x", role: "staff" } });
    const prev = await prisma.reservation.create({
      data: { propertyId, guestName: "Önceki", arrivalDate: dayDate(addNights(TODAY, -2)), departureDate: dayDate(TODAY), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Bizim", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    // Bizim satırda GERÇEK engel / not / çakışma var (yoksa dayanak satırı hiç yazılmaz ve test boş geçerdi).
    const ours = await prisma.task.create({ data: { propertyId, reservationId: prev.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(TODAY) } });
    await prisma.taskUpdate.create({ data: { taskId: ours.id, userId: ayse.id, note: "bizim not", createdAt: istanbulToday(0, 1) } });
    await prisma.task.create({ data: { propertyId, type: "maintenance", title: "Bizim Bakım", origin: "manual", status: "todo" } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Bizim Çakışan", arrivalDate: dayDate(addNights(TODAY, -1)), departureDate: dayDate(addNights(TODAY, 1)), status: "confirmed", channel: "airbnb" },
    });
    const other = await makeOrgWithProperty();
    const zeynep = await prisma.user.create({ data: { organizationId: other.orgId, name: "Zeynep", email: "zeynep-f@example.test", passwordHash: "x", role: "staff" } });
    const foreignTask = await prisma.task.create({
      data: { propertyId: other.propertyId, type: "maintenance", title: "Yabancı Bakım", origin: "manual", status: "todo", assignedToId: zeynep.id },
    });
    const foreignNoteTask = await prisma.task.create({ data: { propertyId: other.propertyId, type: "cleaning", title: "Yabancı Temizlik", origin: "manual", status: "todo" } });
    // Bizimkinden YENİ: süzgeç düşerse "en yeni not" olarak seçilirdi.
    await prisma.taskUpdate.create({ data: { taskId: foreignNoteTask.id, userId: zeynep.id, note: "yabancı not", createdAt: istanbulToday(0, 2) } });
    const foreignStay = await prisma.reservation.create({
      data: { propertyId: other.propertyId, guestName: "Yabancı Misafir", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 1)), status: "confirmed", channel: "airbnb" },
    });
    injectBasis.issue = [foreignTask.id];
    injectBasis.note = [foreignNoteTask.id];
    injectBasis.overlap = [foreignStay.id];
    const { rows } = await loadArrivalReadiness(orgId, new Date());
    expect(rows.map((r) => r.guestName)).toEqual(["Bizim"]);
    const text = JSON.stringify(rows);
    // Boş geçmeye karşı: bizim dayanaklarımız yazılı.
    expect(text).toContain("Bizim Bakım");
    expect(text).toContain("Bizim Çakışan");
    expect(rows[0].readiness.factors.find((f) => f.key === "cleaning_note")!.label).toBe("Temizlik görevine not yazıldı · Ayşe · 00:01 — görevde okuyun");
    expect(text).not.toContain("Yabancı");
    expect(text).not.toContain("Zeynep");
  });

  it("🚨 bir konaklamanın hükmü okunamazsa o satır BİLİNMİYOR + 'okunamadı'; diğer satır etkilenmez; hata raporlanır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const p2 = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale 7" } })).id;
    const bad = await prisma.reservation.create({
      data: { propertyId, guestName: "Arızalı", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId: p2, guestName: "Sağlam", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    failFor.add(bad.id);
    const { rows } = await loadArrivalReadiness(orgId, new Date());
    const byGuest = new Map(rows.map((r) => [r.guestName, r]));
    expect(rows).toHaveLength(2);
    const broken = byGuest.get("Arızalı")!;
    expect(broken.readiness.overall).toBe("unknown");
    expect(broken.readiness.factors.find((f) => f.key === "cleaning")).toMatchObject({ state: "unknown", label: "Temizlik durumu şu an okunamadı" });
    const ok = byGuest.get("Sağlam")!;
    expect(ok.readiness.factors.find((f) => f.key === "cleaning")!.label).not.toBe("Temizlik durumu şu an okunamadı");
    expect(reported.calls).toContain("readiness-list.stay");
  });
});
