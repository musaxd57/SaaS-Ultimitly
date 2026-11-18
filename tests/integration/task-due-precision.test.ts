import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// VADE HASSASİYETİ AÇIK ALANDA (`Task.dueAtPrecision`, migration 98 — Codex 11-17 / kurucu 11-18). Gerçek PostgreSQL: görev yazan HER yol
// hassasiyeti sütuna da yazar ("minute" saatli · "day" saatsiz gün · vade yoksa null). Görünen davranış değişmez: yazılan hassasiyet, eski
// kuralın (`calendarDateOf` çapası) aynı değer için verdiği sonuçla HER ZAMAN aynıdır — testler ikisini de sınar.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));

import { POST as createTaskRoute } from "@/app/api/tasks/route";
import { PATCH as patchTaskRoute } from "@/app/api/tasks/[id]/route";
import { createReservationTasks } from "@/lib/automation";
import { followReservationDates } from "@/lib/tasks/follow-reservation";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";
import { createGuestCommitment } from "@/lib/guest-commitments";
import { applyHostCommitmentsAuto } from "@/lib/guest-commitments-auto";
import { __afterMidnightRule } from "@/lib/ai-suggestions/load";
import { buildDemoDataset } from "@/lib/demo-tenant/dataset";
import { applyDemoTenant } from "@/lib/demo-tenant/apply-core";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { legacyTaskDuePrecision, taskDueReading } from "@/lib/tasks/due-at";
import { taskDueTimeLabel } from "@/lib/tasks/card-data";

const TZ = "Europe/Istanbul";

