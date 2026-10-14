// ---------------------------------------------------------------------------
// Y4 (10-14 dış inceleme): yaşam döngüsü göndericilerinin SON TALEBİ seçim şartlarını yeniden ister.
//
// Gönderici aday rezervasyonları tek `findMany` ile seçer, sonra aday başına sağlayıcı çağrısını BEKLER. Seçimle gönderim
// arasında rezervasyon iptal edilir ya da aylar sonrasına taşınırsa eski talep yalnız `*SentAt: null`a bakıyordu → giriş
// bilgisi (kapı kodu taşıyabilir) iptal edilmiş / henüz zamanı gelmemiş konaklamaya gidiyordu.
//
// Yarış gerçekçi kurulur: İKİ aday; birincinin sağlayıcı çağrısı SIRASINDA ikinci rezervasyon değiştirilir (döngü tam bu
// noktada bekler). Her vakanın KONTROLÜ aynı tohumda değişiklik YOKKEN iki gönderimdir — kontrol kırmızıya dönmeden "gitmedi"
// iddiası anlamsızdır.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes, sendDueCheckins, sendDueCheckouts } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

type Change = "none" | "cancel" | "postpone";

/** İki aday rezervasyon (A önce, B sonra — `orderBy` tarih). */
async function seed(kind: "welcome" | "checkin" | "checkout") {
  const enabledAt = new Date(Date.now() - 7 * DAY);
  const org = await prisma.organization.create({
    data: {
      name: "Y4 Org",
      autoWelcome: true,
      autoWelcomeEnabledAt: enabledAt,
      autoCheckin: true,
      autoCheckinEnabledAt: enabledAt,
      autoCheckout: true,
      autoCheckoutEnabledAt: enabledAt,
      timezone: "Europe/Istanbul",
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: kind, title: kind, content: `${kind} metni — kapı kodu 4821`, isActive: true },
  });
  const base = kind === "checkout" ? { arrival: -2 * DAY, departure: 0 } : { arrival: 1 * DAY, departure: 4 * DAY };
  const mk = (ref: string, offset: number) =>
    prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: ref === "res-a" ? "Ayşe Yılmaz" : "Burak Demir",
        arrivalDate: new Date(Date.now() + base.arrival + offset),
        departureDate: new Date(Date.now() + base.departure + offset),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: ref,
      },
    });
  await mk("res-a", 0);
  // Çıkışta ikisi de BUGÜN ayrılır (aynı gün); varışta B bir saat sonra (sıra kesin A → B).
  await mk("res-b", kind === "checkout" ? 1000 : 3_600_000);
  return org.id;
}

/** A'nın sağlayıcı çağrısı sırasında B'yi değiştir. */
function changeBDuringFirstSend(change: Change) {
  let first = true;
  mockSend.mockImplementation(async () => {
    if (first && change !== "none") {
      first = false;
      const data =
        change === "cancel"
          ? { status: "cancelled" }
          : { arrivalDate: new Date(Date.now() + 90 * DAY), departureDate: new Date(Date.now() + 93 * DAY) };
      await prisma.reservation.updateMany({ where: { sourceReference: "res-b" }, data });
    }
    first = false;
    return { ok: true } as never;
  });
}

const stampOf = async (ref: string, field: "welcomeSentAt" | "checkinSentAt" | "checkoutSentAt") =>
  (await prisma.reservation.findFirstOrThrow({ where: { sourceReference: ref } }))[field];

