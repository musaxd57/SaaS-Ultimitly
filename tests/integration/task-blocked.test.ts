import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// "Yapamıyorum" KALDIRILDI (kurucu 11-13: "gereksiz, ucuz bir düğme"; yerine yedek temizlikçi — docs/TASARIM-2026-11-13-temizlikci-akisi-
// whatsapp-yedek.md). Yeni "Yapılamıyor" YAZILAMAZ (400; e-posta yok). ESKİ veride kalmış "Yapılamıyor" görevi okunur (Girişler'de ENGEL),
// ev sahibi başka birine atayınca "Yapılacak"a döner. Kurucu 11-13: ev sahibinin yeniden ataması ve eski "Yapılamıyor" kaydı "iş başladı"
// sayılmaz → görev Girişler'den yine atanabilir; iptal ONARIMININ silme kümesi (geniş tanım) değişmedi.
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
import { UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE } from "@/lib/tasks/cancelled-leftovers";
import { todayKey, addNights } from "@/modules/availability/core";

const TODAY = todayKey(new Date(), "Europe/Istanbul");
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);

function patch(id: string, body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

describe("görev — 'Yapamıyorum' kaldırıldı; eski 'Yapılamıyor' verisi", () => {
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
  /** Eski veride kalmış "Yapılamıyor" (düğme artık yok — veritabanına doğrudan, eski kodun yazdığı biçimde). */
  async function legacyBlocked(note: string | null = "hastayım") {
    await prisma.task.update({ where: { id: taskId }, data: { status: "blocked" } });
    await prisma.taskUpdate.create({ data: { taskId, userId: ayse.id, status: "blocked", note } });
  }

  it("🚨 yeni 'Yapılamıyor' YAZILAMAZ: atanan personel de, sahip de (kendine atalı görevde bile) → 400; durum, kayıt, e-posta yok", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    asStaff(ayse);
    expect((await patch(taskId, { status: "blocked", note: "hastayım" })).status).toBe(400);
    asOwner();
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: owner.id } });
    expect((await patch(taskId, { status: "blocked" })).status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("todo");
    expect(await prisma.taskUpdate.count({ where: { taskId } })).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent).toHaveLength(0);
    // KONTROL: öteki durumlar yazılır (aşırı uygulama yok).
    expect((await patch(taskId, { status: "in_progress" })).status).toBe(200);
  });

  it("eski 'Yapılamıyor' görevi Girişler'de ENGEL satırı olarak okunur (kim · ne zaman · neden)", async () => {
    await legacyBlocked("hastayım");
    const { rows } = await loadArrivalReadiness(orgId, new Date());
    const cleaning = rows[0].readiness.factors.find((f) => f.key === "cleaning")!;
    expect(cleaning.state).toBe("blocking");
    expect(cleaning.label).toMatch(/^Temizlik yapılamıyor · Ayşe · \d{2}:\d{2} — "hastayım"$/);
    expect(rows[0].readiness.overall).toBe("not_ready");
  });

  it("🚨 ev sahibi eski 'Yapılamıyor' görevi başka birine atayınca durum 'Yapılacak'a döner (kim / ne zaman kayıtlı)", async () => {
    await legacyBlocked();
    asOwner();
    expect((await patch(taskId, { assignedToId: mehmet.id })).status).toBe(200);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ status: "todo", assignedToId: mehmet.id });
    const last = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(last).toMatchObject({ status: "todo", userId: owner.id });
  });

  it("🚨 kurucu 11-13: yeniden atanan görev Girişler'den YİNE atanabilir — ev sahibinin yeniden ataması ve eski 'Yapılamıyor' kaydı iş sayılmaz", async () => {
    await legacyBlocked();
    asOwner();
    expect((await patch(taskId, { assignedToId: mehmet.id })).status).toBe(200);
    // Mehmet de gelemeyecek: ev sahibi Girişler'den (satırın gördüğü atanan = Mehmet) Ayşe'ye geri verir.
    expect((await patch(taskId, { assignedToId: ayse.id, expectAssignedToId: mehmet.id })).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId).toBe(ayse.id);
    // Girişler satırı da atama düğmesini sunar (yükleyicinin "başladı" izi rotanın kilitli kararıyla aynı dar tanım).
    const { rows } = await loadArrivalReadiness(orgId, new Date());
    const cleaning = rows[0].readiness.factors.find((f) => f.key === "cleaning")!;
    expect(cleaning.assign).toBeTruthy();
  });

  it("KONTROL — gerçek iş izi (personelin notu / Başladım / fotoğraf) varsa Girişler'den atanamaz (409 task_moved_on)", async () => {
    asStaff(ayse);
    expect((await patch(taskId, { note: "anahtarı aldım" })).status).toBe(200);
    asOwner();
    const res = await patch(taskId, { assignedToId: mehmet.id, expectAssignedToId: ayse.id });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("task_moved_on");
  });

  it("🚨 iptal ONARIMININ silme kümesi DEĞİŞMEDİ: ev sahibinin yeniden atama kaydı olan görev onarımda korunur (geniş tanım)", async () => {
    await legacyBlocked(null);
    asOwner();
    await patch(taskId, { assignedToId: mehmet.id });
    expect(await prisma.task.count({ where: { id: taskId, ...UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE } })).toBe(0);
  });

  it("Opus 11-06 N1: eski 'Yapılamıyor' görev 'Atanmadı'ya alınır (boş kimlik) → 200, atanmamış, durum 'Yapılacak'", async () => {
    await legacyBlocked();
    asOwner();
    expect((await patch(taskId, { assignedToId: "" })).status).toBe(200);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ assignedToId: null, status: "todo" });
  });

  it("KONTROL — aynı kişiye yeniden 'atama' (değişiklik yok) eski 'Yapılamıyor'u kapatmaz", async () => {
    await legacyBlocked();
    asOwner();
    await patch(taskId, { assignedToId: ayse.id });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("blocked");
  });

  it("🚨 yeni görev 'Yapılamıyor' durumunda AÇILAMAZ (400); KONTROL 'Yapılacak' açılır", async () => {
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

  it("eski 'Yapılamıyor' bağlı misafir sözünü KAPATMAZ (iş bitmedi)", async () => {
    const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "G", channel: "airbnb" } });
    const c = await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: conv.id, kind: "cleaning", dueAt: dayDate(TODAY), taskId } });
    await legacyBlocked();
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("open");
  });
});
