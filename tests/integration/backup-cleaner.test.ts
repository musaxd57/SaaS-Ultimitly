import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// YEDEK TEMİZLİKÇİ (kurucu 11-13: "'Yapamıyorum' kalksın, sistem yedeği önersin" · "yedek temizlikçi önerin çok mantıklı, ekle"). Tasarım
// docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md T2. Dairenin temizlikçisi kaydıyla AYNI kural satırında (`backupUserId`,
// migration'sız); temizlikçi değişince ya da "Kimse" seçilince KAYBOLMAZ; temizlikçiyle aynı kişi olamaz; kimseye iş atamaz, bildirim
// göndermez; Girişler'de kişi değişecekken (reassign / change) ön seçili gelir — hükme etkisi yok.
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

import { createReservationTasks } from "@/lib/automation";
import {
  saveDefaultCleaner,
  saveBackupCleaner,
  loadDefaultCleanerUserId,
  loadBackupCleanerUserId,
  loadBackupCleaners,
  defaultCleanerWhere,
  parseDefaultCleanerRule,
} from "@/lib/tasks/default-cleaner";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { PUT } from "@/app/api/properties/[id]/default-cleaner/route";
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

describe("yedek temizlikçi", () => {
  let orgId: string;
  let propertyId: string;
  let owner: { id: string; email: string };
  let ayse: { id: string };
  let fatma: { id: string };
  let mehmet: { id: string };

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mail.sent.length = 0;
    vi.unstubAllEnvs();
    const made = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
    orgId = made.orgId;
    propertyId = made.propertyId;
    owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "sahip-bc@example.test", passwordHash: "x", role: "owner" } });
    ayse = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse-bc@example.test", passwordHash: "x", role: "staff" } });
    fatma = await prisma.user.create({ data: { organizationId: orgId, name: "Fatma", email: "fatma-bc@example.test", passwordHash: "x", role: "staff" } });
    mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet-bc@example.test", passwordHash: "x", role: "staff" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 temizlikçi DEĞİŞİNCE yedek kaybolmaz (eski yazıcı kaydı her seferinde eziyordu)", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    expect(await saveBackupCleaner(orgId, propertyId, fatma.id)).toBe("saved");
    await saveDefaultCleaner(orgId, propertyId, mehmet.id);
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBe(mehmet.id);
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
  });

  it("🚨 temizlikçi 'Kimse' yapılınca yedek KALIR; yeni rezervasyonun temizliği yine atanmamış açılır (yedek kimseye iş atamaz)", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    await saveBackupCleaner(orgId, propertyId, fatma.id);
    await saveDefaultCleaner(orgId, propertyId, null);
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBeNull();
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Deniz", arrivalDate: dayDate(addNights(TODAY, 1)), departureDate: dayDate(addNights(TODAY, 3)), status: "confirmed", channel: "airbnb" },
    });
    await createReservationTasks(r.id);
    expect((await prisma.task.findFirstOrThrow({ where: { reservationId: r.id, type: "cleaning" } })).assignedToId).toBeNull();
  });

  it("yalnız yedek seçilmiş daire: temizlikçi yok, yedek var; ikisi de kalkınca kural satırı silinir", async () => {
    expect(await saveBackupCleaner(orgId, propertyId, fatma.id)).toBe("saved");
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBeNull();
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
    expect(await saveBackupCleaner(orgId, propertyId, null)).toBe("saved");
    expect(await prisma.automationRule.count({ where: defaultCleanerWhere(orgId, propertyId) })).toBe(0);
  });

  it("🚨 yedek temizlikçiyle AYNI kişi olamaz: yedek kaydı reddedilir; temizlikçi yedek kişiye çevrilirse yedek düşer", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    expect(await saveBackupCleaner(orgId, propertyId, ayse.id)).toBe("same_as_primary");
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBeNull();
    await saveBackupCleaner(orgId, propertyId, fatma.id);
    await saveDefaultCleaner(orgId, propertyId, fatma.id);
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBeNull();
    // Saklı kayıt da temiz (okuma süzgeci yazmadaki eksikliği gizlemesin).
    const row = await prisma.automationRule.findFirstOrThrow({ where: defaultCleanerWhere(orgId, propertyId) });
    expect(JSON.parse(row.actionJson)).toEqual({ userId: fatma.id });
  });

  it("yedek kaydı temizlikçiyi DEĞİŞTİRMEZ; başka işletmenin kişisi / mülkü reddedilir", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    await saveBackupCleaner(orgId, propertyId, fatma.id);
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBe(ayse.id);
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci-bc@example.test", passwordHash: "x", role: "staff" } });
    expect(await saveBackupCleaner(orgId, propertyId, stranger.id)).toBe("user_not_found");
    expect(await saveBackupCleaner(orgId, other.propertyId, fatma.id)).toBe("property_not_found");
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
  });

  it("🚨 kayıtta başka işletmenin / silinmiş kişisi duruyorsa (elle bozulmuş satır) yedek YOK sayılır — tekli ve toplu okuma aynı", async () => {
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci2-bc@example.test", passwordHash: "x", role: "staff" } });
    await prisma.automationRule.create({
      data: { ...defaultCleanerWhere(orgId, propertyId), name: "x", actionJson: JSON.stringify({ userId: ayse.id, backupUserId: stranger.id }), isEnabled: true },
    });
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBeNull();
    expect((await loadBackupCleaners(prisma, orgId, [propertyId])).size).toBe(0);
    await prisma.automationRule.deleteMany({ where: defaultCleanerWhere(orgId, propertyId) });
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    await saveBackupCleaner(orgId, propertyId, mehmet.id);
    await prisma.user.delete({ where: { id: mehmet.id } });
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBeNull();
    expect((await loadBackupCleaners(prisma, orgId, [propertyId])).size).toBe(0);
  });

  it("toplu okuma: her daire kendi yedeği; başka işletmenin kuralı ve etkin olmayan kural okunmaz", async () => {
    const second = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 7" } });
    await saveBackupCleaner(orgId, propertyId, fatma.id);
    await saveBackupCleaner(orgId, second.id, mehmet.id);
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci3-bc@example.test", passwordHash: "x", role: "staff" } });
    await saveBackupCleaner(other.orgId, other.propertyId, stranger.id);
    const map = await loadBackupCleaners(prisma, orgId, [propertyId, second.id, other.propertyId]);
    expect(Object.fromEntries(map)).toEqual({ [propertyId]: fatma.id, [second.id]: mehmet.id });
    await prisma.automationRule.updateMany({ where: defaultCleanerWhere(orgId, second.id), data: { isEnabled: false } });
    expect([...(await loadBackupCleaners(prisma, orgId, [propertyId, second.id])).keys()]).toEqual([propertyId]);
  });

  it("aynı daire için iki kayıt (elle bozulmuş) → tekli ve toplu okuma AYNI satırı seçer: en son güncellenen", async () => {
    await prisma.automationRule.create({
      data: { ...defaultCleanerWhere(orgId, propertyId), name: "eski", actionJson: JSON.stringify({ userId: ayse.id, backupUserId: mehmet.id }), isEnabled: true, updatedAt: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.automationRule.create({
      data: { ...defaultCleanerWhere(orgId, propertyId), name: "yeni", actionJson: JSON.stringify({ userId: ayse.id, backupUserId: fatma.id }), isEnabled: true },
    });
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
    expect((await loadBackupCleaners(prisma, orgId, [propertyId])).get(propertyId)).toBe(fatma.id);
  });

  it("saklı biçim: bozuk / yabancı alan = yok; yedek temizlikçiyle aynıysa okunurken de elenir", () => {
    expect(parseDefaultCleanerRule(null)).toEqual({ userId: null, backupUserId: null });
    expect(parseDefaultCleanerRule("{bozuk")).toEqual({ userId: null, backupUserId: null });
    expect(parseDefaultCleanerRule(JSON.stringify({ userId: "u1", backupUserId: "u2" }))).toEqual({ userId: "u1", backupUserId: "u2" });
    expect(parseDefaultCleanerRule(JSON.stringify({ userId: "u1", backupUserId: "u1" }))).toEqual({ userId: "u1", backupUserId: null });
    expect(parseDefaultCleanerRule(JSON.stringify({ userId: null, backupUserId: "u2" }))).toEqual({ userId: null, backupUserId: "u2" });
    expect(parseDefaultCleanerRule(JSON.stringify({ userId: "u1", backupUserId: "a b" }))).toEqual({ userId: "u1", backupUserId: null });
  });

  it("rota: personel 403; karışık gövde 400; temizlikçiyle aynı kişi 400; başka işletmenin kişisi 400; kayıt denetimli (değer yok), e-posta yok", async () => {
    await saveDefaultCleaner(orgId, propertyId, ayse.id);
    vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
    session = { userId: ayse.id, organizationId: orgId, role: "staff", email: "ayse-bc@example.test", name: "Ayşe", sessionEpoch: 0 } as SessionPayload;
    expect((await put(propertyId, { backupUserId: fatma.id })).status).toBe(403);
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    expect((await put(propertyId, { backupUserId: fatma.id, userId: mehmet.id })).status).toBe(400);
    expect((await put(propertyId, { backupUserId: fatma.id, moveTaskIds: [] })).status).toBe(400);
    expect((await put(propertyId, { backupUserId: 42 })).status).toBe(400);
    const same = await put(propertyId, { backupUserId: ayse.id });
    expect(same.status).toBe(400);
    expect((await same.json()).fields.backupUserId).toMatch(/farklı biri/);
    const other = await makeOrgWithProperty();
    const stranger = await prisma.user.create({ data: { organizationId: other.orgId, name: "Yabancı", email: "yabanci4-bc@example.test", passwordHash: "x", role: "staff" } });
    expect((await put(propertyId, { backupUserId: stranger.id })).status).toBe(400);
    expect((await put(other.propertyId, { backupUserId: fatma.id })).status).toBe(404);
    const ok = await put(propertyId, { backupUserId: fatma.id });
    expect(ok.status).toBe(200);
    expect(await loadBackupCleanerUserId(prisma, orgId, propertyId)).toBe(fatma.id);
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBe(ayse.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.backup_cleaner_set" } });
    expect(audit.metadataJson).toContain("backupCleaner");
    expect(audit.metadataJson).not.toContain(fatma.id);
    expect((await put(propertyId, { backupUserId: null })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "property.backup_cleaner_cleared" } })).toBe(1);
    expect(await loadDefaultCleanerUserId(prisma, orgId, propertyId)).toBe(ayse.id);
    expect(mail.sent).toHaveLength(0);
  });

  describe("Girişler önerisi", () => {
    let taskId: string;
    beforeEach(async () => {
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
    const cleaningOf = async () => (await loadArrivalReadiness(orgId, new Date())).rows[0]!.readiness.factors.find((f) => f.key === "cleaning")!;

    it("🚨 atanmış, başlanmamış temizlik + yedek → 'Değiştirin' kutusunda yedek ön seçili; hüküm aynı", async () => {
      const before = await cleaningOf();
      expect(before.assign).toEqual({ taskId, expectAssigneeId: ayse.id, mode: "change" });
      await saveDefaultCleaner(orgId, propertyId, ayse.id);
      await saveBackupCleaner(orgId, propertyId, fatma.id);
      const after = await cleaningOf();
      expect(after.assign).toEqual({ taskId, expectAssigneeId: ayse.id, mode: "change", suggestUserId: fatma.id });
      expect({ state: after.state, label: after.label }).toEqual({ state: before.state, label: before.label });
    });

    it("eski veride kalmış 'Yapılamıyor' → 'Başkasına atayın'da yedek ön seçili", async () => {
      await prisma.task.update({ where: { id: taskId }, data: { status: "blocked" } });
      await prisma.taskUpdate.create({ data: { taskId, userId: ayse.id, status: "blocked", note: "hastayım" } });
      await saveBackupCleaner(orgId, propertyId, fatma.id);
      expect((await cleaningOf()).assign).toEqual({ taskId, expectAssigneeId: ayse.id, mode: "reassign", suggestUserId: fatma.id });
    });

    it("KONTROL — iş yedekteyse öneri yok; atanmamış görevde ('Birini atayın') öneri yok; iş başladıysa kutu hiç yok", async () => {
      await saveBackupCleaner(orgId, propertyId, fatma.id);
      await prisma.task.update({ where: { id: taskId }, data: { assignedToId: fatma.id } });
      expect((await cleaningOf()).assign).toEqual({ taskId, expectAssigneeId: fatma.id, mode: "change" });
      await prisma.task.update({ where: { id: taskId }, data: { assignedToId: null } });
      expect((await cleaningOf()).assign).toEqual({ taskId, expectAssigneeId: null, mode: "assign" });
      await prisma.task.update({ where: { id: taskId }, data: { assignedToId: ayse.id, status: "in_progress" } });
      await prisma.taskUpdate.create({ data: { taskId, userId: ayse.id, status: "in_progress" } });
      expect((await cleaningOf()).assign).toBeUndefined();
    });
  });
});