describe("Y4 — kuyruksuz yol: son talep durum + tarih şartını yeniden ister", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("KONTROL: değişiklik yok → giriş mesajı İKİ rezervasyona da gider", async () => {
    const orgId = await seed("checkin");
    changeBDuringFirstSend("none");
    expect((await sendDueCheckins(orgId)).sent).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("🚨 seçimden sonra İPTAL → giriş bilgisi GİTMEZ, damga da konmaz", async () => {
    const orgId = await seed("checkin");
    changeBDuringFirstSend("cancel");
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stampOf("res-b", "checkinSentAt")).toBeNull();
  });

  it("🚨 seçimden sonra AYLAR SONRASINA taşındı → şimdi GİTMEZ; damga konmaz (yeni tarihte normal gider)", async () => {
    const orgId = await seed("checkin");
    changeBDuringFirstSend("postpone");
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stampOf("res-b", "checkinSentAt")).toBeNull();
  });

  it("kardeş satır (aynı rezervasyonun çift satırı) aynı damgayla işaretlenir — ikinci gönderim YOK", async () => {
    const orgId = await seed("checkin");
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    // Yeniden bağlama sonrası çift satır: aynı sourceReference BAŞKA mülk satırında, iptal durumda (aday olamaz, ama damgalanmalı).
    const relinked = await prisma.property.create({ data: { organizationId: orgId, name: "Eski Kayıt" } });
    await prisma.reservation.create({
      data: {
        propertyId: relinked.id,
        guestName: a.guestName,
        arrivalDate: a.arrivalDate,
        departureDate: a.departureDate,
        channel: "airbnb",
        status: "cancelled",
        sourceReference: "res-a",
      },
    });
    changeBDuringFirstSend("none");
    await sendDueCheckins(orgId);
    const rows = await prisma.reservation.findMany({ where: { sourceReference: "res-a" }, select: { checkinSentAt: true } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.checkinSentAt?.getTime())).size).toBe(1);
    expect(rows.every((r) => r.checkinSentAt)).toBe(true);
  });

  it("🚨 karşılama: seçimden sonra İPTAL → GİTMEZ (kontrol: iki gönderim)", async () => {
    const ok = await seed("welcome");
    changeBDuringFirstSend("none");
    expect((await sendDueWelcomes(ok)).sent).toBe(2);

    await resetDb();
    vi.clearAllMocks();
    const orgId = await seed("welcome");
    changeBDuringFirstSend("cancel");
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(await stampOf("res-b", "welcomeSentAt")).toBeNull();
  });

  it("🚨 çıkış: seçimden sonra İPTAL → GİTMEZ (kontrol: iki gönderim; İstanbul 09:00)", async () => {
    const at9 = new Date();
    at9.setUTCHours(6, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at9);

    const ok = await seed("checkout");
    changeBDuringFirstSend("none");
    expect((await sendDueCheckouts(ok)).sent).toBe(2);

    await resetDb();
    vi.clearAllMocks();
    const orgId = await seed("checkout");
    changeBDuringFirstSend("cancel");
    expect((await sendDueCheckouts(orgId)).sent).toBe(1);
    expect(await stampOf("res-b", "checkoutSentAt")).toBeNull();
  });
});

describe("Y4 — kalıcı kuyruk: ileri tarihe taşınan giriş satırı gönderim anında ERTELENİR (iptal yok, tek anahtar)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kuyruktan sonra 3 ay ileri → POST YOK, satır pencere açılana kadar ertelenir; tarih geri gelince bekletmeden gider", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);

    await prisma.reservation.updateMany({
      where: { sourceReference: "res-a" },
      data: { arrivalDate: new Date(Date.now() + 90 * DAY), departureDate: new Date(Date.now() + 93 * DAY) },
    });
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(0);
    const deferred = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(deferred.status).toBe("pending"); // iptal DEĞİL — tek anahtar mesajı kalıcı yutmasın
    expect(deferred.attemptCount).toBe(0); // erteleme deneme sayılmaz
    expect(deferred.claimedAt).toBeNull(); // rezervasyon başına gönderim sayacını yemez
    expect(deferred.availableAt.getTime()).toBeGreaterThan(Date.now() + 80 * DAY);
    expect(await stampOf("res-a", "checkinSentAt")).toBeNull();

    // Tarih yeniden pencereye girdi: aynı anahtar dedupe olur ama ertelenmiş satırın vadesi şimdiye çekilir.
    await prisma.reservation.updateMany({
      where: { sourceReference: "res-a" },
      data: { arrivalDate: new Date(Date.now() + 2 * DAY), departureDate: new Date(Date.now() + 5 * DAY) },
    });
    expect((await sendDueCheckins(orgId)).sent).toBe(0); // yeni satır yok (tek anahtar)
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(1);
    expect(await stampOf("res-a", "checkinSentAt")).not.toBeNull();
  });

  it("KONTROL: tarih değişmezse kuyruk satırı GİDER (aynı anahtar ikinci koşuda yutulur)", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(1);
  });

  it("🚨 iptal edilmiş KOPYA satır onaylı rezervasyonun giriş mesajını iptal ETMEZ (kardeş keyfi okunmaz, Haiku 10-14)", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    await prisma.reservation.delete({ where: { id: a.id } });
    // Önce (fiziksel olarak İLK) iptal edilmiş kopya, sonra onaylı satır — sırasız `findFirst` kopyayı döndürüp mesajı iptal ediyordu.
    const relinked = await prisma.property.create({ data: { organizationId: orgId, name: "Eski Kayıt" } });
    await prisma.reservation.create({
      data: {
        propertyId: relinked.id,
        guestName: a.guestName,
        arrivalDate: a.arrivalDate,
        departureDate: a.departureDate,
        channel: "airbnb",
        status: "cancelled",
        sourceReference: "res-a",
      },
    });
    await prisma.reservation.create({
      data: {
        propertyId: a.propertyId,
        guestName: a.guestName,
        arrivalDate: a.arrivalDate,
        departureDate: a.departureDate,
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-a",
      },
    });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(1);
  });
});
