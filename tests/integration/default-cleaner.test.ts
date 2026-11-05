import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Kurucu 11-05 gece — "daireye temizlikçiyi bir kez belirleyince, sonraki temizlikler ayrıca kabul beklemeden onun iş listesine düşsün".
// Tasarım: docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md §2.1–2.2. Kural `AutomationRule`da (migration'sız); kişi
// kullanım anında doğrulanır; temizlikçi değişince eski kişideki işler YALNIZ açık soruya "Evet" denirse taşınır. Bildirim (e-posta) yalnız
// `STAFF_NOTIFY_ENABLED=1` iken.
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
import { saveDefaultCleaner, loadDefaultCleanerUserId, defaultCleanerWhere, DEFAULT_CLEANER_TRIGGER, openFutureCleaningIds } from "@/lib/tasks/default-cleaner";
import { PUT } from "@/app/api/properties/[id]/default-cleaner/route";
import { DELETE as DELETE_PROPERTY } from "@/app/api/properties/[id]/route";
import { todayKey, addNights } from "@/modules/availability/core";

const TODAY = todayKey(new Date(), "Europe/Istanbul");
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);

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

describe("dairenin temizlikçisi", () => {
  let orgId: string;
  let propertyId: string;
  let ayse: { id: string };
  let mehmet: { id: string };
  let owner: { id: string; email: string };

  async function reservation(arrivalKey: string, departureKey: string, guestName = "Deniz Yılmaz") {
    return prisma.reservation.create({
      data: { propertyId, guestName, arrivalDate: dayDate(arrivalKey), departureDate: dayDate(departureKey), status: "confirmed", channel: "airbnb" },
    });
  }

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mail.sent.length = 0;
    vi.unstubAllEnvs();
    const made = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
    orgId = made.orgId;
    propertyId = made.propertyId;
    owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "sahip-dc@example.test", passwordHash: "x", role: "owner" } });
    ayse = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse-dc@example.test", passwordHash: "x", role: "staff" } });
    mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet-dc@example.test", passwordHash: "x", role: "staff" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kural varsa yeni rezervasyonun TEMİZLİĞİ doğrudan temizlikçiye atanır (kabul adımı yok); giriş hazırlığı atanmaz", async () => {
    expect((await saveDefaultCleaner(orgId, propertyId, ayse.id)).result).toBe("saved");
    const r = await reservation(addNights(TODAY, 1), addNights(TODAY, 3));
    expect(await createReservationTasks(r.id)).toBe(2);
    const tasks = await prisma.task.findMany({ where: { reservationId: r.id }, select: { type: true, assignedToId: true, status: true } });
    expect(tasks.find((t) => t.type === "cleaning")).toMatchObject({ assignedToId: ayse.id, status: "todo" });
    expect(tasks.find((t) => t.type === "checkin_prep")!.assignedToId).toBeNull();
  });

  it("KONTROL — kural yoksa görev bugünkü gibi atanmamış açılır", async () => {
    const r = await reservation(addNights(TODAY, 1), addNights(TODAY, 3));
    await createReservationTasks(r.id);
    expect((await prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } })).assignedToId).toBeNull();
  });

  it("🚨 kural BAŞKA işletmenin kişisini gösteriyorsa (elle bozulmuş satır) atama YAPILMAZ; kişi silinmişse de", async () => {
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci-dc@example.test", passwordHash: "x", role: "staff" } });
    await prisma.automationRule.create({
      data: { ...defaultCleanerWhere(orgId, propertyId), name: "x", actionJson: JSON.stringify({ userId: stranger.id }), isEnabled: true },
    });
    const r = await reservation(addNights(TODAY, 1), addNights(TODAY, 3));
    await createReservationTasks(r.id);
    expect((await prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } })).assignedToId).toBeNull();
    // Silinen kişi
    await prisma.automationRule.deleteMany({ where: { triggerType: DEFAULT_CLEANER_TRIGGER } });
    await saveDefaultCleaner(orgId, propertyId, mehmet.id);
    await prisma.user.delete({ where: { id: mehmet.id } });
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBeNull();
  });

  it("kayıt: başka işletmenin kişisi reddedilir; başka işletmenin mülkü bulunamaz; null kuralı kaldırır", async () => {
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci2-dc@example.test", passwordHash: "x", role: "staff" } });
    expect((await saveDefaultCleaner(orgId, propertyId, stranger.id)).result).toBe("user_not_found");
    expect((await saveDefaultCleaner(orgId, other.propertyId, ayse.id)).result).toBe("property_not_found");
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    await saveDefaultCleaner(orgId, propertyId, null);
    expect(await prisma.automationRule.count({ where: defaultCleanerWhere(orgId, propertyId) })).toBe(0);
  });

  it("🚨 temizlikçi değişince 'Evet' → eski kişideki BAŞLANMAMIŞ, sistemin açtığı, gelecekteki temizlikler geçer; başlanmış / elle / geçmiş / başkasının işi KALIR", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    const r1 = await reservation(addNights(TODAY, 1), addNights(TODAY, 3), "A");
    const r2 = await reservation(addNights(TODAY, 4), addNights(TODAY, 6), "B");
    await createReservationTasks(r1.id);
    await createReservationTasks(r2.id);
    const started = await prisma.task.findFirstOrThrow({ where: { reservationId: r2.id, type: "cleaning" } });
    await prisma.taskUpdate.create({ data: { taskId: started.id, userId: ayse.id, status: "in_progress" } });
    await prisma.task.update({ where: { id: started.id }, data: { status: "in_progress" } });
    const manual = await prisma.task.create({
      data: { propertyId, type: "cleaning", title: "Ara temizlik", origin: "manual", status: "todo", dueAt: dayDate(addNights(TODAY, 2)), assignedToId: ayse.id },
    });
    const past = await prisma.task.create({
      data: { propertyId, type: "cleaning", title: "Eski", origin: "system", status: "todo", dueAt: dayDate(addNights(TODAY, -2)), assignedToId: ayse.id },
    });
    const moved = await put(propertyId, { userId: mehmet.id, moveOpen: true });
    expect(moved.status).toBe(200);
    expect((await moved.json()).moved).toBe(1);
    expect((await prisma.task.findFirstOrThrow({ where: { reservationId: r1.id, type: "cleaning" } })).assignedToId).toBe(mehmet.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: started.id } })).assignedToId).toBe(ayse.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: manual.id } })).assignedToId).toBe(ayse.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: past.id } })).assignedToId).toBe(ayse.id);
    // Sonraki rezervasyon yeni kişiye.
    const r3 = await reservation(addNights(TODAY, 7), addNights(TODAY, 9), "C");
    await createReservationTasks(r3.id);
    expect((await prisma.task.findFirstOrThrow({ where: { reservationId: r3.id, type: "cleaning" } })).assignedToId).toBe(mehmet.id);
  });

  it("🚨 Haiku 11-06: 'Evet' DOKUNULMUŞ işi taşımaz — kişinin notu / fotoğrafı ya da işaretli kontrol maddesi olan görev eski kişide kalır; sistemin notu taşımayı engellemez", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    const rs = [];
    for (let i = 0; i < 5; i++) rs.push(await reservation(addNights(TODAY, 1 + i * 3), addNights(TODAY, 3 + i * 3), `R${i}`));
    for (const r of rs) await createReservationTasks(r.id);
    const cleaningOf = (r: { id: string }) => prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } });
    const noted = await cleaningOf(rs[0]);
    await prisma.taskUpdate.create({ data: { taskId: noted.id, userId: ayse.id, status: null, note: "anahtar bende" } });
    const photo = await cleaningOf(rs[1]);
    await prisma.taskUpdate.create({ data: { taskId: photo.id, userId: ayse.id, status: null, photoUrl: "https://example.test/p.jpg" } });
    const ticked = await cleaningOf(rs[2]);
    await prisma.task.update({ where: { id: ticked.id }, data: { checklistJson: JSON.stringify([{ label: "Çarşaf", done: true }]) } });
    const systemNote = await cleaningOf(rs[3]);
    await prisma.taskUpdate.create({ data: { taskId: systemNote.id, userId: null, status: null, note: "Erken giriş onaylandı" } });
    // Beklenmedik biçimli liste: sorgu süzgeci yakalamaz, KİLİT altındaki karar dokunulmuş sayar (şüphede taşıma yok).
    const odd = await cleaningOf(rs[4]);
    await prisma.task.update({ where: { id: odd.id }, data: { checklistJson: JSON.stringify([{ label: "Çarşaf", done: "evet" }]) } });
    // Onay sorusundaki sayı (mülk sayfası) dokunulmuş işleri saymaz.
    const asked = await openFutureCleaningIds(prisma, orgId, propertyId, ayse.id, new Date());
    expect(asked).toContain(systemNote.id);
    for (const t of [noted, photo, ticked]) expect(asked).not.toContain(t.id);
    const res = await put(propertyId, { userId: mehmet.id, moveOpen: true });
    expect((await res.json()).moved).toBe(1);
    for (const t of [noted, photo, ticked, odd]) expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).assignedToId).toBe(ayse.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: systemNote.id } })).assignedToId).toBe(mehmet.id);
  });

  it("KONTROL — 'Hayır, yalnız yeniler' (moveOpen yok) → eski işler eski kişide kalır", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    const r1 = await reservation(addNights(TODAY, 1), addNights(TODAY, 3));
    await createReservationTasks(r1.id);
    expect((await put(propertyId, { userId: mehmet.id })).status).toBe(200);
    expect((await prisma.task.findFirstOrThrow({ where: { reservationId: r1.id, type: "cleaning" } })).assignedToId).toBe(ayse.id);
  });

  it("rota: personel 403; başka işletmenin mülkü 404; başka işletmenin kişisi 400; denetim kaydı alan adıyla (değer yok)", async () => {
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci3-dc@example.test", passwordHash: "x", role: "staff" } });
    session = { userId: ayse.id, organizationId: orgId, role: "staff", email: "ayse-dc@example.test", name: "Ayşe", sessionEpoch: 0 } as SessionPayload;
    expect((await put(propertyId, { userId: ayse.id })).status).toBe(403);
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    expect((await put(other.propertyId, { userId: ayse.id })).status).toBe(404);
    expect((await put(propertyId, { userId: stranger.id })).status).toBe(400);
    expect((await put(propertyId, { userId: 42 })).status).toBe(400);
    expect((await put(propertyId, { userId: ayse.id })).status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.default_cleaner_set" } });
    expect(audit.metadataJson).toContain("defaultCleaner");
    expect(audit.metadataJson).not.toContain(ayse.id);
  });

  it("mülk silinince dairenin temizlikçisi kuralı da silinir (sahipsiz kural kalmaz)", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    const res = await DELETE_PROPERTY(new NextRequest(`http://localhost/api/properties/${propertyId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(res.status).toBeLessThan(300);
    expect(await prisma.automationRule.count({ where: { triggerType: DEFAULT_CLEANER_TRIGGER } })).toBe(0);
  });

  it("🚨 bildirim: anahtar AÇIKKEN otomatik atanan kişiye 'Yeni Görev' e-postası (misafir adı YOK); KAPALIYKEN hiçbir şey gitmez", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    const r1 = await reservation(addNights(TODAY, 1), addNights(TODAY, 3), "Deniz Yılmaz");
    await createReservationTasks(r1.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent).toHaveLength(0);
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    const r2 = await reservation(addNights(TODAY, 4), addNights(TODAY, 6), "Deniz Yılmaz");
    await createReservationTasks(r2.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent.map((m) => m.to)).toEqual(["ayse-dc@example.test"]);
    expect(mail.sent[0].subject.startsWith("Yeni Görev: ")).toBe(true);
    expect(mail.sent[0].subject).not.toContain("Deniz");
    expect(mail.sent[0].html).not.toContain("Deniz");
  });

  it("🚨 Haiku 11-06: aynı kişiye saatte en çok 10 otomatik atama e-postası (toplu takvim / dosya); görevlerin HEPSİ yine atanır", async () => {
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    for (let i = 0; i < 12; i++) {
      const r = await reservation(addNights(TODAY, 1 + i * 2), addNights(TODAY, 2 + i * 2), `R${i}`);
      await createReservationTasks(r.id);
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent.filter((m) => m.to === "ayse-dc@example.test")).toHaveLength(10);
    expect(await prisma.task.count({ where: { type: "cleaning", assignedToId: ayse.id } })).toBe(12);
  });
});
