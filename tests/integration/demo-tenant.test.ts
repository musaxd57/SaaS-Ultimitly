import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { buildDemoDataset } from "@/lib/demo-tenant/dataset";
import { applyDemoTenant, DemoRefusedError, preflightDemoTenant } from "@/lib/demo-tenant/apply-core";
import { DEMO_LOGIN_EMAIL, DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { PROVIDER_MESSAGEABLE_RESERVATION_WHERE, PROVIDER_THREAD_CONVERSATION_WHERE } from "@/lib/channels/capability";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { findUpcomingConflicts } from "@/modules/availability/conflicts";
import { createReservationTasks } from "@/lib/automation";

// ---------------------------------------------------------------------------
// DEMO HESABI — gerçek PostgreSQL. Kiracı sınırı DAVRANIŞSAL (komşu org'ların satırları önce/sonra
// birebir), yenileme idempotent, reddetmelerde SIFIR yazma, hiçbir satır kanaldan mesajlanabilir /
// otomatik gönderilebilir sayılmaz, panel yalnız tasarlanan satırları gösterir.
// ---------------------------------------------------------------------------

const NOW = new Date();
const PW_HASH = bcrypt.hashSync("demo-sifre-uzun-ve-rastgele-xyz", 4);
const STAFF_HASH = bcrypt.hashSync("kullanilmayan", 4);

async function snapshotOrg(orgId: string): Promise<string> {
  const [org, users, props, res, convs, msgs, tasks, kb, tpl] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.user.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" } }),
    prisma.property.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" } }),
    prisma.reservation.findMany({ where: { property: { organizationId: orgId } }, orderBy: { id: "asc" } }),
    prisma.conversation.findMany({ where: { property: { organizationId: orgId } }, orderBy: { id: "asc" } }),
    prisma.message.findMany({ where: { conversation: { property: { organizationId: orgId } } }, orderBy: { id: "asc" } }),
    prisma.task.findMany({ where: { property: { organizationId: orgId } }, orderBy: { id: "asc" } }),
    prisma.knowledgeBaseItem.findMany({ where: { property: { organizationId: orgId } }, orderBy: { id: "asc" } }),
    prisma.messageTemplate.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" } }),
  ]);
  return createHash("sha256").update(JSON.stringify({ org, users, props, res, convs, msgs, tasks, kb, tpl })).digest("hex");
}

async function neighbour() {
  const n = await makeOrgWithProperty();
  await prisma.reservation.create({
    data: { propertyId: n.propertyId, guestName: "Komşu Misafir", arrivalDate: NOW, departureDate: new Date(NOW.getTime() + 2 * 86_400_000) },
  });
  const c = await prisma.conversation.create({ data: { propertyId: n.propertyId, guestIdentifier: "Komşu Misafir" } });
  await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", senderName: "Komşu Misafir", body: "Merhaba" } });
  await prisma.knowledgeBaseItem.create({ data: { propertyId: n.propertyId, title: "Wi-Fi", content: "Etikette.", category: "wifi" } });
  await prisma.messageTemplate.create({ data: { organizationId: n.orgId, category: "welcome", title: "Hoş geldin", body: "Merhaba" } });
  return n;
}

