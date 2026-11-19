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
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";

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
import { eraseReservationData } from "@/lib/erasure";
import { drainOutboxOnce, LIFECYCLE_STATUS_RECHECK_MS, type OutboxSendFn } from "@/lib/outbox/worker";
import { createKbWithAutoMessage } from "../helpers/auto-message";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

type Change = "none" | "cancel" | "postpone" | "erase";

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
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Deniz Daire" } });
  await createKbWithAutoMessage({
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
      if (change === "erase") {
        // Misafir AÇIKÇA silindi (KVKK, tombstone) — durum "confirmed" kalır.
        const b = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-b" }, include: { property: true } });
        await eraseReservationData(b.property.organizationId, b.id);
      } else {
        const data =
          change === "cancel"
            ? { status: "cancelled" }
            : { arrivalDate: new Date(Date.now() + 90 * DAY), departureDate: new Date(Date.now() + 93 * DAY) };
        await prisma.reservation.updateMany({ where: { sourceReference: "res-b" }, data });
      }
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

  it("🚨 seçimden sonra misafir SİLİNDİ (KVKK) → giriş mesajı gitmez (Haiku 10-14 son doğrulama)", async () => {
    const orgId = await seed("checkin");
    changeBDuringFirstSend("erase");
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stampOf("res-b", "checkinSentAt")).toBeNull();
  });

  it("kardeş satır (aynı rezervasyonun çift satırı) aynı damgayla işaretlenir — ikinci gönderim YOK", async () => {
    const orgId = await seed("checkin");
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    // Yeniden bağlama sonrası çift satır: aynı sourceReference BAŞKA mülk satırında, iptal durumda (aday olamaz, ama damgalanmalı).
    const relinked = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Eski Kayıt" } });
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
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*"); // O1: liste açıkça bütün işletmeler (Opus F10: liste yoksa kimse)
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

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

  it("🚨 S8: sağlayıcının 'çok fazla istek' beklemesindeki satırın vadesi gönderici tarafından ŞİMDİYE ÇEKİLMEZ", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    let posts = 0;
    const limited: OutboxSendFn = async () => {
      posts++;
      return { ok: false, error: "Hospitable API hatası (HTTP 429): slow down", retryAfterMs: 10 * 60_000 };
    };
    await drainOutboxOnce({ send: limited, tokenFor: async () => "t" });
    expect(posts).toBe(1);
    const waiting = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(waiting.status).toBe("pending");
    expect(waiting.lastErrorKind).toBe("rate_limited");
    expect(waiting.availableAt.getTime()).toBeGreaterThan(Date.now() + 8 * 60_000);
    // Hız sınırı mesajın hatası değil: otomatik gönderim kaydında "reddedildi" izi kalmaz (kuyruk kapatılırsa doğrudan yol bekletmesin).
    expect(await prisma.automatedMessageSend.count({ where: { organizationId: orgId } })).toBe(0); // ⬅️ ESKİDE 1 ("failed")

    // Gönderici bir sonraki turda aynı rezervasyonu yine görür (damga yok) → "zaten kuyrukta" → vadeye DOKUNMAZ.
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    const after = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(after.availableAt.getTime()).toBe(waiting.availableAt.getTime()); // ⬅️ ESKİDE şimdiye çekiliyordu → 2 dakikada bir yeniden istek
    await drainOutboxOnce({ send: limited, tokenFor: async () => "t" });
    expect(posts).toBe(1); // bekleme sürerken sağlayıcıya ikinci istek yok
  });

  it("🚨 S8: kesin retten sonra geri çekilen satırın vadesi de öne çekilmez", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    const rejected: OutboxSendFn = async () => ({ ok: false, error: "Hospitable API hatası (HTTP 422): rejected" });
    await drainOutboxOnce({ send: rejected, tokenFor: async () => "t" });
    const waiting = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(waiting.status).toBe("pending");
    expect(waiting.lastErrorKind).toBe("definitive_failure");
    expect(waiting.availableAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    expect(await prisma.automatedMessageSend.count({ where: { organizationId: orgId, state: "failed" } })).toBe(1); // KONTROL: gerçek ret izi kalır
    await sendDueCheckins(orgId);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).availableAt.getTime()).toBe(waiting.availableAt.getTime());
  });

  it("S8: hata sonrası TARİHE göre ertelenen satır hata bilgisini bırakır → tarih geri gelince yine bekletmeden gider", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    await drainOutboxOnce({ send: async () => ({ ok: false, error: "Hospitable API hatası (HTTP 429): slow down", retryAfterMs: 60_000 }), tokenFor: async () => "t" });
    // Bekleme doldu sayılır; bu arada varış 3 ay ileri taşındı → işçi satırı tarihe göre erteler.
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date() } });
    await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { arrivalDate: new Date(Date.now() + 90 * DAY), departureDate: new Date(Date.now() + 93 * DAY) } });
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    const deferred = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(posts).toBe(0);
    expect(deferred.availableAt.getTime()).toBeGreaterThan(Date.now() + 80 * DAY);
    expect(deferred.lastErrorKind).toBeNull(); // artık hata yüzünden beklemiyor
    expect(deferred.lastErrorCode).toBeNull();

    await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { arrivalDate: new Date(Date.now() + 2 * DAY), departureDate: new Date(Date.now() + 5 * DAY) } });
    await sendDueCheckins(orgId);
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(1);
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
    const relinked = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Eski Kayıt" } });
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

  it("🚨 başka mülkteki BEKLEYEN / geçmiş kopya onaylı rezervasyonun giriş mesajını 'window_passed' ile iptal ETMEZ (Haiku 10-14 son tur)", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Başka Daire" } });
    // Aynı kaynak kimliği, bir ay ÖNCE bitmiş, "pending" kopya — en erken varış o; eski seçim onu alıp "window_passed" diyordu.
    await prisma.reservation.create({
      data: {
        propertyId: other.id,
        guestName: a.guestName,
        arrivalDate: new Date(Date.now() - 35 * DAY),
        departureDate: new Date(Date.now() - 30 * DAY),
        channel: "airbnb",
        status: "pending",
        sourceReference: "res-a",
      },
    });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(1);
  });

  it("🚨 onaylı kopya kalmadıysa erteleme satırın KENDİ rezervasyonunun tarihine bakar (kapı kodu haftalar önce gitmez)", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    await prisma.reservation.updateMany({
      where: { sourceReference: "res-a" },
      data: { status: "pending", arrivalDate: new Date(Date.now() + 40 * DAY), departureDate: new Date(Date.now() + 43 * DAY) },
    });
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(0);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.status).toBe("pending");
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 30 * DAY);
  });

  // ── D1 (Codex 11-17): ONAYI KALKMIŞ REZERVASYON ──────────────────────────────────────────────────────────────────────────────────────
  // Kuyruğa giriş "onaylı" ister; işçi gönderim anında yalnız "iptal değil" soruyordu. Onaylıyken kuyruğa girip gönderilmeden "bekliyor"a
  // dönen (tarihi AYNI, pencere içinde) rezervasyona giriş bilgisi — kapı kodu taşıyabilir — gidiyordu. Doğrudan yol bunu zaten yapmıyor.
  const holdSetup = async (kind: "welcome" | "checkin" | "checkout") => {
    if (kind === "checkout") {
      // Çıkış mesajı çıkış günü sabahı gider (İstanbul 09:00) — saat sabitlenir (yalnız `Date`; ↑kuyruksuz çıkış testiyle aynı kalıp).
      const at9 = new Date();
      at9.setUTCHours(6, 0, 0, 0);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at9);
    }
    const orgId = await seed(kind);
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    const enqueue = kind === "welcome" ? sendDueWelcomes : kind === "checkin" ? sendDueCheckins : sendDueCheckouts;
    expect((await enqueue(orgId)).sent).toBe(1);
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    const drain = () => drainOutboxOnce({ send, tokenFor: async () => "t" });
    const row = () => prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    return { orgId, drain, row, posts: () => posts };
  };

  it.each(["welcome", "checkin", "checkout"] as const)(
    "🚨 D1 (%s): kuyruğa girdikten sonra 'bekliyor'a dönen rezervasyona mesaj GİTMEZ — satır iptal edilmez, yeniden bakmak üzere ertelenir",
    async (kind) => {
      const { drain, row, posts } = await holdSetup(kind);
      await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { status: "pending" } }); // tarih AYNI
      const before = Date.now();
      await drain();
      expect(posts()).toBe(0); // ⬅️ ESKİDE 1: giriş bilgisi onayı kalkmış rezervasyona gidiyordu
      const held = await row();
      expect(held.status).toBe("pending"); // iptal DEĞİL
      expect(held.availableAt.getTime()).toBeGreaterThanOrEqual(before + LIFECYCLE_STATUS_RECHECK_MS - 1_000);
      expect(held.lastErrorCode).toBeNull(); // hata değil, bekleme (gönderici yeniden onaylanınca vadeyi öne çekebilsin)
      expect(held.attemptCount).toBe(0); // bekleme bir deneme sayılmaz
      const stamp = kind === "welcome" ? "welcomeSentAt" : kind === "checkin" ? "checkinSentAt" : "checkoutSentAt";
      expect(await stampOf("res-a", stamp)).toBeNull();
    },
  );

  it("🚨 D1: rezervasyon YENİDEN onaylanınca bekleyen satır gider (erteleme mesajı yutmaz; iptal edilseydi tek anahtar yüzünden hiç gitmezdi)", async () => {
    const { orgId, drain, row, posts } = await holdSetup("checkin");
    await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { status: "pending" } });
    await drain();
    expect(posts()).toBe(0);
    await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { status: "confirmed" } });
    // Bekleme süresi doldu (satırın vadesi geçmişe çekilir = 20 dakika sonrası).
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date(Date.now() - 1_000) } });
    await drain();
    expect(posts()).toBe(1);
    expect((await row()).status).toBe("sent");
    expect(await stampOf("res-a", "checkinSentAt")).not.toBeNull();
  });

  it("D1: hâlâ 'bekliyor'sa her bakışta yeniden ertelenir — deneme tavanını yemez, hiçbir zaman POST edilmez", async () => {
    const { orgId, drain, row, posts } = await holdSetup("checkin");
    await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { status: "pending" } });
    for (let i = 0; i < 4; i++) {
      await drain();
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date(Date.now() - 1_000) } });
    }
    expect(posts()).toBe(0);
    const held = await row();
    expect(held.status).toBe("pending");
    expect(held.attemptCount).toBe(0);
  });

  it("D1: karşılama — varış günü GEÇTİĞİ hâlde onaylanmamışsa satır bayattır, iptal edilir (sonsuz erteleme yok)", async () => {
    const { drain, row, posts } = await holdSetup("welcome");
    await prisma.reservation.updateMany({
      where: { sourceReference: "res-a" },
      data: { status: "pending", arrivalDate: new Date(Date.now() - 2 * DAY), departureDate: new Date(Date.now() + 2 * DAY) },
    });
    await drain();
    expect(posts()).toBe(0);
    const canceled = await row();
    expect(canceled.status).toBe("canceled");
    expect(canceled.lastErrorCode).toBe("reservation_not_confirmed");
  });

  it("D1: giriş — 'bekliyor' + çıkış günü geldiyse var olan pencere hükmü önce verilir (bekletilmez, iptal)", async () => {
    const { drain, row, posts } = await holdSetup("checkin");
    await prisma.reservation.updateMany({
      where: { sourceReference: "res-a" },
      data: { status: "pending", arrivalDate: new Date(Date.now() - 3 * DAY), departureDate: new Date(Date.now() - 1 * DAY) },
    });
    await drain();
    expect(posts()).toBe(0);
    const canceled = await row();
    expect(canceled.status).toBe("canceled");
    expect(canceled.lastErrorCode).toBe("window_passed");
  });

  it("D1 KONTROL: çıkış mesajı 'tamamlandı' durumunda gitmeye DEVAM eder (çıkış günü durum dönmüş olabilir)", async () => {
    const { drain, posts } = await holdSetup("checkout");
    await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { status: "completed" } });
    await drain();
    expect(posts()).toBe(1);
  });

  it("🚨 D1: satırın KENDİ kopyası 'bekliyor', başka dairedeki kardeş kopya onaylı → mesaj başka dairenin metniyle GİTMEZ, bekler", async () => {
    const { orgId, drain, row, posts } = await holdSetup("checkin");
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Başka Daire" } });
    await prisma.reservation.create({
      data: { propertyId: other.id, guestName: a.guestName, arrivalDate: a.arrivalDate, departureDate: a.departureDate, channel: "airbnb", status: "confirmed", sourceReference: "res-a" },
    });
    await prisma.reservation.update({ where: { id: a.id }, data: { status: "pending" } });
    await drain();
    expect(posts()).toBe(0);
    expect((await row()).status).toBe("pending");
  });

  // ── İKİ FARKLI DAİREDE KAYITLI REZERVASYON (kurucu 11-18 akşam; `booking-property-conflict.ts`) ─────────────────────────────────────
  it.each(["welcome", "checkin", "checkout"] as const)(
    "🚨 iki daire (%s): satır kuyruğa tek kayıtlıyken girdi, sonra aynı rezervasyon ikinci dairede de ETKİN kayıtlandı → mesaj GİTMEZ, ertelenir; yanlış kayıt kaldırılınca gider",
    async (kind) => {
      const { orgId, drain, row, posts } = await holdSetup(kind);
      const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
      const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Başka Daire" } });
      const sibling = await prisma.reservation.create({
        data: { propertyId: other.id, guestName: a.guestName, arrivalDate: a.arrivalDate, departureDate: a.departureDate, channel: "airbnb", status: "confirmed", sourceReference: "res-a" },
      });
      await drain();
      expect(posts()).toBe(0); // ⬅️ ESKİDE 1: hangi dairenin misafiri olduğu bilinmeden satırın dairesinin metni gidiyordu
      const held = await row();
      expect(held.status).toBe("pending"); // iptal DEĞİL — ev sahibi düzeltince gider
      expect(held.attemptCount).toBe(0);
      expect(held.lastErrorCode).toBeNull();

      await prisma.reservation.delete({ where: { id: sibling.id } }); // yanlış kayıt kaldırıldı
      await prisma.messageOutbox.update({ where: { id: held.id }, data: { availableAt: new Date() } }); // bekleme süresi doldu
      await drain();
      expect(posts()).toBe(1);
      expect((await row()).status).toBe("sent");
    },
  );

  // Opus 11-18 B-1: tutulan karşılama / giriş satırı varış günü GEÇİNCE bayattır. Karşılamanın pencere kuralı yoktu, giriş mesajınınki
  // çıkış gününe kadar açık → yanlış kayıt konaklamanın ortasında kaldırılınca mesaj o zaman giderdi.
  const midStay = { arrivalDate: new Date(Date.now() - 2 * DAY), departureDate: new Date(Date.now() + 2 * DAY) };
  it.each(["welcome", "checkin"] as const)(
    "🚨 iki daire (%s): tutulan satır varış günü GEÇTİYSE iptal edilir — yanlış kayıt konaklamanın ortasında kaldırılsa da mesaj GİTMEZ",
    async (kind) => {
      const { orgId, drain, row, posts } = await holdSetup(kind);
      const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
      const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Başka Daire" } });
      const sibling = await prisma.reservation.create({
        data: { propertyId: other.id, guestName: a.guestName, arrivalDate: a.arrivalDate, departureDate: a.departureDate, channel: "airbnb", status: "confirmed", sourceReference: "res-a" },
      });
      // Konaklama başladı (iki kayıt da aynı tarihte), çakışma sürüyor.
      await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: midStay });
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date(Date.now() - 1_000) } });
      await drain();
      expect(posts()).toBe(0);
      const canceled = await row();
      expect(canceled.status).toBe("canceled"); // ⬅️ ESKİDE "pending": yanlış kayıt kaldırılınca konaklamanın ortasında gidiyordu
      expect(canceled.lastErrorCode).toBe("window_passed");

      await prisma.reservation.delete({ where: { id: sibling.id } });
      await drain();
      expect(posts()).toBe(0);
    },
  );

  // Sınır (mutasyon b1-stale-on-arrival-day yaşadı → eksik pin): bayatlık varış günü GEÇİNCE başlar; varış GÜNÜNDE tutulan satır iptal
  // edilmez — ev sahibi o gün yanlış kaydı kaldırırsa mesaj hâlâ işe yarar ve gider.
  it.each(["welcome", "checkin"] as const)(
    "🚨 iki daire (%s): varış GÜNÜNDE tutulan satır iptal EDİLMEZ (bekler); yanlış kayıt o gün kaldırılınca gider",
    async (kind) => {
      const { orgId, drain, row, posts } = await holdSetup(kind);
      const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
      const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Başka Daire" } });
      const sibling = await prisma.reservation.create({
        data: { propertyId: other.id, guestName: a.guestName, arrivalDate: a.arrivalDate, departureDate: a.departureDate, channel: "airbnb", status: "confirmed", sourceReference: "res-a" },
      });
      // Varış ŞU AN (bugün), çıkış iki gün sonra — iki kayıt da aynı tarihte.
      await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: { arrivalDate: new Date(), departureDate: new Date(Date.now() + 2 * DAY) } });
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date(Date.now() - 1_000) } });
      await drain();
      expect(posts()).toBe(0);
      expect((await row()).status).toBe("pending"); // iptal DEĞİL

      await prisma.reservation.delete({ where: { id: sibling.id } });
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date(Date.now() - 1_000) } });
      await drain();
      expect(posts()).toBe(1);
      expect((await row()).status).toBe("sent");
    },
  );

  it.each(["welcome", "checkin"] as const)(
    "KONTROL (%s): çakışma YOKKEN varışı geçmiş kuyruk satırı eskisi gibi gider (yeni hüküm yalnız iki dairede kayıtlı rezervasyonda)",
    async (kind) => {
      const { orgId, drain, row, posts } = await holdSetup(kind);
      await prisma.reservation.updateMany({ where: { sourceReference: "res-a" }, data: midStay });
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date(Date.now() - 1_000) } });
      await drain();
      expect(posts()).toBe(1);
      expect((await row()).status).toBe("sent");
    },
  );

  it("iki daire (çıkış): tutulan çıkış mesajı varış geçti diye iptal EDİLMEZ (çıkış günü beklenir) — yanlış kayıt kaldırılınca gider", async () => {
    const { orgId, drain, row, posts } = await holdSetup("checkout");
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    expect(a.arrivalDate.getTime()).toBeLessThan(Date.now() - DAY / 2); // vakum değil: varış günü gerçekten geçmiş
    const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Başka Daire" } });
    const sibling = await prisma.reservation.create({
      data: { propertyId: other.id, guestName: a.guestName, arrivalDate: a.arrivalDate, departureDate: a.departureDate, channel: "airbnb", status: "confirmed", sourceReference: "res-a" },
    });
    await drain();
    expect(posts()).toBe(0);
    expect((await row()).status).toBe("pending");
    await prisma.reservation.delete({ where: { id: sibling.id } });
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date() } });
    await drain();
    expect(posts()).toBe(1);
  });

  it("🚨 kalıcı kuyruk: açıkça SİLİNEN misafire satır açılmaz; kuyruktaki satır gönderim anında 'erased' ile iptal (Haiku 10-14)", async () => {
    const orgId = await seed("checkin");
    await prisma.reservation.deleteMany({ where: { sourceReference: "res-b" } });
    // (a) kuyruktan SONRA silme → işçi POST etmez
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    const a = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-a" } });
    await eraseReservationData(orgId, a.id);
    // Silme yürütücüsü kuyruktaki satırı da iptal edebilir; vetoyu ayrıca sınamak için satırı bekler hâle döndür.
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "pending", body: "Merhaba,\n\ncheckin metni" } });
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(0);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).lastErrorCode).toBe("erased");
    // (b) silinmiş rezervasyon için YENİ satır açılmaz
    await prisma.messageOutbox.deleteMany({ where: { organizationId: orgId } });
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
