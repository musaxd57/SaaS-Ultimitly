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
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { POST } from "@/app/api/conversations/[id]/reply/route";
import { OUTBOUND_REQUEST_CLAIM_PREFIX } from "@/lib/outbound-claim-name";

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