describe("demo hesabı — uygulama", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 kiracı sınırı: iki komşu org'un TÜM satırları önce/sonra birebir aynı", async () => {
    const a = await neighbour();
    const b = await neighbour();
    const before = [await snapshotOrg(a.orgId), await snapshotOrg(b.orgId)];
    const ds = buildDemoDataset({ now: NOW });
    const res = await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    expect(res.written.properties).toBe(12);
    expect([await snapshotOrg(a.orgId), await snapshotOrg(b.orgId)]).toEqual(before);
    // Yenileme de komşuya dokunmaz.
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: null, staffPasswordHash: STAFF_HASH });
    expect([await snapshotOrg(a.orgId), await snapshotOrg(b.orgId)]).toEqual(before);
  });

  it("veri kümesi eksiksiz yazılır; inceleme hesabı yönetici (sahip DEĞİL), e-postası doğrulanmış", async () => {
    const ds = buildDemoDataset({ now: NOW });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    const counts = await Promise.all([
      prisma.property.count({ where: { organizationId: DEMO_ORG_ID } }),
      prisma.reservation.count({ where: { property: { organizationId: DEMO_ORG_ID } } }),
      prisma.conversation.count({ where: { property: { organizationId: DEMO_ORG_ID } } }),
      prisma.message.count({ where: { conversation: { property: { organizationId: DEMO_ORG_ID } } } }),
      prisma.task.count({ where: { property: { organizationId: DEMO_ORG_ID } } }),
      prisma.knowledgeBaseItem.count({ where: { property: { organizationId: DEMO_ORG_ID }, reviewState: "approved", source: "host_manual" } }),
      prisma.messageTemplate.count({ where: { organizationId: DEMO_ORG_ID } }),
    ]);
    expect(counts).toEqual([12, ds.reservations.length, ds.conversations.length, ds.messages.length, ds.tasks.length, ds.kbItems.length, ds.templates.length]);
    const reviewer = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_LOGIN_EMAIL } });
    expect(reviewer).toMatchObject({ organizationId: DEMO_ORG_ID, role: "manager" });
    expect(reviewer.emailVerifiedAt).not.toBeNull();
    expect(await bcrypt.compare("demo-sifre-uzun-ve-rastgele-xyz", reviewer.passwordHash)).toBe(true);
    // Abonelik satırı YOK (tam erişim, deneme bandı/e-postası yok); canlı bağlantı YOK.
    expect(await prisma.subscription.count({ where: { organizationId: DEMO_ORG_ID } })).toBe(0);
    expect(await prisma.channelConnection.count({ where: { organizationId: DEMO_ORG_ID } })).toBe(0);
    expect(await prisma.calendarSource.count({ where: { property: { organizationId: DEMO_ORG_ID } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: DEMO_ORG_ID, action: "demo_tenant.refreshed" } })).toBe(1);
  });

  it("🚨 hiçbir demo rezervasyonu/konuşması kanaldan MESAJLANABİLİR sayılmaz (otomatik gönderim yok)", async () => {
    await applyDemoTenant(prisma, buildDemoDataset({ now: NOW }), { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    expect(await prisma.reservation.count({ where: { AND: [PROVIDER_MESSAGEABLE_RESERVATION_WHERE, { property: { organizationId: DEMO_ORG_ID } }] } })).toBe(0);
    expect(await prisma.conversation.count({ where: { AND: [PROVIDER_THREAD_CONVERSATION_WHERE, { property: { organizationId: DEMO_ORG_ID } }] } })).toBe(0);
    // KONTROL: aynı sorgu gerçek bir kanal satırını görür (vakumlu değil).
    const n = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: { propertyId: n.propertyId, guestName: "X", arrivalDate: NOW, departureDate: NOW, channel: "airbnb", sourceReference: "kanal-1" },
    });
    expect(await prisma.reservation.count({ where: PROVIDER_MESSAGEABLE_RESERVATION_WHERE })).toBe(1);
  });

  it("panel yalnız tasarlanan satırları gösterir: iki cevapsız misafir; çakışma/bozuk besleme YOK", async () => {
    const ds = buildDemoDataset({ now: NOW });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    const items = await findAttentionItems(DEMO_ORG_ID, { now: NOW });
    const fresh = ds.conversations.filter((c) => c.status === "new").map((c) => c.id);
    expect(items).toHaveLength(fresh.length);
    for (const i of items) expect(["unanswered_aging", "departing_unanswered"]).toContain(i.kind);
    expect(items.map((i) => fresh.find((id) => i.href.includes(id)))).not.toContain(undefined);
    expect(await findUpcomingConflicts(DEMO_ORG_ID, { now: NOW })).toEqual([]);
  });

  it("görevler ürünün kendi görev üreticisiyle birebir: hiçbir rezervasyon için EKSİK görev yok", async () => {
    const ds = buildDemoDataset({ now: NOW });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    let created = 0;
    for (const r of ds.reservations) created += await createReservationTasks(r.id);
    expect(created).toBe(0);
  });

  it("yenileme idempotent ve inceleme ekibinin değişikliklerini geri alır; QR token'ı KORUNUR, şifre/oturum DOKUNULMAZ", async () => {
    const ds = buildDemoDataset({ now: NOW });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    const reviewerBefore = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_LOGIN_EMAIL } });
    const ids = async () => (await prisma.reservation.findMany({ where: { property: { organizationId: DEMO_ORG_ID } }, select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id);
    const firstIds = await ids();

    // İnceleme ekibi oynar.
    const p0 = ds.properties[0].id;
    await prisma.property.update({ where: { id: p0 }, data: { chatToken: "qr-token-korunmali", name: "Değiştirildi" } });
    await prisma.property.create({ data: { organizationId: DEMO_ORG_ID, name: "Eklenen mülk" } });
    await prisma.reservation.update({ where: { id: firstIds[0] }, data: { guestName: "Değiştirildi" } });
    await prisma.organization.update({ where: { id: DEMO_ORG_ID }, data: { alertEmail: "saldirgan@example.org" } });

    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: null, staffPasswordHash: STAFF_HASH });
    expect(await ids()).toEqual(firstIds);
    expect(await prisma.property.count({ where: { organizationId: DEMO_ORG_ID } })).toBe(12);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: p0 } });
    expect(p).toMatchObject({ chatToken: "qr-token-korunmali", name: ds.properties[0].name });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: firstIds[0] } })).guestName).not.toBe("Değiştirildi");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: DEMO_ORG_ID } })).alertEmail).toBeNull();
    const reviewerAfter = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_LOGIN_EMAIL } });
    expect(reviewerAfter.passwordHash).toBe(reviewerBefore.passwordHash);
    expect(reviewerAfter.sessionEpoch).toBe(reviewerBefore.sessionEpoch);

    // Şifre verilse bile "yenile" denmedikçe mevcut şifre DEĞİŞMEZ (inceleme ekibi kilitlenmez).
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: bcrypt.hashSync("baska-bir-sifre-cok-uzun-0924", 4), staffPasswordHash: STAFF_HASH });
    expect((await prisma.user.findUniqueOrThrow({ where: { email: DEMO_LOGIN_EMAIL } })).passwordHash).toBe(reviewerBefore.passwordHash);
  });

  it("--reset-security: 2FA + kurtarma kodları sıfırlanır, oturumlar düşer; --rotate-password şifreyi değiştirir", async () => {
    const ds = buildDemoDataset({ now: NOW });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    const r = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_LOGIN_EMAIL } });
    await prisma.user.update({ where: { id: r.id }, data: { twoFactorSecret: "enc:x", twoFactorEnabledAt: NOW } });
    await prisma.twoFactorRecoveryCode.create({ data: { userId: r.id, codeHash: "h1" } });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: null, staffPasswordHash: STAFF_HASH, resetSecurity: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ twoFactorSecret: null, twoFactorEnabledAt: null, sessionEpoch: r.sessionEpoch + 1 });
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: r.id } })).toBe(0);

    const newHash = bcrypt.hashSync("yeni-demo-sifresi-cok-uzun-123", 4);
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: newHash, staffPasswordHash: STAFF_HASH, rotatePassword: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: r.id } })).passwordHash).toBe(newHash);
  });
});

