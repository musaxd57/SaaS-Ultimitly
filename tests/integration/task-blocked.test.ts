import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Kurucu 11-05 gece — "Yapamıyorum / Sorun bildir": atanan kişi işi yapamayacağını bildirir. Görev SİLİNMEZ, BİTMİŞ SAYILMAZ; durum
// "Yapılamıyor" (blocked) olur, ev sahibi görür; ev sahibi başka birine atayınca "Yapılacak"a döner. Ev sahibine e-posta YALNIZ
// `STAFF_NOTIFY_ENABLED=1` iken (ilk gönderim kurucuyla). Tasarım: docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md §2.5.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; html: string }[] }));
vi.mock("@/lib/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailService: {
      ...actual.emailService,
      sendReporting: vi.fn(async (to: string, subject: string, html: string) => {
        mail.sent.push({ to, subject, html });
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

function patch(id: string, body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

describe("görev — 'Yapamıyorum'", () => {
  let orgId: string;
  let propertyId: string;
  let ayse: { id: string; name: string };
  let mehmet: { id: string; name: string };
  let owner: { id: string; email: string };
  let taskId: string;
  const asStaff = (u: { id: string; name: string }) =>
    (session = { userId: u.id, organizationId: orgId, role: "staff", email: `${u.id}@example.test`, name: u.name, sessionEpoch: 0 } as SessionPayload);
  const asOwner = () => (session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload);

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mail.sent.length = 0;
    vi.unstubAllEnvs();
    const made = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
    orgId = made.orgId;
    propertyId = made.propertyId;
    owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "sahip@example.test", passwordHash: "x", role: "owner" } });
    ayse = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse-b@example.test", passwordHash: "x", role: "staff" } });
    mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet-b@example.test", passwordHash: "x", role: "staff" } });
    const prev = await prisma.reservation.create({
      data: { propertyId, guestName: "Önceki", arrivalDate: dayDate(addNights(TODAY, -2)), departureDate: dayDate(TODAY), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Yeni Misafir", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 2)), status: "confirmed", channel: "airbnb" },
    });
    taskId = (
      await prisma.task.create({
        data: { propertyId, reservationId: prev.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(TODAY), assignedToId: ayse.id },
      })
    ).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 atanan kişi 'Yapamıyorum' der → durum Yapılamıyor, görev SİLİNMEZ, neden zaman çizelgesinde; 'Girişler'de ENGEL satırı", async () => {
    asStaff(ayse);
    expect((await patch(taskId, { status: "blocked", note: "hastayım" })).status).toBe(200);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("blocked");
    expect(task.assignedToId).toBe(ayse.id);
    const upd = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId, status: "blocked" } });
    expect(upd).toMatchObject({ userId: ayse.id, note: "hastayım" });
    const { rows } = await loadArrivalReadiness(orgId, new Date());
    const cleaning = rows[0].readiness.factors.find((f) => f.key === "cleaning")!;
    expect(cleaning.state).toBe("blocking");
    expect(cleaning.label).toMatch(/^Temizlik yapılamıyor · Ayşe · \d{2}:\d{2} — "hastayım"$/);
    expect(cleaning.missing).toBe("başka birine atama");
    expect(rows[0].readiness.overall).toBe("not_ready");
  });

  it("KONTROL — başkasının görevini 'Yapılamıyor' yapamaz (403, durum aynı)", async () => {
    asStaff(mehmet);
    expect((await patch(taskId, { status: "blocked" })).status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("todo");
  });

  it("🚨 ev sahibi 'Yapılamıyor' görevi başka birine atayınca durum 'Yapılacak'a döner (kim / ne zaman kayıtlı)", async () => {
    asStaff(ayse);
    await patch(taskId, { status: "blocked", note: "hastayım" });
    asOwner();
    expect((await patch(taskId, { assignedToId: mehmet.id })).status).toBe(200);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ status: "todo", assignedToId: mehmet.id });
    const last = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(last).toMatchObject({ status: "todo", userId: owner.id });
  });

  it("KONTROL — yeniden atamada açıkça durum verilirse o durum yazılır; 'Yapılamıyor' olmayan görevin durumu atamayla değişmez", async () => {
    asStaff(ayse);
    await patch(taskId, { status: "blocked" });
    asOwner();
    await patch(taskId, { assignedToId: mehmet.id, status: "in_progress" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("in_progress");
    await patch(taskId, { assignedToId: ayse.id });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("in_progress");
  });

  it("KONTROL — aynı kişiye yeniden 'atama' (değişiklik yok) 'Yapılamıyor'u kapatmaz", async () => {
    asStaff(ayse);
    await patch(taskId, { status: "blocked" });
    asOwner();
    await patch(taskId, { assignedToId: ayse.id });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("blocked");
  });

  it("🚨 bildirim: anahtar AÇIKKEN sahip / yöneticilere e-posta (bildirene değil; misafir adı yok); KAPALIYKEN hiçbir şey gitmez", async () => {
    asStaff(ayse);
    await patch(taskId, { status: "blocked", note: "hastayım" });
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent).toHaveLength(0); // varsayılan KAPALI

    await prisma.task.update({ where: { id: taskId }, data: { status: "todo" } });
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    await patch(taskId, { status: "blocked", note: "hastayım" });
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent.map((m) => m.to)).toEqual([owner.email]);
    expect(mail.sent[0].subject).toBe("Görev yapılamıyor: Test Property");
    expect(mail.sent[0].html).toContain("Ayşe bu işi yapamıyor");
    expect(mail.sent[0].html).toContain("hastayım");
    expect(mail.sent[0].html).not.toContain("Önceki"); // misafir adı yok
  });

  it("'Yapılamıyor' bağlı misafir sözünü KAPATMAZ (iş bitmedi)", async () => {
    const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "G", channel: "airbnb" } });
    const c = await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: conv.id, kind: "cleaning", dueAt: dayDate(TODAY), taskId } });
    asStaff(ayse);
    await patch(taskId, { status: "blocked" });
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("open");
  });
});
