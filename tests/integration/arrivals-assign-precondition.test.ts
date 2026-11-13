import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// UX-10 D3 (kurucu 11-13: "ilk 2'si kesinlikle olur"): Girişler satırından atama, satırın gördüğü atananı ÖN ŞART olarak gönderir
// (`expectAssignedToId`; boş dize = "atanmamış bekliyorum"). Kilitli satıra göre: tutmazsa ya da iş başladıysa / bittiyse yazma YOK (409).
// Pano bu alanı göndermez → panonun davranışı DEĞİŞMEZ. Yükleyici, atanabilir satıra atama eylemini kişi kimliğiyle verir.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[] }));
vi.mock("@/lib/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailService: {
      ...actual.emailService,
      sendReporting: vi.fn(async (to: string, subject: string) => {
        mail.sent.push({ to, subject });
        return { ok: true };
      }),
    },
  };
});

import { PATCH } from "@/app/api/tasks/[id]/route";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { todayKey, addNights } from "@/modules/availability/core";

const TODAY = todayKey(new Date(), "Europe/Istanbul");
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

describe("Girişler'den atama — ön şart", () => {
  let orgId: string;
  let propertyId: string;
  let ayse: { id: string };
  let mehmet: { id: string };
  let owner: { id: string };
  let taskId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mail.sent.length = 0;
    const made = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
    orgId = made.orgId;
    propertyId = made.propertyId;
    owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "sahip-a@example.test", passwordHash: "x", role: "owner" } });
    ayse = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse-a@example.test", passwordHash: "x", role: "staff" } });
    mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet-a@example.test", passwordHash: "x", role: "staff" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: "sahip-a@example.test", name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    const prev = await prisma.reservation.create({
      data: { propertyId, guestName: "Önceki", arrivalDate: dayDate(addNights(TODAY, -2)), departureDate: dayDate(TODAY), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Yeni Misafir", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    taskId = (
      await prisma.task.create({
        data: { propertyId, reservationId: prev.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(TODAY) },
      })
    ).id;
  });

  it("atanmamış satırdan atama (ön şart boş) → yazılır, atanan kişiye 'Yeni Görev' e-postası gider (pano ile aynı yan etki)", async () => {
    const res = await patch(taskId, { assignedToId: ayse.id, expectAssignedToId: "" });
    expect(res.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId).toBe(ayse.id);
    expect(mail.sent.map((m) => m.to)).toContain("ayse-a@example.test");
  });

  it("🚨 bayat satır: bu arada başkasına atanmış → 409 assignee_changed, atama DEĞİŞMEZ, e-posta yok", async () => {
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: mehmet.id } });
    const res = await patch(taskId, { assignedToId: ayse.id, expectAssignedToId: "" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("assignee_changed");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId).toBe(mehmet.id);
    expect(mail.sent).toHaveLength(0);
  });

  it("🚨 iş başladı / onay bekliyor / bitti → 409 task_moved_on, temizlikçi işin ortasında düşmez", async () => {
    for (const status of ["in_progress", "awaiting_review", "done"]) {
      await prisma.task.update({ where: { id: taskId }, data: { status, assignedToId: mehmet.id } });
      const res = await patch(taskId, { assignedToId: ayse.id, expectAssignedToId: mehmet.id });
      expect(res.status, status).toBe(409);
      expect((await res.json()).code).toBe("task_moved_on");
      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(row.assignedToId).toBe(mehmet.id);
      expect(row.status).toBe(status);
    }
    expect(mail.sent).toHaveLength(0);
  });

  it("'Yapılamıyor' görevi başkasına atama (ön şart tutar) → 'Yapılacak'a döner (var olan kural)", async () => {
    await prisma.task.update({ where: { id: taskId }, data: { status: "blocked", assignedToId: mehmet.id } });
    const res = await patch(taskId, { assignedToId: ayse.id, expectAssignedToId: mehmet.id });
    expect(res.status).toBe(200);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.assignedToId).toBe(ayse.id);
    expect(row.status).toBe("todo");
  });

  it("KONTROL: pano (ön şartsız) bugünkü gibi — başlamış görevi de yeniden atayabilir", async () => {
    await prisma.task.update({ where: { id: taskId }, data: { status: "in_progress", assignedToId: mehmet.id } });
    const res = await patch(taskId, { assignedToId: ayse.id });
    expect(res.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId).toBe(ayse.id);
  });

  it("atamasız ön şart reddedilir (400); personel ön şartla atayamaz (403)", async () => {
    expect((await patch(taskId, { expectAssignedToId: "" })).status).toBe(400);
    session = { userId: ayse.id, organizationId: orgId, role: "staff", email: "ayse-a@example.test", name: "Ayşe", sessionEpoch: 0 } as SessionPayload;
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: ayse.id } });
    expect((await patch(taskId, { assignedToId: mehmet.id, expectAssignedToId: ayse.id })).status).toBe(403);
  });

  it("yükleyici: atanmamış başlanmamış temizlik satırına 'Birini atayın', atanmış satıra kişi kimliğiyle 'Değiştirin'", async () => {
    const first = await loadArrivalReadiness(orgId, new Date());
    const f1 = first.rows[0]!.readiness.factors.find((f) => f.key === "cleaning")!;
    expect(f1.assign).toEqual({ taskId, expectAssigneeId: null, mode: "assign" });
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: ayse.id } });
    const second = await loadArrivalReadiness(orgId, new Date());
    const f2 = second.rows[0]!.readiness.factors.find((f) => f.key === "cleaning")!;
    expect(f2.assign).toEqual({ taskId, expectAssigneeId: ayse.id, mode: "change" });
    await prisma.task.update({ where: { id: taskId }, data: { status: "done" } });
    const third = await loadArrivalReadiness(orgId, new Date());
    expect(third.rows[0]!.readiness.factors.find((f) => f.key === "cleaning")?.assign).toBeUndefined();
  });
});
