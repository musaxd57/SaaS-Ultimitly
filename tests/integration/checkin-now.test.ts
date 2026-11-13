// ---------------------------------------------------------------------------
// UX-10 D5 (kurucu 11-13: "ilk 2'si kesinlikle olur"): Girişler satırından "Giriş mesajını gönderin". Göndericinin talep-sonra-gönder yolunun
// TEK rezervasyonluk çağrısı: aynı damga (`checkinSentAt`), aynı işlem içi şartlar → otomatik gönderimle de, iki sekmeyle de ÇİFT gönderim yok.
// Önizlenen metin sürümü şart; her şart sunucuda yeniden okunur; acil durdurma onurlandırılır; kesin ret damgayı geri alır, belirsiz teslim
// damgayı tutar. Rota: yalnız sahip / yönetici, başka işletmenin rezervasyonu 404, önizleme önbelleğe alınmaz.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { sendOnChannel } from "@/lib/messaging";
import { previewCheckinNow, sendCheckinNow, sendDueCheckins } from "@/lib/automation";
import { GET, POST } from "@/app/api/reservations/[id]/checkin-message/route";
import { createKbWithAutoMessage } from "../helpers/auto-message";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

async function seed(opts: { autoCheckin?: boolean; arrivalInDays?: number; status?: string } = {}) {
  const org = await prisma.organization.create({
    data: {
      name: "D5 Org",
      timezone: "Europe/Istanbul",
      autoCheckin: opts.autoCheckin ?? false,
      // Açık otomatik girişte taban rezervasyondan SONRA → "tabandan önce" satırı (elle gönderimin görünür olduğu yer).
      autoCheckinEnabledAt: opts.autoCheckin ? new Date(Date.now() + 60_000) : null,
    },
  });
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: `sahip-${org.id}@example.test`, passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Deniz Daire" } });
  await createKbWithAutoMessage({
    data: { propertyId: property.id, category: "checkin", title: "Giriş", content: "Hoş geldiniz — kapı kodumuz 4821.", isActive: true },
  });
  const inDays = opts.arrivalInDays ?? 1;
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date(Date.now() + inDays * DAY),
      departureDate: new Date(Date.now() + (inDays + 3) * DAY),
      channel: "airbnb",
      status: opts.status ?? "confirmed",
      sourceReference: `res-${org.id}`,
    },
  });
  const tpl = await prisma.autoMessageTemplate.findUniqueOrThrow({ where: { propertyId_kind: { propertyId: property.id, kind: "checkin" } } });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: "sahip@example.test", name: "Sahip", sessionEpoch: 0 } as SessionPayload;
  return { orgId: org.id, ownerId: owner.id, reservationId: r.id, revision: tpl.revision, templateId: tpl.id };
}

const stamp = (id: string) => prisma.reservation.findUniqueOrThrow({ where: { id } }).then((r) => r.checkinSentAt);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new NextRequest(`http://localhost/api/reservations/${id}/checkin-message`), ctx(id));
const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/reservations/${id}/checkin-message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    ctx(id),
  );