function post(body: Record<string, unknown>) {
  return createTaskRoute(
    new NextRequest("http://localhost/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({} as Record<string, never>) },
  );
}
function patch(id: string, body: Record<string, unknown>) {
  return patchTaskRoute(
    new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}
const stored = (id: string) => prisma.task.findUniqueOrThrow({ where: { id }, select: { dueAt: true, dueAtPrecision: true } });

/** Yazılan hassasiyet eski kuralın sonucuyla aynı mı (görünen davranış değişmez). */
function agreesWithLegacy(t: { dueAt: Date | null; dueAtPrecision: string | null }) {
  expect(t.dueAtPrecision).toBe(t.dueAt ? legacyTaskDuePrecision(t.dueAt) : null);
}

let orgId: string;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const made = await makeOrgWithProperty();
  orgId = made.orgId;
  propertyId = made.propertyId;
  await prisma.organization.update({ where: { id: orgId }, data: { timezone: TZ } });
  const owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "o@x.com", passwordHash: "x", role: "owner" } });
  session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "Sahip", sessionEpoch: 0 };
});
afterEach(() => {
  vi.unstubAllEnvs();
  __afterMidnightRule.enabled = true;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("elle görev rotaları", () => {
  const body = (dueAt: string) => ({ propertyId, type: "cleaning", title: "Balkonu yıka", status: "todo", priority: "standard", dueAt });

  it("🚨 KIRMIZI-ÖNCE: formdan 15:00 (İstanbul = 12:00Z çapası) → 'minute', saatli okunur", async () => {
    const { id } = (await (await post(body("2026-11-20T15:00"))).json()) as { id: string };
    const t = await stored(id);
    expect(t.dueAtPrecision).toBe("minute");
    expect(taskDueReading(t.dueAt!, t.dueAtPrecision, TZ)).toEqual({ key: "2026-11-20", timed: true });
    expect(taskDueTimeLabel(t.dueAt, TZ, t.dueAtPrecision)).toBe("15:00");
    agreesWithLegacy(t);
  });

  it("vadesiz görev → vade de hassasiyet de null", async () => {
    const { id } = (await (await post(body(""))).json()) as { id: string };
    expect(await stored(id)).toEqual({ dueAt: null, dueAtPrecision: null });
  });

  it("dilim taşıyan API değeri bugünkü kuraldan: yalnız tarih ('2026-11-20' → 00:00Z) 'day', saatli an 'minute'", async () => {
    const day = (await (await post(body("2026-11-20"))).json()) as { id: string };
    expect((await stored(day.id)).dueAtPrecision).toBe("day");
    const at = (await (await post(body("2026-11-20T15:00:00Z"))).json()) as { id: string };
    expect((await stored(at.id)).dueAtPrecision).toBe("minute");
  });

  it("🚨 düzenlemede saat silinince (yalnız tarih) 'day'; yeniden saat girilince 'minute'", async () => {
    const { id } = (await (await post(body("2026-11-20T15:00"))).json()) as { id: string };
    expect((await patch(id, { dueAt: "2026-11-21" })).status).toBe(200);
    const asDay = await stored(id);
    expect(asDay.dueAtPrecision).toBe("day");
    expect(taskDueTimeLabel(asDay.dueAt, TZ, asDay.dueAtPrecision)).toBeNull();
    expect((await patch(id, { dueAt: "2026-11-21T03:00" })).status).toBe(200);
    const timed = await stored(id);
    expect(timed.dueAtPrecision).toBe("minute");
    expect(taskDueTimeLabel(timed.dueAt, TZ, timed.dueAtPrecision)).toBe("03:00");
  });

  it("KONTROL: vadeye dokunmayan düzenleme hassasiyete de dokunmaz", async () => {
    const { id } = (await (await post(body("2026-11-20"))).json()) as { id: string };
    expect((await patch(id, { title: "Balkonu yıka ve sula" })).status).toBe(200);
    expect((await stored(id)).dueAtPrecision).toBe("day");
  });
});

describe("yaşam döngüsü görevleri", () => {
  const reservation = (arrivalDate: Date, departureDate: Date) =>
    prisma.reservation.create({ data: { propertyId, guestName: "Lale Misafir", arrivalDate, departureDate, channel: "airbnb", status: "confirmed" } });

  it("🚨 yalnız tarih taşıyan rezervasyon (00:00Z) → görevler 'day'", async () => {
    const r = await reservation(stayDay(3), stayDay(5));
    expect(await createReservationTasks(r.id)).toBe(2);
    const tasks = await prisma.task.findMany({ where: { reservationId: r.id }, select: { dueAt: true, dueAtPrecision: true } });
    expect(tasks.map((t) => t.dueAtPrecision)).toEqual(["day", "day"]);
    tasks.forEach(agreesWithLegacy);
  });

  it("KONTROL (aşırı uygulama yok): gerçek an taşıyan rezervasyon → 'minute' (eski kural saatli okuyordu; görünen davranış aynı)", async () => {
    const r = await reservation(new Date(stayDay(3).getTime() + 11 * 3_600_000), new Date(stayDay(5).getTime() + 8 * 3_600_000));
    await createReservationTasks(r.id);
    const tasks = await prisma.task.findMany({ where: { reservationId: r.id }, select: { dueAt: true, dueAtPrecision: true } });
    expect(tasks.map((t) => t.dueAtPrecision)).toEqual(["minute", "minute"]);
  });

  it("🚨 atanmış temizlik (dairenin temizlikçisi kuralı — tek `create` dalı) de hassasiyeti taşır", async () => {
    const cleaner = await prisma.user.create({ data: { organizationId: orgId, name: "Temizlikçi", email: "c@x.com", passwordHash: "x", role: "staff" } });
    const { saveDefaultCleaner } = await import("@/lib/tasks/default-cleaner");
    expect((await saveDefaultCleaner(orgId, propertyId, cleaner.id)).result).toBe("saved");
    const r = await reservation(stayDay(3), stayDay(5));
    await createReservationTasks(r.id);
    const cleaning = await prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } });
    expect(cleaning.assignedToId).toBe(cleaner.id);
    expect(cleaning.dueAtPrecision).toBe("day");
  });

  it("🚨 rezervasyon tarihi değişince taşınan görevin hassasiyeti YENİ tarihten (gün → gerçek an)", async () => {
    const r = await reservation(stayDay(3), stayDay(5));
    await createReservationTasks(r.id);
    const newDeparture = new Date(stayDay(6).getTime() + 8 * 3_600_000);
    await prisma.$transaction((tx) =>
      followReservationDates(tx, r.id, { arrivalDate: r.arrivalDate, departureDate: r.departureDate }, { arrivalDate: r.arrivalDate, departureDate: newDeparture }),
    );
    const cleaning = await prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } });
    expect(cleaning.dueAt!.getTime()).toBe(newDeparture.getTime());
    expect(cleaning.dueAtPrecision).toBe("minute");
    const prep = await prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "checkin_prep" } });
    expect(prep.dueAtPrecision).toBe("day");
  });
});

