import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// S1 (kurucu kararı 11-11) — AYNI YAPAY ZEKÂ ÖNERİSİNİN ÇİFT ONAYI TEK MESAJDIR. Gerçek PostgreSQL, kanal taklit.
//
// Onayda her sekme kendi istek kimliğini üretiyordu → iki yönetici aynı öneriyi ayrı sekmelerde onaylayınca iki mesaj gidiyordu (doğrudan
// yolda yalnız 2 dakikalık aynı-metin engeli vardı; kalıcı kuyrukta o da yoktu). "Aynı metin" ile "aynı gönderim işlemi" aynı şey değil:
// misafir "adresi tekrar gönderir misiniz?" dediğinde aynı metnin yeniden gitmesi meşrudur; aynı önerinin iki kez onaylanması değildir.
//
// İşlemin kimliği artık "konuşma + önerinin üretildiği andaki konuşma sonu"dur (sunucu verir, sunucu doğrular). Yeni tablo / sütun yok.
// Elle yazılan cevap bu kuralın dışındadır.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, id: "sent-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
// Kuyruğa yazma GERÇEK; yalnız iki eşzamanlı onayın yarışını belirli kılmak için sarmalanır (↓ "aynı anda").
vi.mock("@/lib/outbox/enqueue", async (orig) => {
  const actual = await orig<typeof import("@/lib/outbox/enqueue")>();
  return { ...actual, enqueueOutbound: vi.fn(actual.enqueueOutbound) };
});

import { sendOnChannel } from "@/lib/messaging";
import { enqueueOutbound, SupersededRowRevivedError } from "@/lib/outbox/enqueue";
import { POST } from "@/app/api/conversations/[id]/reply/route";
import { OUTBOUND_REQUEST_CLAIM_PREFIX } from "@/lib/outbound-claim-name";
import { requeueFailedOutbox, listOutboxDeliveries } from "@/lib/outbox/ops";

const mockSend = vi.mocked(sendOnChannel);
const DUPLICATE_TEXT = "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor.";
/** Her sekme kendi istek kimliğini üretir (iki yönetici = iki farklı kimlik). */
const TAB_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TAB_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function outboxOn() {
  vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
}
function outboxOff() {
  vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
  vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "");
}

