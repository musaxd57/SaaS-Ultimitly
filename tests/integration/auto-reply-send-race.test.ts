import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";

// ---------------------------------------------------------------------------
// OTOMATİK CEVAP — GÖNDERİM SÜRERKEN OLANLAR (Codex 11-10, A24 + A25). Gerçek PostgreSQL; model ve kanal taklit. Sıra BELİRLENİMCİ:
// araya giren iş, kanal gönderiminin (taklit) İÇİNDE çalışır — yani talep alındıktan SONRA, sonuç yazılmadan ÖNCE.
//
// A24: gönderim KESİN hatayla düşünce konuşma koşulsuz "Yeni" yapılıyordu → o arada ev sahibinin verdiği "Sorunlu" / "Tamamlandı" kararı
//      siliniyor, "Sorunlu"nun durdurduğu otomatik cevap yeniden deneniyordu (asıl cevap + nezaket cevabı).
// A25: cevap satırı teslimden SONRA yazılıyor ve zamanı kayıt anı oluyordu → gönderim sürerken içeri alınan misafir mesajı (cevap onu
//      görmeden yazıldı) cevaptan ÖNCE sıralanıyor: sonraki geçiş "son mesaj giden" deyip cevaplamıyor, sonraki senkron da "geç içeri alınan
//      mesaj" saymadığı için konuşmayı "Cevaplandı" yapıyordu — soru gelen kutusunda görünmeden kayboluyordu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { lateGuestMessages } from "@/lib/message-author";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const SAFE_REPLY = {
  intent: "checkin",
  confidence: 0.9,
  reply: "Check-in saat 15:00, hoş geldiniz!",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};
const DEFINITIVE = { ok: false as const, error: "Hospitable API hatası (HTTP 400): bad request" };

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul", aiSignature: "Sevgiler,\nLale" },
  });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale Daire" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: "Giriş saat kaçta?", createdAt: new Date(Date.now() - 60_000), ingestedAt: new Date(Date.now() - 50_000) }] },
    },
    select: { id: true },
  });
  return { orgId: org.id, conversationId: conversation.id };
}
const convo = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id }, select: { status: true, skippedReason: true, autoReplyHoldUntil: true } });

/**
 * Gönderim taklidinin "şimdi"si: gerçek sağlayıcı isteği zaman alır, o yüzden gönderim SIRASINDA içeri alınan mesajın alınma anı talep
 * anından KESİN sonradır. Taklit anında dönerse hızlı makinede iki an AYNI milisaniyeye düşebiliyor; "geç mesaj" ölçütü bilinçli olarak
 * kesin büyüktür (aynı milisaniyede alınan mesaj çoğu kez cevaplanan mesajın KENDİSİDİR), test rastlantıya kalıyordu — CI 1781'de bir kez
 * kırmızı. Saat dondurularak birebir üretildi; birkaç milisaniye beklemek durumu gerçeğe uydurur.
 */
async function afterProviderDelay(): Promise<Date> {
  await new Promise((r) => setTimeout(r, 5));
  return new Date();
}