describe("mesajdan / sözden açılan görevler", () => {
  it("🚨 mesajdan açılan görev (şimdi + süre) → 'minute'", async () => {
    const r = await createOperationalTaskFromMessage({
      propertyId,
      message: "Klima çalışmıyor, oda çok sıcak",
      sourceMessageId: "msg-1",
      now: new Date("2026-11-20T09:13:27.123Z"),
    });
    expect(r.status).toBe("created");
    const t = await prisma.task.findFirstOrThrow({ where: { propertyId, sourceMessageId: "msg-1" } });
    expect(t.dueAtPrecision).toBe("minute");
    agreesWithLegacy(t);
  });

  async function conversation() {
    return (await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } })).id;
  }

  it("🚨 saatli söz → görevi 'minute'; gün sözü → görevi 'day' (yalnız-tarih çapası)", async () => {
    const conversationId = await conversation();
    const timed = await createGuestCommitment({
      organizationId: orgId, conversationId, propertyId, reservationId: null, kind: "towels",
      dueAt: new Date("2026-11-21T07:30:00.000Z"), actorUserId: session.userId,
    });
    expect((await stored(timed.taskId)).dueAtPrecision).toBe("minute");
    const day = await createGuestCommitment({
      organizationId: orgId, conversationId, propertyId, reservationId: null, kind: "towels",
      dueAt: new Date("2026-11-22T20:59:00.000Z"), duePrecision: "day", dayKey: "2026-11-22", actorUserId: session.userId,
    });
    const t = await stored(day.taskId);
    expect(t.dueAt!.toISOString()).toBe("2026-11-22T12:00:00.000Z");
    expect(t.dueAtPrecision).toBe("day");
  });

  it("🚨 sözün saati taşınınca (öneri / otomatik söz) görev hassasiyeti yeniden yazılır", async () => {
    vi.stubEnv("HOST_COMMITMENT_AUTO_ENABLED", "1");
    __afterMidnightRule.enabled = false;
    const conversationId = await conversation();
    const say = (body: string, at: Date) =>
      prisma.message.create({ data: { conversationId, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body, createdAt: at } });
    await say("Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(orgId, conversationId);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    // Taşıma yazımı sınansın: oluşturmanın yazdığı değer silinir (taşıma yazmazsa null kalır).
    await prisma.task.update({ where: { id: c.taskId! }, data: { dueAtPrecision: null } });
    await say("Klima için teknisyen yarın 11:00'de gelecek.", new Date());
    expect((await applyHostCommitmentsAuto(orgId, conversationId, new Date(Date.now() + 1_000))).rescheduled).toBe(1);
    const t = await stored(c.taskId!);
    expect(t.dueAtPrecision).toBe("minute");
    agreesWithLegacy(t);
  });
});

describe("demo hesabı", () => {
  it("🚨 demo veri kümesinin görevleri hassasiyeti taşır (eski kuralla aynı)", async () => {
    await applyDemoTenant(prisma, buildDemoDataset({ now: new Date() }), {
      reviewerPasswordHash: bcrypt.hashSync("demo-sifre-uzun-ve-rastgele-xyz", 4),
      staffPasswordHash: bcrypt.hashSync("kullanilmayan", 4),
    });
    const tasks = await prisma.task.findMany({ where: { property: { organizationId: DEMO_ORG_ID } }, select: { dueAt: true, dueAtPrecision: true } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.dueAtPrecision !== null)).toBe(true);
    tasks.forEach(agreesWithLegacy);
    expect(new Set(tasks.map((t) => t.dueAtPrecision))).toEqual(new Set(["day", "minute"]));
  });
});