describe("yapay zekâ önerisinin onayı — işlem kimliği (S1)", () => {
  let orgId = "";
  let conversationId = "";
  let guestMessageId = "";

  const post = (conv: string, body: Record<string, unknown>) =>
    POST(new NextRequest(`http://localhost/api/conversations/${conv}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: conv }),
    });
  /** "Onayla ve gönder": öneri metni + sekmenin istek kimliği + önerinin üretildiği andaki konuşma sonu. */
  const approve = (text: string, tab: string, anchor = guestMessageId) => post(conversationId, { body: text, aiAssisted: true, requestId: tab, anchorMessageId: anchor });
  const outbound = () => prisma.message.findMany({ where: { conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" }, select: { body: true, aiAssisted: true } });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockSend.mockImplementation(async () => ({ ok: true, id: "sent-1" }));
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    const property = await prisma.property.create({ data: { organizationId: orgId, name: "Lale" } });
    const conv = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        guestIdentifier: "Guest",
        channel: "airbnb",
        externalReservationId: "res-1",
        status: "new",
        messages: { create: [{ direction: "inbound", authorType: "guest", senderName: "Ada", body: "Otopark var mı?", createdAt: new Date(Date.now() - 60_000) }] },
      },
      select: { id: true, messages: { select: { id: true } } },
    });
    conversationId = conv.id;
    guestMessageId = conv.messages[0].id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  });

  describe("doğrudan yol (kalıcı kuyruk kapalı)", () => {
    beforeEach(outboxOff);

    it("🚨 iki yönetici aynı öneriyi ayrı sekmelerden onaylar → TEK mesaj; ikinci onay 'gönderildi / gönderiliyor' cevabını alır", async () => {
      expect((await approve("Evet, binanın arkasında ücretsiz otopark var.", TAB_A)).status).toBe(201);
      const second = await approve("Evet, binanın arkasında ücretsiz otopark var.", TAB_B);
      expect(second.status).toBe(409);
      expect((await second.json()).error).toBe(DUPLICATE_TEXT);
      expect(mockSend).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 2 dakika sonra ikinci kez gidiyordu
      expect(await outbound()).toHaveLength(1);
    });

    it("🚨 aynı metin engelinin süresi (2 dk) geçtikten SONRA da ikinci onay gitmez (işlem kimliği metne bağlı değil)", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
      // 2 dakika geçti: kısa talepler düştü (gövde talebi); başarılı işlemin talebi 24 saate uzamıştı.
      await prisma.systemLock.updateMany({ where: { lockedUntil: { lt: new Date(Date.now() + 3 * 60_000) } }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
      expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(409); // ⬅️ ESKİDE 201 (ikinci mesaj)
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("🚨 iki yöneticinin önerisi bir iki kelime FARKLI olsa da ikinci onay gitmez (taslak metni değil, cevaplanan durum tekildir)", async () => {
      expect((await approve("Evet, binanın arkasında ücretsiz otopark var.", TAB_A)).status).toBe(201);
      const second = await approve("Evet, arkada ücretsiz otoparkımız var.", TAB_B);
      expect(second.status).toBe(409);
      expect((await second.json()).error).toBe(DUPLICATE_TEXT); // "farklı içerikle kullanılmış" çakışma metni değil
      expect((await outbound()).map((m) => m.body)).toEqual(["Evet, binanın arkasında ücretsiz otopark var."]);
    });

    it("🚨 işlemin talebi düşmüş olsa da (24 saat sonra) konuşma cevaplanmışsa eski sekmenin onayı gitmez", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
      await prisma.systemLock.deleteMany({});
      const late = await approve("Evet, otopark var.", TAB_B);
      expect(late.status).toBe(409);
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Reddedilen onay talep BIRAKMAZ (sonraki meşru işlemi kilitlemesin).
      expect(await prisma.systemLock.count({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } })).toBe(0);
    });

    it("🚨 başka biri ELLE cevapladıysa (yapay zekâ cevapladıysa) eski sekmedeki öneri onayı gitmez", async () => {
      for (const authorType of ["host", "ai", null]) {
        await prisma.message.deleteMany({ where: { conversationId, direction: "outbound" } });
        await prisma.systemLock.deleteMany({});
        mockSend.mockClear();
        await prisma.message.create({ data: { conversationId, direction: "outbound", authorType, senderName: "Ekip", body: "Arkada otopark var." } });
        const res = await approve("Evet, otopark var.", TAB_B);
        expect(res.status, String(authorType)).toBe(409);
        expect(mockSend, String(authorType)).not.toHaveBeenCalled();
      }
    });

    it("KONTROL: araya giren OTOMATİK şablon mesajı (karşılama / giriş bilgisi) cevap değildir — öneri onayı gider", async () => {
      await prisma.message.create({ data: { conversationId, direction: "outbound", authorType: "automation", senderName: "GuestOps AI", body: "Hoş geldiniz." } });
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("KONTROL: öneriden sonra YENİ misafir mesajı gelmesi onayı engellemez (bugünkü davranış: ev sahibi öneriyi yine kullanabilir)", async () => {
      await prisma.message.create({ data: { conversationId, direction: "inbound", authorType: "guest", senderName: "Ada", body: "Bir de havlu?" } });
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
    });

    it("KONTROL: cevaptan SONRA üretilen yeni öneri ayrı bir işlemdir (konuşma sonu değişti) — gider; o da iki kez gitmez", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
      const firstReply = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
      // Ev sahibi cevaptan sonra yeniden "AI cevap öner" dedi: konuşma sonu artık kendi cevabı.
      expect((await approve("Ek bilgi: otopark 24 saat açık.", TAB_A, firstReply.id)).status).toBe(201);
      expect((await approve("Ek bilgi: otopark 24 saat açık.", TAB_B, firstReply.id)).status).toBe(409);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("KONTROL: sağlayıcı KESİN reddederse işlem kilitlenmez — aynı öneri yeniden onaylanabilir", async () => {
      mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable API hatası (HTTP 422): rejected" });
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(502);
      expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(201);
      expect(await outbound()).toHaveLength(1);
    });

    describe("sonucu DOĞRULANAMAYAN gönderim (zaman aşımı / 5xx — mesaj ulaşmış olabilir)", () => {
      const UNVERIFIED = { ok: false as const, error: "Hospitable API hatası (HTTP 503): upstream timeout" };
      /** 2 dakika geçti: kısa talepler (aynı metin + istek) düşer; 24 saate uzatılmış talep durur. */
      const twoMinutesLater = () =>
        prisma.systemLock.updateMany({ where: { lockedUntil: { lt: new Date(Date.now() + 3 * 60_000) } }, data: { lockedUntil: new Date(Date.now() - 1_000) } });

      it("🚨 öteki yöneticinin 2 dakika SONRAKİ onayı aynı öneriyi körlemesine yeniden göndermez (mesaj ulaşmış, henüz içeri alınmamış olabilir)", async () => {
        mockSend.mockResolvedValueOnce(UNVERIFIED);
        const first = await approve("Evet, otopark var.", TAB_A);
        expect(first.status).toBe(502);
        expect((await first.json()).ambiguous).toBe(true);
        await twoMinutesLater();

        const second = await approve("Evet, otopark var.", TAB_B);
        expect(second.status).toBe(409); // ⬅️ ESKİDE 201: konuşmada henüz cevap satırı yok → ikinci kopya misafire giderdi
        expect((await second.json()).error).toBe(DUPLICATE_TEXT);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(await outbound()).toHaveLength(0); // doğrulanamayan gönderim kaydedilmez; senkron getirirse görünür
      });

      it("KONTROL: ev sahibi konuşmayı kontrol edip aynı metni KUTUDAN bilerek gönderebilir (ayrı, açık işlem — 2 dakika sonra)", async () => {
        mockSend.mockResolvedValueOnce(UNVERIFIED);
        expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(502);
        await twoMinutesLater();
        expect((await post(conversationId, { body: "Evet, otopark var.", requestId: TAB_B })).status).toBe(201);
        expect(mockSend).toHaveBeenCalledTimes(2);
      });

      it("KONTROL: ELLE cevapta kural aynen — doğrulanamayan gönderimden 2 dakika sonra aynı metin yeniden gönderilebilir", async () => {
        mockSend.mockResolvedValueOnce(UNVERIFIED);
        expect((await post(conversationId, { body: "Arkada otopark var.", requestId: TAB_A })).status).toBe(502);
        // 2 dakika dolmadan aynı metin gitmez (bugünkü kalkan).
        expect((await post(conversationId, { body: "Arkada otopark var.", requestId: TAB_B })).status).toBe(409);
        await twoMinutesLater();
        expect((await post(conversationId, { body: "Arkada otopark var.", requestId: TAB_B })).status).toBe(201);
        expect(mockSend).toHaveBeenCalledTimes(2);
      });

      it("KONTROL: KESİN ret sonrası (misafire ulaşmadığı belli) işlem kilitlenmez — 2 dakika beklemeden de yeniden onaylanır", async () => {
        mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable API hatası (HTTP 422): rejected" });
        expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(502);
        expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(201);
      });
    });

    it("KONTROL: ELLE yazılan cevap bu kuralın dışında — aynı misafir mesajına bilerek ikinci cevap yazılabilir", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
      expect((await post(conversationId, { body: "Ayrıca giriş kapının sağında.", requestId: TAB_B })).status).toBe(201);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("kalıcı kuyruk", () => {
    beforeEach(outboxOn);

    it("🚨 ikinci onay yeni gönderim AÇMAZ; var olan gönderimin DURUMUNU alır (kuyruktaki mesaja 'gönderildi' denmez)", async () => {
      expect((await approve("Evet, binanın arkasında ücretsiz otopark var.", TAB_A)).status).toBe(202);
      const second = await approve("Evet, arkada ücretsiz otoparkımız var.", TAB_B); // metni biraz farklı
      expect(second.status).toBe(200);
      expect((await second.json()).outbox).toEqual({ status: "queued", deduped: true, delivery: "pending" });
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1); // ⬅️ ESKİDE 2 satır = 2 mesaj
      expect((await outbound()).map((m) => m.body)).toEqual(["Evet, binanın arkasında ücretsiz otopark var."]);

      // Mesaj teslim edildikten sonra gelen üçüncü onay "gönderildi" durumunu alır.
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "sent" } });
      const third = await approve("Evet, binanın arkasında ücretsiz otopark var.", TAB_B);
      expect((await third.json()).outbox).toMatchObject({ deduped: true, delivery: "sent" });
      // Sonucu doğrulanamayan gönderimde de körlemesine yeniden gönderim yok: durum döner.
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "review" } });
      expect((await (await approve("Evet, otopark var.", TAB_B)).json()).outbox).toMatchObject({ deduped: true, delivery: "review" });
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    });

    it("🚨 ilk gönderim 'gönderilemedi' ile bittiyse öneri YENİDEN onaylanabilir (kesin ret işlemi kilitlemez); o yeniden deneme de tekildir", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(202);
      // Kanal mesajı kesin reddetti: satır "gönderilemedi" (misafire ulaşmadı); mesaj satırı konuşmada "gönderilemedi" etiketiyle duruyor.
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "failed" } });

      const retry = await approve("Evet, otopark var.", TAB_B);
      expect(retry.status).toBe(202); // ⬅️ (ilk yazımda) 200 + "gönderilemedi": işlem kilitli kalır, tek tıkla yeniden gönderilemezdi
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(2);
      // Aynı yeniden denemeyi öteki yönetici de onaylarsa yine tek gönderim.
      const again = await approve("Evet, otopark var.", TAB_A);
      expect(again.status).toBe(200);
      expect((await again.json()).outbox).toMatchObject({ deduped: true, delivery: "pending" });
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(2);

      // İptal edilen gönderim de (gönderim anında vazgeçildi) aynı: yeniden onaylanabilir.
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId, status: "pending" }, data: { status: "canceled" } });
      expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(202);
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(3);
    });

    describe("gönderim durumu ekranındaki elle 'yeniden dene' × yeniden onay (aynı öneri iki satırdan iki kez gitmez)", () => {
      const rows = () => prisma.messageOutbox.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, status: true, idempotencyKey: true } });
      const failFirst = async () => {
        expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(202);
        await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status: "failed", lastErrorKind: "definitive", lastErrorCode: "HTTP 422" } });
        return (await rows())[0];
      };
      const retryable = async (id: string) => (await listOutboxDeliveries(orgId)).rows.find((r) => r.id === id)?.retryable;

      it("🚨 öneri yeniden onaylandıktan sonra ESKİ 'gönderilemedi' satırı elle yeniden denenemez; listede de denenebilir görünmez", async () => {
        const old = await failFirst();
        expect(await retryable(old.id)).toBe(true); // henüz yerine yenisi açılmadı
        expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(202); // yeniden onay → yeni gönderim satırı

        expect(await requeueFailedOutbox(orgId, old.id)).toEqual({ outcome: "not_retryable", status: "failed" }); // ⬅️ ESKİDE "requeued": iki satır da giderdi
        expect((await rows()).map((r) => r.status)).toEqual(["failed", "pending"]); // eski satır "gönderilemedi"de kaldı
        expect(await retryable(old.id)).toBe(false);
      });

      it("zincirin UCU denenebilir kalır: yeniden onayın satırı da 'gönderilemedi' olursa O elle yeniden denenir, eskisi yine denenemez", async () => {
        const old = await failFirst();
        expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(202);
        const tip = (await rows())[1];
        await prisma.messageOutbox.update({ where: { id: tip.id }, data: { status: "failed", lastErrorKind: "definitive", lastErrorCode: "HTTP 422" } });

        expect(await retryable(old.id)).toBe(false);
        expect(await retryable(tip.id)).toBe(true);
        expect(await requeueFailedOutbox(orgId, old.id)).toMatchObject({ outcome: "not_retryable" });
        expect(await requeueFailedOutbox(orgId, tip.id)).toEqual({ outcome: "requeued" });
        expect((await rows()).map((r) => r.status)).toEqual(["failed", "pending"]);
      });

      it("KONTROL: yerine yenisi açılmamış 'gönderilemedi' öneri satırı elle yeniden denenir; ardından gelen onay yeni satır açmaz (durumu döner)", async () => {
        const old = await failFirst();
        expect(await requeueFailedOutbox(orgId, old.id)).toEqual({ outcome: "requeued" });
        const again = await approve("Evet, otopark var.", TAB_B);
        expect(again.status).toBe(200);
        expect((await again.json()).outbox).toMatchObject({ deduped: true, delivery: "pending" });
        expect(await rows()).toHaveLength(1);
      });

      it("KONTROL: başka işletmenin aynı anahtarlı satırı 'yerine açılmış' sayılmaz (işletme kapsamı)", async () => {
        const old = await failFirst();
        const other = await prisma.organization.create({ data: { name: "Other" } });
        await prisma.messageOutbox.create({
          data: { organizationId: other.id, channel: "airbnb", externalReservationId: "res-x", body: "x", idempotencyKey: `${old.idempotencyKey}:retry:${old.id}`, status: "pending", availableAt: new Date() },
        });
        expect(await retryable(old.id)).toBe(true);
        expect(await requeueFailedOutbox(orgId, old.id)).toEqual({ outcome: "requeued" });
      });

      it("🚨 YARIŞ: yeniden onay 'gönderilemedi' satırını gördükten SONRA, yeni satırı yazmadan ÖNCE o satır elle yeniden kuyruğa alınırsa yeni satır AÇILMAZ", async () => {
        const old = await failFirst();
        // Yarış belirli kılınır: onayın kuyruğa yazımından hemen önce öteki yönetici eski satırı "yeniden dene" ile kuyruğa alır.
        const real = vi.mocked(enqueueOutbound).getMockImplementation()!;
        vi.mocked(enqueueOutbound).mockImplementationOnce(async (args) => {
          expect(args.supersedes).toBe(old.id); // onay, yerine geçeceği satırı bildirir (kilitlenip yeniden doğrulanır)
          expect(await requeueFailedOutbox(orgId, old.id)).toEqual({ outcome: "requeued" });
          return real(args);
        });
        const res = await approve("Evet, otopark var.", TAB_B);
        expect(res.status).toBe(200); // ⬅️ ESKİDE 202 + ikinci satır: aynı öneri iki kez giderdi
        expect((await res.json()).outbox).toMatchObject({ status: "queued", deduped: true, delivery: "pending" });
        expect((await rows()).map((r) => r.status)).toEqual(["pending"]);
        expect(await outbound()).toHaveLength(1); // yarım kalan ikinci mesaj satırı da yok (işlem geri alındı)
      });

      describe("satır kilidi (iki işlem aynı satırda buluşur — kilit kalkarsa yarış geri gelir)", () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        /** Bir işlemi açık tutar: `work` bittikten sonra `release()` çağrılana dek COMMIT etmez. */
        function heldTransaction(work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
          let release!: () => void;
          const gate = new Promise<void>((r) => (release = r));
          let ready!: () => void;
          const started = new Promise<void>((r) => (ready = r));
          const done = prisma.$transaction(
            async (tx) => {
              await work(tx);
              ready();
              await gate;
            },
            { timeout: 20_000 },
          );
          return { started, release, done };
        }
        const retryRowArgs = (old: { id: string; idempotencyKey: string }) => ({
          organizationId: orgId,
          conversationId,
          channel: "airbnb",
          externalReservationId: "res-1",
          body: "Evet, otopark var.",
          senderName: "Ekip",
          authorType: "host" as const,
          messageType: "manual" as const,
          aiAssisted: true,
          idempotencyKey: `${old.idempotencyKey}:retry:${old.id}`,
          supersedes: old.id,
        });

        it("🚨 yeniden onayın yazımı, elle yeniden denemenin COMMIT'ini BEKLER ve güncel durumu görür (kilitsiz okuma eski 'gönderilemedi'yi görüp ikinci satırı açardı)", async () => {
          const old = await failFirst();
          // Elle yeniden deneme satırı güncelledi ama işlemi henüz bitmedi.
          const retry = heldTransaction(async (tx) => {
            await tx.messageOutbox.update({ where: { id: old.id }, data: { status: "pending" } });
          });
          await retry.started;
          const write = enqueueOutbound(retryRowArgs(old)).then(
            () => "yazıldı",
            (err: unknown) => err,
          );
          expect(await Promise.race([write, sleep(300).then(() => "bekliyor")])).toBe("bekliyor"); // ⬅️ kilit yoksa "yazıldı"
          retry.release();
          await retry.done;
          expect(await write).toBeInstanceOf(SupersededRowRevivedError);
          expect((await rows()).map((r) => r.status)).toEqual(["pending"]);
          expect(await outbound()).toHaveLength(1);
        });

        it("🚨 elle yeniden deneme, yeniden onayın COMMIT'ini BEKLER ve yerine açılan satırı görür (önceden bakıp sonra güncelleseydi iki satır da giderdi)", async () => {
          const old = await failFirst();
          // Yeniden onay: eski satırı paylaşımlı kilitledi, yeni satırı yazdı ama işlemi henüz bitmedi.
          const approval = heldTransaction(async (tx) => {
            await tx.$queryRaw`SELECT "status" FROM "MessageOutbox" WHERE "id" = ${old.id} FOR SHARE`;
            await tx.messageOutbox.create({
              data: { organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-1", body: "Evet, otopark var.", idempotencyKey: `${old.idempotencyKey}:retry:${old.id}`, status: "pending", availableAt: new Date() },
            });
          });
          await approval.started;
          const retry = requeueFailedOutbox(orgId, old.id);
          expect(await Promise.race([retry, sleep(300).then(() => "bekliyor")])).toBe("bekliyor");
          approval.release();
          await approval.done;
          expect(await retry).toEqual({ outcome: "not_retryable", status: "failed" }); // ⬅️ ön denetim + sonradan güncelleme: "requeued"
          expect((await rows()).map((r) => r.status)).toEqual(["failed", "pending"]);
        });

        it("KONTROL: yerine geçilecek satır artık YOKSA (silinmiş) yazım engellenmez; 'iptal' satırın yerine de yazılır", async () => {
          const old = await failFirst();
          await prisma.messageOutbox.update({ where: { id: old.id }, data: { status: "canceled" } });
          expect((await enqueueOutbound(retryRowArgs(old))).deduped).toBe(false);
          const gone = { id: "cmissingrow0000000000000000", idempotencyKey: old.idempotencyKey };
          expect((await enqueueOutbound({ ...retryRowArgs(gone), supersedes: gone.id })).deduped).toBe(false);
          expect(await rows()).toHaveLength(3);
        });
      });

      it("🚨 YARIŞ (gerçek eşzamanlılık): yeniden onay ile elle yeniden deneme AYNI ANDA — hangi sırayla bitseler de gönderilecek TEK satır kalır", async () => {
        for (let round = 0; round < 6; round++) {
          await prisma.messageOutbox.deleteMany({ where: { organizationId: orgId } });
          await prisma.message.deleteMany({ where: { conversationId, direction: "outbound" } });
          await prisma.systemLock.deleteMany({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } });
          const old = await failFirst();
          // Elle yeniden deneme her turda biraz daha geç başlar → iki işlemin kesişme noktası turdan tura değişir (sıra şansa kalır,
          // sonuç kalmaz: aşağıdaki iki iddia her sırada tutmalı).
          const lateRetry = new Promise<Awaited<ReturnType<typeof requeueFailedOutbox>>>((resolve, reject) =>
            setTimeout(() => requeueFailedOutbox(orgId, old.id).then(resolve, reject), [0, 1, 3, 6, 10, 15][round]),
          );
          const [approval, retry] = await Promise.all([approve("Evet, otopark var.", round % 2 ? TAB_A : TAB_B), lateRetry]);
          const live = (await rows()).filter((r) => r.status !== "failed");
          expect(live, `tur ${round}: onay ${approval.status}, yeniden deneme ${retry.outcome}`).toHaveLength(1);
          // İkisi birden "ben gönderiyorum" diyemez: ya eski satır dirildi (onay onun durumunu aldı) ya yenisi açıldı (eski denenemedi).
          expect([approval.status === 202, retry.outcome === "requeued"].filter(Boolean), `tur ${round}`).toHaveLength(1);
        }
      });
    });

    it("KONTROL: abonelik yüzünden bekleyen ('engellendi') ya da sonucu doğrulanamayan gönderim yeniden DENENMEZ — durumu döner", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(202);
      for (const status of ["blocked", "review", "ambiguous", "sending"]) {
        await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { status } });
        const res = await approve("Evet, otopark var.", TAB_B);
        expect(res.status, status).toBe(200);
        expect((await res.json()).outbox, status).toMatchObject({ deduped: true, delivery: status });
      }
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    });

    it("🚨 iki onay AYNI ANDA (ikisi de 'henüz gönderim yok' görüp kuyruğa yazmaya gider): tek satır; kaybeden 'farklı içerik' hatası almaz", async () => {
      // Yarış belirli kılınır: bizim kuyruğa yazımımızdan hemen önce öteki yöneticinin (metni biraz farklı) yazımı tamamlanır.
      const real = vi.mocked(enqueueOutbound).getMockImplementation()!;
      vi.mocked(enqueueOutbound).mockImplementationOnce(async (args) => {
        await real({ ...args, body: "Evet, binanın arkasında ücretsiz otopark var." });
        return real(args);
      });
      const loser = await approve("Evet, arkada ücretsiz otoparkımız var.", TAB_B);
      expect(loser.status).toBe(200); // ⬅️ içerik denetimi işlem kimliğinde de uygulansaydı 409 "farklı içerikle kullanılmış"
      expect((await loser.json()).outbox).toMatchObject({ status: "queued", deduped: true, delivery: "pending" });
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
      expect((await outbound()).map((m) => m.body)).toEqual(["Evet, binanın arkasında ücretsiz otopark var."]);
    });

    it("🚨 başka biri elle cevapladıysa kuyruğa yeni satır yazılmaz", async () => {
      await prisma.message.create({ data: { conversationId, direction: "outbound", authorType: "host", senderName: "Ekip", body: "Arkada otopark var." } });
      const res = await approve("Evet, otopark var.", TAB_B);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(DUPLICATE_TEXT);
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0);
      expect(await prisma.systemLock.count({ where: { name: { startsWith: OUTBOUND_REQUEST_CLAIM_PREFIX } } })).toBe(0);
    });

    it("🚨 kuyruk ve doğrudan yol AYNI işlem kimliğini kullanır: anahtar arada kapatılsa / açılsa da ikinci gönderim doğmaz", async () => {
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(202);
      outboxOff();
      const afterOff = await approve("Evet, otopark var.", TAB_B);
      expect(afterOff.status).toBe(200); // kuyruk satırının durumu
      expect(mockSend).not.toHaveBeenCalled();

      // Ters yön: doğrudan giden onay, anahtar açılınca kuyruğa ikinci kez yazılmaz.
      await prisma.messageOutbox.deleteMany({});
      await prisma.message.deleteMany({ where: { conversationId, direction: "outbound" } });
      await prisma.systemLock.deleteMany({});
      expect((await approve("Evet, otopark var.", TAB_A)).status).toBe(201);
      outboxOn();
      expect((await approve("Evet, otopark var.", TAB_B)).status).toBe(409);
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0);
    });

    it("KONTROL: elle cevapta istek kimliği kuralı aynen — aynı kimlik + farklı içerik çakışmadır", async () => {
      expect((await post(conversationId, { body: "İlk metin", requestId: TAB_A })).status).toBe(202);
      expect((await post(conversationId, { body: "Başka metin", requestId: TAB_A })).status).toBe(409);
    });
  });

  describe("sunucu konuşma sonunu DOĞRULAR (istemciye güvenilmez)", () => {
    beforeEach(outboxOff);

    it("🚨 başka konuşmanın (başka işletmenin) mesaj kimliği kabul edilmez — hiçbir şey gönderilmez", async () => {
      const otherOrg = await prisma.organization.create({ data: { name: "Öteki" } });
      const otherProperty = await prisma.property.create({ data: { organizationId: otherOrg.id, name: "Öteki 1" } });
      const other = await prisma.conversation.create({
        data: { propertyId: otherProperty.id, guestIdentifier: "X", channel: "airbnb", externalReservationId: "res-x", status: "new", messages: { create: [{ direction: "inbound", senderName: "X", body: "?" }] } },
        select: { messages: { select: { id: true } } },
      });
      const res = await approve("Evet, otopark var.", TAB_A, other.messages[0].id);
      expect(res.status).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
      expect((await approve("Evet, otopark var.", TAB_A, "olmayan-mesaj-kimligi")).status).toBe(400);
      expect((await approve("Evet, otopark var.", TAB_A, "../../etc")).status).toBe(400); // biçim dışı
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("konuşma sonu yalnız ÖNERİ ONAYINDA anlam taşır: elle cevapta gönderilse de yok sayılır (kimlik istek kimliğidir)", async () => {
      expect((await post(conversationId, { body: "Elle yazdım.", requestId: TAB_A, anchorMessageId: guestMessageId })).status).toBe(201);
      expect((await post(conversationId, { body: "Yine elle yazdım.", requestId: TAB_B, anchorMessageId: guestMessageId })).status).toBe(201);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("KONTROL: konuşma sonu gönderilmeyen öneri onayı (eski istemci) bugünkü gibi istek kimliğiyle çalışır", async () => {
      expect((await post(conversationId, { body: "Evet, otopark var.", aiAssisted: true, requestId: TAB_A })).status).toBe(201);
      expect((await outbound())[0].aiAssisted).toBe(true);
    });
  });
});