describe("otomatik cevap — gönderim sürerken", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSuggest.mockResolvedValue(SAFE_REPLY);
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("A24 — kesin gönderim hatası ev sahibinin kararını EZMEZ", () => {
    it.each(["problem", "closed"])("🚨 gönderim sürerken konuşma '%s' yapıldı → kesin hatadan sonra durum AYNI kalır, geri çekilme notu yazılmaz", async (decided) => {
      const { conversationId } = await seed();
      mockSend.mockImplementationOnce(async () => {
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: decided } }); // ev sahibi karar verdi
        return DEFINITIVE;
      });
      const out = await applyChannelAutoReply(conversationId);
      expect(out.sent).toBe(false);
      const c = await convo(conversationId);
      expect(c.status).toBe(decided); // ⬅️ ESKİDE "new" (karar siliniyordu)
      expect(c.skippedReason).toBeNull();
      expect(c.autoReplyHoldUntil).toBeNull();
    });

    it("KONTROL: araya giren yoksa kesin hata talebi geri alır — 'Yeni' + geri çekilme + sebep kodu (bugünkü davranış)", async () => {
      const { conversationId } = await seed();
      mockSend.mockResolvedValueOnce(DEFINITIVE);
      await applyChannelAutoReply(conversationId);
      const c = await convo(conversationId);
      expect(c.status).toBe("new");
      expect(c.skippedReason).toBe("send_failed");
      expect(c.autoReplyHoldUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it("gönderim sürerken senkron konuşmayı 'Yeni' yaptı (yeni misafir mesajı) → durum 'Yeni' kalır ve geri çekilme YİNE yazılır (kalıcı hata döngüsü yok)", async () => {
      const { conversationId } = await seed();
      mockSend.mockImplementationOnce(async () => {
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: "new" } });
        return DEFINITIVE;
      });
      await applyChannelAutoReply(conversationId);
      const c = await convo(conversationId);
      expect(c.status).toBe("new");
      expect(c.skippedReason).toBe("send_failed");
      expect(c.autoReplyHoldUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it("gönderim sürerken konuşma 'Beklemede' yapıldı → durum 'Beklemede' kalır ama geri çekilme yazılır (Beklemede otomatik cevaba uygundur; kalıcı hatada her geçişte yeniden modellenmesin)", async () => {
      const { conversationId } = await seed();
      mockSend.mockImplementationOnce(async () => {
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: "waiting" } });
        return DEFINITIVE;
      });
      await applyChannelAutoReply(conversationId);
      const c = await convo(conversationId);
      expect(c.status).toBe("waiting");
      expect(c.skippedReason).toBe("send_failed");
      expect(c.autoReplyHoldUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    describe("nezaket cevabı", () => {
      async function seedClosing() {
        const { orgId, conversationId } = await seed();
        await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });
        await prisma.message.create({
          data: { conversationId, direction: "outbound", senderName: "Host", body: "Wi-Fi şifresi Lale2025.", createdAt: new Date(Date.now() - 30_000) },
        });
        await prisma.message.create({
          data: { conversationId, direction: "inbound", senderName: "Alex", body: "Tamam, çok teşekkürler! 🙏", createdAt: new Date(), ingestedAt: new Date() },
        });
        return { conversationId };
      }

      it("🚨 nezaket cevabı gönderilirken konuşma 'Sorunlu' yapıldı → kesin hatadan sonra 'Sorunlu' KALIR", async () => {
        const { conversationId } = await seedClosing();
        mockSend.mockImplementationOnce(async () => {
          await prisma.conversation.update({ where: { id: conversationId }, data: { status: "problem" } });
          return DEFINITIVE;
        });
        await applyChannelAutoReply(conversationId);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect((await convo(conversationId)).status).toBe("problem"); // ⬅️ ESKİDE "new"
      });

      it("KONTROL: araya giren yoksa nezaket cevabının kesin hatası talebi geri alır ('Yeni')", async () => {
        const { conversationId } = await seedClosing();
        mockSend.mockResolvedValueOnce(DEFINITIVE);
        await applyChannelAutoReply(conversationId);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect((await convo(conversationId)).status).toBe("new");
      });

      it("nezaket cevabının satır zamanı talep anıdır: gönderim sırasında içeri alınan misafir mesajı 'geç' sayılır", async () => {
        const { conversationId } = await seedClosing();
        let lateId = "";
        mockSend.mockImplementationOnce(async () => {
          const at = await afterProviderDelay();
          lateId = (
            await prisma.message.create({
              data: { conversationId, direction: "inbound", senderName: "Alex", body: "Bir de otopark var mı?", createdAt: new Date(at.getTime() - 20_000), ingestedAt: at },
            })
          ).id;
          return { ok: true, providerMessageId: "prov-c" };
        });
        await applyChannelAutoReply(conversationId);
        const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        expect(rows.some((m) => m.aiIntent === "closing_courtesy")).toBe(true);
        expect(lateGuestMessages(rows).map((m) => m.id)).toEqual([lateId]); // ⬅️ ESKİDE [] (konuşma sonraki senkronda "Cevaplandı" oluyordu)
      });
    });
  });

  describe("A25 — cevap gönderilirken içeri alınan misafir mesajı kaybolmaz", () => {
    it("🚨 cevap yoldayken YAZILAN soru: cevabın satır zamanı talep anı → soru cevaptan SONRA sıralanır, sonraki geçiş onu cevaplar", async () => {
      const { conversationId } = await seed();
      let q2 = "";
      mockSend.mockImplementationOnce(async () => {
        // Senkron, gönderim sürerken misafirin yeni sorusunu içeri aldı (sağlayıcı zamanı = şimdi) ve konuşmayı "Yeni" yaptı.
        const at = await afterProviderDelay();
        q2 = (await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Alex", body: "Otopark var mı?", createdAt: at, ingestedAt: at } })).id;
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: "new" } });
        return { ok: true, providerMessageId: "prov-1" };
      });
      expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
      const reply = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
      const late = await prisma.message.findUniqueOrThrow({ where: { id: q2 } });
      expect(reply.createdAt.getTime()).toBeLessThanOrEqual(late.ingestedAt!.getTime()); // ⬅️ ESKİDE cevap satırı sorudan SONRA görünüyordu
      expect((await convo(conversationId)).status).toBe("new"); // soru cevapsız: konuşma "Cevaplandı" yapılmadı

      mockSuggest.mockResolvedValueOnce({ ...SAFE_REPLY, reply: "Evet, binanın önünde ücretsiz otopark var." });
      mockSend.mockResolvedValueOnce({ ok: true, providerMessageId: "prov-2" });
      const second = await applyChannelAutoReply(conversationId);
      expect(second.skippedReason).not.toBe("already_answered"); // ⬅️ ESKİDE "already_answered" (soru yapay zekâya hiç gitmiyordu)
      expect(second.sent).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("🚨 cevaptan ÖNCE yazılmış ama gönderim sırasında içeri alınan soru: 'geç içeri alınan mesaj' sayılır (senkron konuşmayı 'Yeni' tutar)", async () => {
      const { conversationId } = await seed();
      let q2 = "";
      mockSend.mockImplementationOnce(async () => {
        const at = await afterProviderDelay();
        // Misafir bunu 20 sn önce (bizim talebimizden önce) yazdı; senkron ancak şimdi aldı.
        q2 = (
          await prisma.message.create({
            data: { conversationId, direction: "inbound", senderName: "Alex", body: "Otopark var mı?", createdAt: new Date(at.getTime() - 20_000), ingestedAt: at },
          })
        ).id;
        return { ok: true, providerMessageId: "prov-1" };
      });
      expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
      const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      expect(rows[0].direction).toBe("outbound"); // satır sırasında son mesaj bizim cevabımız
      // Senkronun "Yeni" tutma ve uyarı geçişinin tarama ölçütü (`lateGuestMessages`) bu soruyu GÖRÜR.
      expect(lateGuestMessages(rows).map((m) => m.id)).toEqual([q2]); // ⬅️ ESKİDE [] → sonraki senkron konuşmayı "Cevaplandı" yapıyordu
    });

    it("KONTROL: gönderim sırasında hiçbir şey gelmediyse geç mesaj yok, konuşma 'Cevaplandı'", async () => {
      const { conversationId } = await seed();
      mockSend.mockResolvedValueOnce({ ok: true, providerMessageId: "prov-1" });
      expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
      const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      expect(lateGuestMessages(rows)).toEqual([]);
      expect((await convo(conversationId)).status).toBe("answered");
    });
  });
});
