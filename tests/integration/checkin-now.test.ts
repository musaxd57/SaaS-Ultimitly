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
  // Girişler'in "bağlı mı" okuması (`hasMessagingConnection` → `getConnectionInfo`; belirteç çekmez).
  getConnectionInfo: vi.fn().mockResolvedValue({ connected: true }),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { sendOnChannel } from "@/lib/messaging";
import { reportError } from "@/lib/report-error";
import { checkinPreviewDigest, previewCheckinNow, sendCheckinNow, sendDueCheckins } from "@/lib/automation";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
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
type Seeded = Awaited<ReturnType<typeof seed>>;
/** Onay penceresinin özeti (Opus B2): gönderim penceredeki metnin özetini taşır. Önizleme reddederse (pencere dışı vb.) özet önemsiz. */
const NO_DIGEST = "0".repeat(64);
async function digestOf(s: Seeded): Promise<string> {
  const p = await previewCheckinNow(s.orgId, s.reservationId);
  return p.ok ? p.digest : NO_DIGEST;
}
async function argsFor(s: Seeded, over: Partial<Parameters<typeof sendCheckinNow>[0]> = {}) {
  return { organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, digest: await digestOf(s), actorUserId: s.ownerId, ...over };
}
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
    expect(await sendCheckinNow(await argsFor(s))).toEqual({ ok: true, kind: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stamp(s.reservationId)).toBeInstanceOf(Date);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.orgId, action: "checkin_message.manual_send" } });
    expect(audit.actorUserId).toBe(s.ownerId);
    expect(audit.metadataJson).not.toContain("4821"); // metin denetime yazılmaz
    // İkinci basış: ikinci mesaj YOK.
    expect(await sendCheckinNow(await argsFor(s))).toEqual({ ok: false, kind: "already_sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 elle gönderilen misafire otomatik gönderici İKİNCİ kez göndermez (aynı damga)", async () => {
    const s = await seed({ autoCheckin: true });
    expect((await sendCheckinNow(await argsFor(s))).ok).toBe(true);
    // Taban artık geçmişte olsa bile (anahtar yeniden açıldı) aynı rezervasyona tekrar gitmez.
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCheckinEnabledAt: new Date(Date.now() - 30 * DAY) } });
    await sendDueCheckins(s.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 iki sekme aynı anda gönderir → sağlayıcıya TEK çağrı", async () => {
    const s = await seed();
    const args = await argsFor(s);
    const out = await Promise.all([sendCheckinNow(args), sendCheckinNow(args)]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("önizlemeden sonra metin değişti → GİTMEZ ('changed')", async () => {
    const s = await seed();
    const shown = await argsFor(s);
    await prisma.autoMessageTemplate.update({ where: { id: s.templateId }, data: { body: "Yeni metin", revision: { increment: 1 } } });
    expect(await sendCheckinNow(shown)).toEqual({ ok: false, kind: "changed" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 Opus B2: şablon sürümü aynı ama misafire gidecek metin değişti (imza / misafir adı) → GİTMEZ ('changed'); güncel özetle gider", async () => {
    const s = await seed();
    const shown = await argsFor(s);
    await prisma.organization.update({ where: { id: s.orgId }, data: { aiSignature: "Yeni imza" } });
    expect(await sendCheckinNow(shown)).toEqual({ ok: false, kind: "changed" });
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { guestName: "Zeynep Kaya" } });
    expect(await sendCheckinNow({ ...shown, digest: await digestOf(s) })).toEqual({ ok: true, kind: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(checkinPreviewDigest("a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("şartlar: pencere dışı (3 gün sonra), onaysız, acil durdurma açık → GİTMEZ, sebep ayrı", async () => {
    const far = await seed({ arrivalInDays: 3.5 });
    expect((await previewCheckinNow(far.orgId, far.reservationId)).ok).toBe(false);
    expect(await sendCheckinNow(await argsFor(far))).toEqual({ ok: false, kind: "out_of_window" });
    await resetDb();
    const cancelled = await seed({ status: "cancelled" });
    expect(await sendCheckinNow(await argsFor(cancelled))).toEqual({ ok: false, kind: "not_confirmed" });
    await resetDb();
    const paused = await seed();
    vi.stubEnv("AUTO_REPLY_ENABLED", "0");
    expect(await sendCheckinNow(await argsFor(paused))).toEqual({ ok: false, kind: "paused" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("kesin ret → damga GERİ alınır (yeniden denenebilir); belirsiz teslim → damga KALIR (ikinci kez gitmez)", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, kind: "definitive_failure", error: "HTTP 400 bad request", providerMessageId: null } as never);
    expect((await sendCheckinNow(await argsFor(s))).kind).toBe("definitive");
    expect(await stamp(s.reservationId)).toBeNull();
    mockSend.mockResolvedValueOnce({ ok: false, kind: "ambiguous", error: "timeout", providerMessageId: null } as never);
    expect((await sendCheckinNow(await argsFor(s))).kind).toBe("ambiguous");
    expect(await stamp(s.reservationId)).toBeInstanceOf(Date);
  });
});

// Haiku D5 incelemesi (11-13): geri alma hatası sessiz kalmasın · kalıcı kuyrukta var olan satırın durumu doğru cümleye dönsün · kuyruktaki
// mesaj için düğme sunulmasın.
describe("Girişler — elle gönderim: geri alma alarmı ve kalıcı kuyruk", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "p1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  const args = (s: Seeded) => argsFor(s);
  const rejected = { ok: false, kind: "definitive_failure", error: "HTTP 400 bad request", providerMessageId: null } as never;

  it("🚨 kesin ret sonrası damga GERİ ALINAMADIYSA (mesaj bir daha denenmez) otomatik gönderimle aynı alarm kurulur; geri alındıysa alarm yok", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce(rejected);
    expect((await sendCheckinNow(await args(s))).kind).toBe("definitive");
    expect(await stamp(s.reservationId)).toBeNull();
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();

    // Gönderim sürerken damga başka bir yazımla değişti → geri alma koşulu (`checkinSentAt = stampedAt`) tutmaz, 0 satır.
    mockSend.mockImplementationOnce(async () => {
      await prisma.reservation.update({ where: { id: s.reservationId }, data: { checkinSentAt: new Date(Date.now() - 60_000) } });
      return rejected;
    });
    expect((await sendCheckinNow(await args(s))).kind).toBe("definitive");
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    const [key, err] = vi.mocked(reportError).mock.calls[0]!;
    expect(`${String(key)} ${(err as Error).message}`).toContain("rollback_failed");
  });

  it("🚨 Opus B1: kalıcı kuyruk AÇIK ve otomatik giriş KAPALI → elle gönderim kuyruğa satır YAZMAZ (işçi iptal ederdi), doğrudan gider", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    const s = await seed({ autoCheckin: false });
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", s.orgId);
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: true, kind: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stamp(s.reservationId)).toBeInstanceOf(Date);
    expect(await prisma.messageOutbox.count({ where: { organizationId: s.orgId } })).toBe(0);
  });

  it("🚨 operatör kuyruklu gönderimleri DURAKLATTIYSA bu işletmede elle gönderim de durur", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const s = await seed();
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", s.orgId);
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: false, kind: "paused" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 kuyrukta (otomatik göndericinin) satırı zaten varken: ertelenmiş öne çekilir; gönderildi / doğrulanamadı / uçuşta ayrı cevap; başarısız / iptal → doğrudan gider", async () => {
    const s = await seed();
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    const row = await prisma.messageOutbox.create({
      data: {
        organizationId: s.orgId,
        reservationId: s.reservationId,
        channel: "airbnb",
        externalReservationId: res.sourceReference,
        messageType: "checkin",
        body: "x",
        idempotencyKey: `checkin:${s.orgId}:${res.sourceReference}`,
        status: "pending",
      },
    });
    const setRow = (data: Record<string, unknown>) => prisma.messageOutbox.update({ where: { id: row.id }, data });
    const later = new Date(Date.now() + 3 * DAY);

    // Varış ileri taşınıp geri geldi: işçi satırı ertelemişti (hata bilgisi boş) → vadesi şimdiye çekilir, "sıraya alındı".
    await setRow({ status: "pending", availableAt: later, lastErrorKind: null });
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: true, kind: "queued" });
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).availableAt.getTime()).toBeLessThanOrEqual(Date.now());

    // Sağlayıcı beklemesi / geri çekilme (hata bilgisi DOLU) → vadesi ÇEKİLMEZ.
    await setRow({ status: "pending", availableAt: later, lastErrorKind: "definitive_failure" });
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: false, kind: "queue_owns" });
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).availableAt.getTime()).toBe(later.getTime());

    const verdicts: Array<[string, string]> = [
      ["sent", "already_sent"],
      ["review", "ambiguous"],
      ["sending", "queue_owns"],
      ["blocked", "queue_owns"],
    ];
    for (const [status, kind] of verdicts) {
      await setRow({ status, availableAt: new Date(), lastErrorKind: null });
      expect(await sendCheckinNow(await args(s)), status).toEqual({ ok: false, kind });
    }
    expect(mockSend).not.toHaveBeenCalled();

    // Misafire ULAŞMAMIŞ satır (iptal / kesin başarısız) elle gönderimi engellemez.
    await setRow({ status: "canceled" });
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: true, kind: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.messageOutbox.count({ where: { organizationId: s.orgId } })).toBe(1);
  });

  it("🚨 Girişler: kuyrukta giriş mesajı satırı varsa düğme SUNULMAZ; kesin başarısız / iptal satır engellemez", async () => {
    const s = await seed();
    const offered = async () => JSON.stringify((await loadArrivalReadiness(s.orgId, new Date())).rows).includes('"sendCheckin":true');
    expect(await offered()).toBe(true); // vakum değil: satır yokken düğme var
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    const row = await prisma.messageOutbox.create({
      data: {
        organizationId: s.orgId,
        reservationId: s.reservationId,
        channel: "airbnb",
        externalReservationId: res.sourceReference,
        messageType: "checkin",
        body: "x",
        idempotencyKey: `checkin:${s.orgId}:${res.sourceReference}`,
        status: "pending",
      },
    });
    expect(await offered()).toBe(false);
    await prisma.messageOutbox.update({ where: { id: row.id }, data: { status: "failed" } });
    expect(await offered()).toBe(true);
    await prisma.messageOutbox.update({ where: { id: row.id }, data: { status: "canceled" } });
    expect(await offered()).toBe(true);
  });

  // Opus 11-18 B-2: rezervasyon iki dairede kayıtlıyken kuyruk işçisi bekleyen satırı TUTAR. Eskiden elle gönderim satırın vadesini öne
  // çekip "sıraya alındı" diyordu — işçi yine tuttuğu için mesaj hiç gitmiyordu.
  const twoPropertySetup = async () => {
    const s = await seed({ autoCheckin: true });
    // Otomatik giriş tabanı rezervasyondan ÖNCE (satır "iki dairede kayıtlı" sebebine kadar ilerlesin).
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCheckinEnabledAt: new Date(Date.now() - 30 * DAY) } });
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: s.orgId, name: "Başka Daire" } });
    await createKbWithAutoMessage({
      data: { propertyId: other.id, category: "checkin", title: "Giriş", content: "Hoş geldiniz — kapı kodumuz 9999.", isActive: true },
    });
    const sibling = await prisma.reservation.create({
      data: { propertyId: other.id, guestName: res.guestName, arrivalDate: res.arrivalDate, departureDate: res.departureDate, channel: "airbnb", status: "confirmed", sourceReference: res.sourceReference },
    });
    const row = await prisma.messageOutbox.create({
      data: {
        organizationId: s.orgId,
        reservationId: s.reservationId,
        channel: "airbnb",
        externalReservationId: res.sourceReference,
        messageType: "checkin",
        body: "x",
        idempotencyKey: `checkin:${s.orgId}:${res.sourceReference}`,
        status: "pending",
        availableAt: new Date(Date.now() + 20 * 60_000), // işçi tutmuş: 20 dakika sonra yeniden bakacak
      },
    });
    return { s, row, sibling };
  };

  it("🚨 iki dairede kayıtlı + kuyrukta TUTULAN satır: elle gönderim 'sıraya alındı' DEMEZ — satır iptal edilir, mesaj seçilen dairenin metniyle doğrudan gider", async () => {
    const { s, row, sibling } = await twoPropertySetup();
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: true, kind: "sent" }); // ⬅️ ESKİDE { ok: true, kind: "queued" } ve mesaj hiç gitmiyordu
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockSend.mock.calls[0])).toContain("4821"); // ev sahibinin seçtiği dairenin metni
    expect(JSON.stringify(mockSend.mock.calls[0])).not.toContain("9999");
    const after = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("canceled");
    expect(after.lastErrorCode).toBe("manual_send_two_properties");
    // Kopya kayıt da damgalanır → yanlış kayıt sonradan kaldırılsa da otomatik gönderici ikinci kez göndermez.
    expect(await stamp(s.reservationId)).toBeInstanceOf(Date);
    expect(await stamp(sibling.id)).toBeInstanceOf(Date);
  });

  it("iki dairede kayıtlı ama satır UÇUŞTA / gönderilmiş: dokunulmaz, eski hüküm (çift gönderim yok)", async () => {
    const { s, row } = await twoPropertySetup();
    for (const [status, kind] of [["sending", "queue_owns"], ["sent", "already_sent"], ["review", "ambiguous"]] as const) {
      await prisma.messageOutbox.update({ where: { id: row.id }, data: { status } });
      expect(await sendCheckinNow(await args(s)), status).toEqual({ ok: false, kind });
      expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(status);
    }
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KONTROL: tek dairede kayıtlı rezervasyonda ertelenmiş satır eskisi gibi öne çekilir ('sıraya alındı'), iptal edilmez", async () => {
    const { s, row, sibling } = await twoPropertySetup();
    await prisma.reservation.delete({ where: { id: sibling.id } });
    expect(await sendCheckinNow(await args(s))).toEqual({ ok: true, kind: "queued" });
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("pending");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 Girişler: iki dairede kayıtlı + kuyrukta yalnız BEKLEYEN satır → düğme sunulur (mesaj kendiliğinden gitmeyecek); uçuşta satır varsa sunulmaz", async () => {
    const { s, row, sibling } = await twoPropertySetup();
    const offeredFor = async () => {
      const rows = (await loadArrivalReadiness(s.orgId, new Date())).rows;
      return rows.filter((r) => JSON.stringify(r).includes('"sendCheckin":true')).length;
    };
    expect(await offeredFor()).toBeGreaterThan(0); // ⬅️ ESKİDE 0: satır tutuluyor, düğme de yoktu
    await prisma.messageOutbox.update({ where: { id: row.id }, data: { status: "sending" } });
    expect(await offeredFor()).toBe(0);
    // Tek dairede kayıtlıysa bekleyen satır düğmeyi eskisi gibi gizler (kuyruk kendisi gönderecek).
    await prisma.messageOutbox.update({ where: { id: row.id }, data: { status: "pending" } });
    await prisma.reservation.delete({ where: { id: sibling.id } });
    expect(await offeredFor()).toBe(0);
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
    expect(body.digest).toMatch(/^[0-9a-f]{64}$/);
    const sent = await post(s.reservationId, { revision: body.revision, digest: body.digest });
    expect(sent.status).toBe(200);
    expect((await sent.json()).kind).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 başka işletmenin rezervasyonu → 404, mesaj gitmez; personel → 403", async () => {
    const a = await seed();
    const b = await seed();
    // oturum b'nin sahibi; a'nın rezervasyonu
    expect((await get(a.reservationId)).status).toBe(404);
    expect((await post(a.reservationId, { revision: a.revision, digest: NO_DIGEST })).status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
    session = { ...session, role: "staff" } as SessionPayload;
    expect((await post(b.reservationId, { revision: b.revision, digest: NO_DIGEST })).status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("gövde doğrulanır (sürüm ya da özet yok → 400, gönderim yok)", async () => {
    const s = await seed();
    expect((await post(s.reservationId, {})).status).toBe(400);
    expect((await post(s.reservationId, { revision: s.revision })).status).toBe(400);
    expect((await post(s.reservationId, { revision: s.revision, digest: "kısa" })).status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