describe("Girişler — giriş mesajını elle gönderme (çekirdek)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "p1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("otomatik giriş KAPALI dairede: önizleme misafirin göreceği metni verir; gönderim TEK kez gider, damgalanır, denetime yazılır", async () => {
    const s = await seed();
    const p = await previewCheckinNow(s.orgId, s.reservationId);
    expect(p.ok && p.body).toContain("kapı kodumuz 4821");
    expect(await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId })).toEqual({ ok: true, kind: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stamp(s.reservationId)).toBeInstanceOf(Date);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.orgId, action: "checkin_message.manual_send" } });
    expect(audit.actorUserId).toBe(s.ownerId);
    expect(audit.metadataJson).not.toContain("4821"); // metin denetime yazılmaz
    // İkinci basış: ikinci mesaj YOK.
    expect(await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId })).toEqual({ ok: false, kind: "already_sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 elle gönderilen misafire otomatik gönderici İKİNCİ kez göndermez (aynı damga)", async () => {
    const s = await seed({ autoCheckin: true });
    expect((await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId })).ok).toBe(true);
    // Taban artık geçmişte olsa bile (anahtar yeniden açıldı) aynı rezervasyona tekrar gitmez.
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCheckinEnabledAt: new Date(Date.now() - 30 * DAY) } });
    await sendDueCheckins(s.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 iki sekme aynı anda gönderir → sağlayıcıya TEK çağrı", async () => {
    const s = await seed();
    const args = { organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId };
    const out = await Promise.all([sendCheckinNow(args), sendCheckinNow(args)]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("önizlemeden sonra metin değişti → GİTMEZ ('changed')", async () => {
    const s = await seed();
    await prisma.autoMessageTemplate.update({ where: { id: s.templateId }, data: { body: "Yeni metin", revision: { increment: 1 } } });
    expect(await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId })).toEqual({ ok: false, kind: "changed" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("şartlar: pencere dışı (3 gün sonra), onaysız, acil durdurma açık → GİTMEZ, sebep ayrı", async () => {
    const far = await seed({ arrivalInDays: 3.5 });
    expect((await previewCheckinNow(far.orgId, far.reservationId)).ok).toBe(false);
    expect(await sendCheckinNow({ organizationId: far.orgId, reservationId: far.reservationId, revision: far.revision, actorUserId: far.ownerId })).toEqual({ ok: false, kind: "out_of_window" });
    await resetDb();
    const cancelled = await seed({ status: "cancelled" });
    expect(await sendCheckinNow({ organizationId: cancelled.orgId, reservationId: cancelled.reservationId, revision: cancelled.revision, actorUserId: cancelled.ownerId })).toEqual({ ok: false, kind: "not_confirmed" });
    await resetDb();
    const paused = await seed();
    vi.stubEnv("AUTO_REPLY_ENABLED", "0");
    expect(await sendCheckinNow({ organizationId: paused.orgId, reservationId: paused.reservationId, revision: paused.revision, actorUserId: paused.ownerId })).toEqual({ ok: false, kind: "paused" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("kesin ret → damga GERİ alınır (yeniden denenebilir); belirsiz teslim → damga KALIR (ikinci kez gitmez)", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, kind: "definitive_failure", error: "HTTP 400 bad request", providerMessageId: null } as never);
    expect((await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId })).kind).toBe("definitive");
    expect(await stamp(s.reservationId)).toBeNull();
    mockSend.mockResolvedValueOnce({ ok: false, kind: "ambiguous", error: "timeout", providerMessageId: null } as never);
    expect((await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, actorUserId: s.ownerId })).kind).toBe("ambiguous");
    expect(await stamp(s.reservationId)).toBeInstanceOf(Date);
  });
});

describe("Girişler — giriş mesajı rotası", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "p1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("GET önbelleğe alınmaz ve metni verir; POST önizlenen sürümle gönderir", async () => {
    const s = await seed();
    const res = await get(s.reservationId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.revision).toBe(s.revision);
    const sent = await post(s.reservationId, { revision: body.revision });
    expect(sent.status).toBe(200);
    expect((await sent.json()).kind).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 başka işletmenin rezervasyonu → 404, mesaj gitmez; personel → 403", async () => {
    const a = await seed();
    const b = await seed();
    // oturum b'nin sahibi; a'nın rezervasyonu
    expect((await get(a.reservationId)).status).toBe(404);
    expect((await post(a.reservationId, { revision: a.revision })).status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
    session = { ...session, role: "staff" } as SessionPayload;
    expect((await post(b.reservationId, { revision: b.revision })).status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("gövde doğrulanır (sürüm yok → 400, gönderim yok)", async () => {
    const s = await seed();
    expect((await post(s.reservationId, {})).status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