describe("demo hesabı — reddetmeler SIFIR yazma", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function totalRows() {
    const [o, u, p, r, a] = await Promise.all([prisma.organization.count(), prisma.user.count(), prisma.property.count(), prisma.reservation.count(), prisma.auditLog.count()]);
    return { o, u, p, r, a };
  }

  it("🚨 giriş adresi başka bir org'a aitse (açık kayıtla alınmış) hesap DEVRALINMAZ", async () => {
    const other = await makeOrgWithProperty();
    await prisma.user.create({ data: { organizationId: other.orgId, name: "Başkası", email: DEMO_LOGIN_EMAIL, passwordHash: "x" } });
    const before = await totalRows();
    await expect(applyDemoTenant(prisma, buildDemoDataset({ now: NOW }), { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH })).rejects.toMatchObject({
      reason: "login_email_taken",
    });
    expect(await totalRows()).toEqual(before);
    await expect(preflightDemoTenant(prisma, buildDemoDataset({ now: NOW }), { hasReviewerPassword: true })).rejects.toBeInstanceOf(DemoRefusedError);
  });

  it("ilk kurulum şifresiz yapılamaz", async () => {
    const before = await totalRows();
    await expect(applyDemoTenant(prisma, buildDemoDataset({ now: NOW }), { reviewerPasswordHash: null, staffPasswordHash: STAFF_HASH })).rejects.toMatchObject({
      reason: "first_run_needs_password",
    });
    expect(await totalRows()).toEqual(before);
  });

  it("🚨 demo org'unda gerçek bir bağlantı/takvim beslemesi varsa DOKUNULMAZ", async () => {
    const ds = buildDemoDataset({ now: NOW });
    await applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH });
    await prisma.calendarSource.create({ data: { propertyId: ds.properties[0].id, label: "Gerçek", url: "https://x.example/f.ics" } });
    const before = await totalRows();
    const snap = await snapshotOrg(DEMO_ORG_ID);
    await expect(applyDemoTenant(prisma, ds, { reviewerPasswordHash: null, staffPasswordHash: STAFF_HASH })).rejects.toMatchObject({
      reason: "live_connection_present",
    });
    expect(await totalRows()).toEqual(before);
    expect(await snapshotOrg(DEMO_ORG_ID)).toBe(snap);
  });

  it("veri kümesi demo org'u DIŞINI hedefliyorsa (org ya da kullanıcı kimliği) reddedilir", async () => {
    const ds = buildDemoDataset({ now: NOW });
    const before = await totalRows();
    await expect(applyDemoTenant(prisma, { ...ds, org: { ...ds.org, id: "baska-org" } }, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH })).rejects.toMatchObject({
      reason: "wrong_org_id",
    });
    const users = ds.users.map((u, i) => (i === 1 ? { ...u, id: "gercek-kullanici" } : u));
    await expect(applyDemoTenant(prisma, { ...ds, users }, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH })).rejects.toMatchObject({
      reason: "wrong_org_id",
    });
    expect(await totalRows()).toEqual(before);
  });

  it("veri kümesindeki mülk kimliği başka bir org'da varsa reddedilir", async () => {
    const other = await makeOrgWithProperty();
    const ds = buildDemoDataset({ now: NOW });
    await prisma.property.create({ data: { id: ds.properties[3].id, organizationId: other.orgId, name: "Çakışan" } });
    const before = await totalRows();
    await expect(applyDemoTenant(prisma, ds, { reviewerPasswordHash: PW_HASH, staffPasswordHash: STAFF_HASH })).rejects.toMatchObject({
      reason: "property_id_collision",
    });
    expect(await totalRows()).toEqual(before);
  });

  it("kuru koşu hiçbir şey yazmaz; ilk kurulumda şifre eksikse REDDETMEZ, bildirir", async () => {
    const before = await totalRows();
    const pf = await preflightDemoTenant(prisma, buildDemoDataset({ now: NOW }), { hasReviewerPassword: false });
    expect(pf).toMatchObject({ orgExists: false, reviewerExists: false, needsReviewerPassword: true });
    expect(await totalRows()).toEqual(before);
    expect(await preflightDemoTenant(prisma, buildDemoDataset({ now: NOW }), { hasReviewerPassword: true })).toMatchObject({ needsReviewerPassword: false });
  });
});
