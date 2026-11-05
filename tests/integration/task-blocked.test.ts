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
import { POST as CREATE_TASK } from "@/app/api/tasks/route";
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

  it("Opus 11-06 N1: 'Yapılamıyor' görev 'Atanmadı'ya alınır (boş kimlik) → 200, atanmamış, durum 'Yapılacak'", async () => {
    asStaff(ayse);
    await patch(taskId, { status: "blocked" });
    asOwner();
    expect((await patch(taskId, { assignedToId: "" })).status).toBe(200);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ assignedToId: null, status: "todo" });
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

  it("🚨 Haiku 11-06: yönetici BAŞKASININ görevini 'Yapılamıyor' yapamaz (403, durum aynı, kayıt yok); kendisine atalı görevde diyebilir", async () => {
    asOwner();
    expect((await patch(taskId, { status: "blocked", note: "x" })).status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("todo");
    expect(await prisma.taskUpdate.count({ where: { taskId } })).toBe(0);
    // Atama değişikliğiyle birlikte de gelmez (kendine atayıp aynı anda "yapamıyorum" anlamsız).
    expect((await patch(taskId, { status: "blocked", assignedToId: owner.id })).status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId).toBe(ayse.id);
    // Kendisine atalı görevde bile "yapamıyorum" + BAŞKASINA atama aynı istekte gelmez (kart "Sahip yapamıyor" diye Mehmet'in işini gösterirdi).
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: owner.id } });
    expect((await patch(taskId, { status: "blocked", assignedToId: mehmet.id })).status).toBe(403);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: "todo", assignedToId: owner.id });
    // KONTROL — görev sahibin kendisine atalıysa diyebilir (aşırı uygulama yok).
    expect((await patch(taskId, { status: "blocked" })).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("blocked");
  });

  it("🚨 Haiku 11-06: yeni görev 'Yapılamıyor' durumunda AÇILAMAZ (400) — o durum kişinin kim / ne zaman kaydıyla gelir; KONTROL 'Yapılacak' açılır", async () => {
    asOwner();
    const create = (status: string) =>
      CREATE_TASK(
        new NextRequest("http://localhost/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId, type: "cleaning", title: "Ara temizlik", status, priority: "standard" }),
        }),
        { params: Promise.resolve({} as Record<string, never>) },
      );
    expect((await create("blocked")).status).toBe(400);
    expect(await prisma.task.count({ where: { title: "Ara temizlik" } })).toBe(0);
    expect((await create("todo")).status).toBe(201);
  });

  it("aynı kişi ikinci kez 'Yapamıyorum' derse (neden ekler) ikinci bildirim GİTMEZ — yalnız durum değişince bildirilir", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    asStaff(ayse);
    expect((await patch(taskId, { status: "blocked", note: "hastayım" })).status).toBe(200);
    expect((await patch(taskId, { status: "blocked", note: "yarın da gelemem" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent).toHaveLength(1);
    expect(await prisma.taskUpdate.count({ where: { taskId, status: "blocked" } })).toBe(2); // ikisi de zaman çizelgesinde
  });

  it("'Yapılamıyor' bağlı misafir sözünü KAPATMAZ (iş bitmedi)", async () => {
    const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "G", channel: "airbnb" } });
    const c = await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: conv.id, kind: "cleaning", dueAt: dayDate(TODAY), taskId } });
    asStaff(ayse);
    await patch(taskId, { status: "blocked" });
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("open");
  });
});

// Genel Prisma temsilcisine casus SONRAKİ testlere sızabilir → bu blok dosyanın EN SONUNDA (çalışma dersi).
describe("görev — 'Yapamıyorum' kilitli satıra göre", () => {
  it("🚨 Haiku 11-06: okuma ile yazma arasında görev BAŞKASINA atandıysa 'Yapamıyorum' yazılmaz (403; durum / kayıt yok)", async () => {
    await resetDb();
    __resetRateLimit();
    const made = await makeOrgWithProperty();
    const owner = await prisma.user.create({ data: { organizationId: made.orgId, name: "Sahip", email: "sahip-lk@example.test", passwordHash: "x", role: "owner" } });
    const ayse = await prisma.user.create({ data: { organizationId: made.orgId, name: "Ayşe", email: "ayse-lk@example.test", passwordHash: "x", role: "staff" } });
    const task = await prisma.task.create({
      data: { propertyId: made.propertyId, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", assignedToId: ayse.id },
    });
    session = { userId: owner.id, organizationId: made.orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    // Rota ilk okumada görevi HÂLÂ sahibe atalı görür (bayat okuma); veritabanında görev Ayşe'de.
    const spy = vi.spyOn(prisma.task, "findFirst").mockResolvedValueOnce({ id: task.id, assignedToId: owner.id, checklistJson: null } as never);
    try {
      expect((await patch(task.id, { status: "blocked" })).status).toBe(403);
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("todo");
    expect(await prisma.taskUpdate.count({ where: { taskId: task.id } })).toBe(0);
  });
});
