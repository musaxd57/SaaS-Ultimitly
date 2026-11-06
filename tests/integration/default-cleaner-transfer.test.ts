import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// K-1 (kurucu / Codex 11-06): temizlikçi değişince "tek bir toplu onayla her şey taşınmamalı". Ev sahibi listeden SEÇER (`moveTaskIds`);
// sunucu adayı kendisi yeniden hesaplar (istemcinin listesi güvenilmez); başlanmış iş taşınmaz; tamamlanan / elle açılan iş listelenmez.
// Eski kişiye "Görevlendirmeniz değişti" (iş teklifi dili yok; anahtar `STAFF_NOTIFY_ENABLED`). Eski sekmeden "Başladım" sunucuda reddedilir
// (`not_assigned`, hiçbir şey yazılmaz).
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

import { createReservationTasks } from "@/lib/automation";
import { saveDefaultCleaner, transferCandidates } from "@/lib/tasks/default-cleaner";
import { notifyAssignmentRemoved } from "@/lib/tasks/notify";
import { PUT } from "@/app/api/properties/[id]/default-cleaner/route";
import { PATCH as PATCH_TASK } from "@/app/api/tasks/[id]/route";
import { todayKey, addNights } from "@/modules/availability/core";

const TODAY = todayKey(new Date(), "Europe/Istanbul");
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);
const settle = () => new Promise((r) => setTimeout(r, 60));
/** Görev açılışının (otomatik atama) e-postası arka planda düşer — kutu ancak o bittikten SONRA boşaltılır. */
const clearMail = async () => {
  await settle();
  mail.sent.length = 0;
};

function put(propertyId: string, body: unknown) {
  return PUT(
    new NextRequest(`http://localhost/api/properties/${propertyId}/default-cleaner`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: propertyId }) },
  );
}
function patchTask(id: string, body: unknown) {
  return PATCH_TASK(
    new NextRequest(`http://localhost/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("K-1 — temizlikçi değişince SEÇEREK aktarma", () => {
  let orgId: string;
  let propertyId: string;
  let ayse: { id: string };
  let mehmet: { id: string };
  let owner: { id: string; email: string };
  const asOwner = () => {
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
  };

  async function cleaningFor(arrivalOffset: number, guestName = "Deniz Yılmaz") {
    const r = await prisma.reservation.create({
      data: {
        propertyId,
        guestName,
        arrivalDate: dayDate(addNights(TODAY, arrivalOffset)),
        departureDate: dayDate(addNights(TODAY, arrivalOffset + 2)),
        status: "confirmed",
        channel: "airbnb",
      },
    });
    await createReservationTasks(r.id);
    return prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } });
  }

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mail.sent.length = 0;
    vi.unstubAllEnvs();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "sahip-k1@example.test", passwordHash: "x", role: "owner" } });
    ayse = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse-k1@example.test", passwordHash: "x", role: "staff" } });
    mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet-k1@example.test", passwordHash: "x", role: "staff" } });
    asOwner();
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 YALNIZ seçilenler taşınır; seçilmeyen aktarılabilir iş eski kişide kalır; başlanmış / başka dairenin / uydurma kimlik atlanır ve sayılır", async () => {
    const t1 = await cleaningFor(1);
    const t2 = await cleaningFor(4);
    const t3 = await cleaningFor(7);
    await prisma.task.update({ where: { id: t3.id }, data: { status: "in_progress" } });
    const otherProperty = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 3" } });
    const otherT = await prisma.task.create({
      data: { propertyId: otherProperty.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(addNights(TODAY, 2)), assignedToId: ayse.id },
    });
    const res = await put(propertyId, { userId: mehmet.id, moveTaskIds: [t1.id, t3.id, otherT.id, "uydurma-kimlik"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, userId: mehmet.id, moved: 1, skipped: 3 });
    const who = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).assignedToId;
    expect(await who(t1.id)).toBe(mehmet.id);
    expect(await who(t2.id)).toBe(ayse.id); // seçilmedi
    expect(await who(t3.id)).toBe(ayse.id); // başlanmış
    expect(await who(otherT.id)).toBe(ayse.id); // başka daire
    // Kural yine kaydedildi: sonraki temizlik yeni kişiye.
    expect(await who((await cleaningFor(10)).id)).toBe(mehmet.id);
  });

  it("'Yalnız kaydet' (boş seçim) → kural kaydedilir, HİÇBİR iş taşınmaz", async () => {
    const t1 = await cleaningFor(1);
    const res = await put(propertyId, { userId: mehmet.id, moveTaskIds: [] });
    expect(await res.json()).toEqual({ ok: true, userId: mehmet.id, moved: 0, skipped: 0 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })).assignedToId).toBe(ayse.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: (await cleaningFor(5)).id } })).assignedToId).toBe(mehmet.id);
  });

  it("rota: seçim dizi değilse / 200'den uzunsa / bozuk kimlik taşıyorsa 400 ve kural DEĞİŞMEZ", async () => {
    for (const bad of ["t1", [42], ["a b"], Array.from({ length: 201 }, (_, i) => `t${i}`)]) {
      const res = await put(propertyId, { userId: mehmet.id, moveTaskIds: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).fields).toEqual({ moveTaskIds: "Geçersiz görev listesi." });
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: (await cleaningFor(1)).id } })).assignedToId).toBe(ayse.id);
  });

  it("🚨 aktarma listesi: aktarılabilir = sunucunun GERÇEKTEN taşıyacağı küme ('Yapılamıyor' dahil); başlanmışlar ayrı; tamamlanan / elle / geçmiş / başka kişi yok", async () => {
    const todo = await cleaningFor(1);
    const blocked = await cleaningFor(4);
    await prisma.task.update({ where: { id: blocked.id }, data: { status: "blocked" } });
    const inProgress = await cleaningFor(7);
    await prisma.task.update({ where: { id: inProgress.id }, data: { status: "in_progress" } });
    const noted = await cleaningFor(10);
    await prisma.taskUpdate.create({ data: { taskId: noted.id, userId: ayse.id, note: "anahtar bende" } });
    // Kaba sorgu süzgecini aşan biçimli işaret (boşluklu JSON): sunucu kilit altında "dokunulmuş" sayar → listede de başlanmış.
    const oddTick = await cleaningFor(13);
    await prisma.task.update({ where: { id: oddTick.id }, data: { checklistJson: '[{"label":"Çarşaf", "done": true}]' } });
    const done = await cleaningFor(16);
    await prisma.task.update({ where: { id: done.id }, data: { status: "done" } });
    await prisma.task.create({
      data: { propertyId, type: "cleaning", title: "Ara temizlik", origin: "manual", status: "todo", dueAt: dayDate(addNights(TODAY, 2)), assignedToId: ayse.id },
    });
    await prisma.task.create({
      data: { propertyId, type: "cleaning", title: "Eski", origin: "system", status: "todo", dueAt: dayDate(addNights(TODAY, -3)), assignedToId: ayse.id },
    });
    const mehmets = await cleaningFor(19);
    await prisma.task.update({ where: { id: mehmets.id }, data: { assignedToId: mehmet.id } });

    const lists = await transferCandidates(prisma, orgId, propertyId, ayse.id, new Date());
    expect(lists.movable.map((t) => t.id)).toEqual([todo.id, blocked.id]);
    expect(lists.started.map((t) => [t.id, t.status, t.touched])).toEqual([
      [inProgress.id, "in_progress", false],
      [noted.id, "todo", true],
      [oddTick.id, "todo", true],
    ]);
    // Ekranda "aktarılabilir" görünen her iş GERÇEKTEN taşınır (atlanan yok); başlanmışı da seçmek taşımaz.
    const res = await put(propertyId, { userId: mehmet.id, moveTaskIds: [...lists.movable.map((t) => t.id), oddTick.id] });
    expect(await res.json()).toMatchObject({ moved: 2, skipped: 1 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: oddTick.id } })).assignedToId).toBe(ayse.id);
  });

  it("🚨 eski kişiye 'Görevlendirmeniz değişti' YALNIZ taşınanlar için (daire · tür · gün; misafir adı yok); yeni kişiye 'Yeni Görev'", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    const t1 = await cleaningFor(1, "Deniz Yılmaz");
    await cleaningFor(4, "Deniz Yılmaz");
    await clearMail();
    await put(propertyId, { userId: mehmet.id, moveTaskIds: [t1.id] });
    await settle();
    const toAyse = mail.sent.filter((m) => m.to === "ayse-k1@example.test");
    expect(toAyse.map((m) => m.subject)).toEqual(["Görevlendirmeniz değişti: Test Property"]);
    expect(toAyse[0].html).toContain("şu işler artık sizin listenizde değil");
    expect(toAyse[0].html).toContain("Test Property · Temizlik · ");
    expect(toAyse[0].html.match(/<li /g)).toHaveLength(1);
    expect(toAyse[0].html).not.toContain("Deniz");
    expect(mail.sent.filter((m) => m.to === "mehmet-k1@example.test").map((m) => m.subject.startsWith("Yeni Görev: "))).toEqual([true]);
  });

  it("KONTROL — anahtar KAPALIYKEN eski kişiye hiçbir şey gitmez; hiçbir iş taşınmadıysa da gitmez", async () => {
    const t1 = await cleaningFor(1);
    await put(propertyId, { userId: mehmet.id, moveTaskIds: [t1.id] });
    await settle();
    expect(mail.sent).toEqual([]);
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    await cleaningFor(4);
    await clearMail();
    await put(propertyId, { userId: ayse.id, moveTaskIds: [] });
    await settle();
    expect(mail.sent).toEqual([]);
  });

  it("🚨 panodan 'Atanmadı'ya çekilen görev → eski kişiye 'Görevlendirmeniz değişti' (boş atama da 'artık sizde değil' — NULL sorgu dersi)", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    const t1 = await cleaningFor(1);
    await clearMail();
    expect((await patchTask(t1.id, { assignedToId: "" })).status).toBe(200);
    await settle();
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([["ayse-k1@example.test", "Görevlendirmeniz değişti: Test Property"]]);
  });

  it("panodan başka birine atanan görev → eskiye 'değişti', yeniye 'Yeni Görev'; kendini çıkaran yöneticiye hiçbir şey gitmez", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    const t1 = await cleaningFor(1);
    await clearMail();
    await patchTask(t1.id, { assignedToId: mehmet.id });
    await settle();
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["ayse-k1@example.test", "mehmet-k1@example.test"]);
    await patchTask(t1.id, { assignedToId: owner.id });
    await clearMail();
    await patchTask(t1.id, { assignedToId: ayse.id });
    await settle();
    expect(mail.sent.map((m) => m.to)).toEqual(["ayse-k1@example.test"]);
  });

  it("bildirim: arada GERİ atanmış görev söylenmez (kişide duruyorsa 'artık sizde değil' yazılmaz)", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    const t1 = await cleaningFor(1);
    expect(await notifyAssignmentRemoved(orgId, ayse.id, [t1.id])).toBe("skipped");
    await settle();
    expect(mail.sent.filter((m) => m.subject.startsWith("Görevlendirmeniz"))).toEqual([]);
  });

  it("Haiku 11-06: aktarma listesi sınıra takılınca bunu SÖYLER (200 satır + truncated); sınırın altında söylemez", async () => {
    const due = dayDate(addNights(TODAY, 3));
    const mk = (n: number) =>
      prisma.task.createMany({
        data: Array.from({ length: n }, (_, i) => ({ propertyId, type: "cleaning", title: `T${i}`, origin: "system", status: "todo", dueAt: due, assignedToId: ayse.id })),
      });
    await mk(200);
    let lists = await transferCandidates(prisma, orgId, propertyId, ayse.id, new Date());
    expect([lists.movable.length, lists.truncated]).toEqual([200, false]);
    await mk(1);
    lists = await transferCandidates(prisma, orgId, propertyId, ayse.id, new Date());
    expect([lists.movable.length, lists.truncated]).toEqual([200, true]);
  });

  it("Haiku 11-06: 'Görevlendirmeniz değişti' 50 satırdan fazlasını sessizce kesmez — '… ve N görev daha'", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    const due = dayDate(addNights(TODAY, 3));
    await prisma.task.createMany({
      data: Array.from({ length: 52 }, (_, i) => ({ propertyId, type: "cleaning", title: `T${i}`, origin: "system", status: "todo", dueAt: due, assignedToId: mehmet.id })),
    });
    const ids = (await prisma.task.findMany({ where: { assignedToId: mehmet.id }, select: { id: true } })).map((t) => t.id);
    expect(await notifyAssignmentRemoved(orgId, ayse.id, ids)).toBe("sent");
    await settle();
    const mailToAyse = mail.sent.find((m) => m.to === "ayse-k1@example.test")!;
    expect(mailToAyse.html.match(/<li /g)).toHaveLength(51);
    expect(mailToAyse.html).toContain("… ve 2 görev daha");
  });

  it("🚨 eski sekmeden 'Başladım': görev başkasına geçtiyse 403 `not_assigned`, durum ve geçmiş YAZILMAZ", async () => {
    const t1 = await cleaningFor(1);
    await put(propertyId, { userId: mehmet.id, moveTaskIds: [t1.id] });
    session = { userId: ayse.id, organizationId: orgId, role: "staff", email: "ayse-k1@example.test", name: "Ayşe", sessionEpoch: 0 } as SessionPayload;
    const res = await patchTask(t1.id, { status: "in_progress" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Bu görev size atanmamış.", code: "not_assigned" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe("todo");
    expect(await prisma.taskUpdate.count({ where: { taskId: t1.id, userId: ayse.id } })).toBe(0);
    // KONTROL — yeni kişi aynı işi başlatabilir.
    session = { userId: mehmet.id, organizationId: orgId, role: "staff", email: "mehmet-k1@example.test", name: "Mehmet", sessionEpoch: 0 } as SessionPayload;
    expect((await patchTask(t1.id, { status: "in_progress" })).status).toBe(200);
  });
});
