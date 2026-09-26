// ---------------------------------------------------------------------------
// İPTAL EDİLMİŞ KONAKLAMAYA OTOMATİK MİSAFİR MESAJI (denetim, 08-08)
//
// Bir denetim ajanı "iptal edilmiş rezervasyonun misafirine otomatik mesaj
// gidebiliyor" dedi ve İKİ satır gösterdi. Bu dosya İKİSİNİ DE ölçer:
//
//  · `automation.ts` bekletme-mesajı (holding ack) yolu — `sendDueAlerts`'in
//    aday sorgusunda REZERVASYON DURUMU FİLTRESİ YOK ve `maybeSendHoldingAck`
//    de bakmıyordu → BAĞLI + İPTAL bir konaklamada misafire otomatik mesaj.
//    ⇒ GERÇEK.
//
//  · `applyChannelAutoReply`'ın iptal kapılarının `if (conversation.reservation)`
//    bloğunun İÇİNDE olması → BAĞSIZ konuşmada kapı hiç değerlendirilmiyor.
//    ⇒ Kod olarak DOĞRU, ama bilinçli: bağsız konuşma aynı zamanda REZERVASYON
//    ÖNCESİ satış sorusudur (`prompts.ts` preBookingBlock). Ölü bağsız thread'i
//    senkron katmanındaki `fenceUnlinkedTerminalStay` damgalıyor — AMA o damgayı
//    yalnız MODEL yolu okuyor; `sendDueAlerts` `skippedReason`/
//    `autoReplyAttemptedAt`'e HİÇ bakmıyor → çitin kör noktası.
//
// 🚨 HER SENARYO KAPIYA GERÇEKTEN ULAŞMALI. Bu depoda daha önce "tuzak" testler
//    boru hattının ERKEN bir aşamasında vetolandığı için hiçbir şey iddia
//    etmeden yeşil kalmıştı. Bu yüzden her bloğun bir KONTROL vakası var:
//    aynı tohum, yalnız durum farklı → mesaj GİDİYOR. Kontrol kırmızıya
//    dönmeden hiçbir "gitmedi" iddiası anlamlı değildir.
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
vi.mock("@/lib/email", () => ({
  emailService: {
    send: vi.fn(),
    sendReporting: vi.fn(async () => ({ ok: true })),
  },
}));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import {
  sendDueAlerts,
  applyChannelAutoReply,
  sendDueWelcomes,
  sendDueCheckins,
  sendDueCheckouts,
} from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockEmail = vi.mocked(emailService.sendReporting);

// Kelime ağının ŞİKAYET saydığı, ama para/güvenlik/tehdit/insan-talebi
// sinyali TAŞIMAYAN bir mesaj: `holdingAckEligible` true → ack ADAYI.
// (Aynı cümle `holding-ack.test.ts`'te de "ack gider" tarafını pinliyor.)
const MILD_COMPLAINT = "Klima çalışmıyor, içerisi çok sıcak!";

const DAY = 24 * 60 * 60 * 1000;

type SeedOpts = {
  /** null → konuşma HİÇBİR yerel rezervasyona bağlı değil (bağsız thread). */
  reservationStatus: string | null;
  /** Senkronun ölü-konaklama çiti (`fenceUnlinkedTerminalStay`) damgası. */
  skippedReason?: string | null;
  holdingAck?: boolean;
  guestMessage?: string;
};

/** Org + daire + "new" bir konuşma; misafir son konuşan taraf. */
async function seed(opts: SeedOpts) {
  const org = await prisma.organization.create({
    data: {
      name: "İptal Org",
      alertEmail: "host@example.com",
      autoHoldingReplyEnabled: opts.holdingAck ?? false,
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0, // başlangıç === bitiş → pencere HER ZAMAN açık
      timezone: "Europe/Istanbul",
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Deniz Daire" },
  });

  let reservationId: string | null = null;
  if (opts.reservationStatus !== null) {
    const r = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Ayşe Yılmaz",
        // Konaklama HÂLÂ SÜRÜYOR: `applyChannelAutoReply`'ın "ayrılmış misafir"
        // kapısı devreye girmesin ki ölçülen tek değişken DURUM olsun.
        arrivalDate: new Date(Date.now() - DAY),
        departureDate: new Date(Date.now() + 2 * DAY),
        channel: "airbnb",
        status: opts.reservationStatus,
        sourceReference: "res-c1",
      },
    });
    reservationId = r.id;
  }

  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId,
      guestIdentifier: "Ayşe Yılmaz",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-c1",
      lastMessageAt: new Date(),
      ...(opts.skippedReason ? { skippedReason: opts.skippedReason } : {}),
      messages: {
        create: {
          direction: "inbound",
          senderName: "Ayşe Yılmaz",
          body: opts.guestMessage ?? MILD_COMPLAINT,
        },
      },
    },
  });
  return { org, property, conversation, reservationId };
}

async function outboundBodies(conversationId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, direction: "outbound" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.body);
}

// ---------------------------------------------------------------------------
// 1) KELİME YOLU — sendDueAlerts → maybeSendHoldingAck
// ---------------------------------------------------------------------------
describe("bekletme mesajı (holding ack) — iptal edilmiş konaklama", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL: AYNI tohum, rezervasyon 'confirmed' → ack GİDER (senaryo kapıya ulaşıyor)", async () => {
    // Bu vaka olmadan aşağıdaki "gitmedi" iddiaları hiçbir şey kanıtlamaz:
    // mesaj erken bir aşamada (uygunluk / premium / token / pencere) elenmiş
    // olabilirdi. Kontrol yeşil = kapıya GERÇEKTEN varılıyor.
    const { org, conversation } = await seed({
      reservationStatus: "confirmed",
      holdingAck: true,
    });
    const r = await sendDueAlerts(org.id);
    expect(r.alerted).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await outboundBodies(conversation.id)).toHaveLength(1);
  });

  it("BAĞLI + İPTAL rezervasyon → misafire HİÇBİR otomatik mesaj gitmez", async () => {
    const { org, conversation } = await seed({
      reservationStatus: "cancelled",
      holdingAck: true,
    });
    await sendDueAlerts(org.id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundBodies(conversation.id)).toHaveLength(0);
  });

  it("BAĞLI + İPTAL: host UYARISI YİNE GİDER ve thread 'Sorunlu' olur", async () => {
    // Düzeltmenin misafire giden mesajı susturması gerekir — İNSANA giden
    // bildirimi DEĞİL. Bu ayrım ürünün "riskli mesaj insana gider" sözünün
    // tam kendisi; aday sorgusuna rezervasyon filtresi koymak (kolay çözüm)
    // bu satırı KIRARDI.
    const { org, conversation } = await seed({
      reservationStatus: "cancelled",
      holdingAck: true,
    });
    const r = await sendDueAlerts(org.id);
    expect(r.alerted).toBe(1);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(conv?.status).toBe("problem");
    expect(conv?.skippedReason).toBe("complaint");
  });

  it("BAĞSIZ + senkron çiti damgalı (reservation_ended) → ack gitmez", async () => {
    // `fenceUnlinkedTerminalStay` (hospitable-sync) bağsız + ölü konaklamayı
    // damgalar. O damgayı YALNIZ model yolunun aday sorgusu okuyor;
    // `sendDueAlerts` `skippedReason`/`autoReplyAttemptedAt`'e hiç bakmıyordu →
    // çitin kör noktası.
    const { org, conversation } = await seed({
      reservationStatus: null,
      skippedReason: "reservation_ended",
      holdingAck: true,
    });
    await sendDueAlerts(org.id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundBodies(conversation.id)).toHaveLength(0);
    // Uyarı yine gitmeli.
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it("AŞIRI ENGELLEME YOK: bağsız + damgasız (rezervasyon ÖNCESİ soru) → ack GİDER", async () => {
    // Bağsız konuşmanın tamamını susturmak bilinçli bir ürün davranışını
    // (rezervasyon öncesi satış sorusuna cevap) öldürürdü. Bu vaka, düzeltmenin
    // o yöne taşmadığını pinler.
    const { org, conversation } = await seed({
      reservationStatus: null,
      holdingAck: true,
    });
    await sendDueAlerts(org.id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await outboundBodies(conversation.id)).toHaveLength(1);
  });

  it("KONTROL: 'pending' ve 'completed' konaklamalarda ack GİDER (yalnız iptal engellenir)", async () => {
    for (const status of ["pending", "completed"]) {
      await resetDb();
      vi.clearAllMocks();
      mockSend.mockResolvedValue({ ok: true } as never);
      const { org } = await seed({ reservationStatus: status, holdingAck: true });
      await sendDueAlerts(org.id);
      expect(mockSend, `status=${status}`).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 2) MODEL YOLU — applyChannelAutoReply
// ---------------------------------------------------------------------------
describe("applyChannelAutoReply — iptal / bağsız rezervasyon", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const benignVerdict = {
    intent: "wifi",
    confidence: 0.95,
    reply: "Wifi şifresi giriş kapısının yanındaki kartta yazıyor.",
    risk: null,
    priority: "standard" as const,
    source: "openai" as const,
    actionSuggestion: null,
    riskLevel: "low",
    detectedLanguage: "tr",
    riskType: null as string | null,
    usedSources: [] as string[],
    missingInfo: [] as string[],
    statedCheckoutTime: null,
  };

  it("KONTROL: BAĞLI + 'confirmed' → oto-yanıt GİDER", async () => {
    const { conversation } = await seed({
      reservationStatus: "confirmed",
      guestMessage: "Wifi şifresi nedir?",
    });
    mockSuggest.mockResolvedValue(benignVerdict as never);
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("BAĞLI + İPTAL → 'reservation_ended', model HİÇ çağrılmaz (mevcut kapı — regresyon pini)", async () => {
    const { conversation } = await seed({
      reservationStatus: "cancelled",
      guestMessage: "Wifi şifresi nedir?",
    });
    mockSuggest.mockResolvedValue(benignVerdict as never);
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(false);
    expect(r.skippedReason).toBe("reservation_ended");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("BAĞLI + İPTAL + şikayet: bekletme mesajı da GİTMEZ", async () => {
    const { conversation } = await seed({
      reservationStatus: "cancelled",
      holdingAck: true,
    });
    mockSuggest.mockResolvedValue({
      ...benignVerdict,
      intent: "complaint",
      riskLevel: "medium",
      confidence: 0.9,
    } as never);
    await applyChannelAutoReply(conversation.id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await outboundBodies(conversation.id)).toHaveLength(0);
  });

  it("BELGELENMİŞ SINIR: BAĞSIZ konuşmada iptal kapısı DEĞERLENDİRİLMEZ (kasıtlı)", async () => {
    // Bu, ajanın gösterdiği ikinci satırın ölçülmüş hâli: kapı gerçekten
    // `if (conversation.reservation)` içinde. DÜZELTİLMEDİ — bağsız thread
    // aynı zamanda rezervasyon ÖNCESİ sorudur ve ona cevap vermek bilinçli
    // ürün davranışı. Ölü bağsız thread'in doğru yeri senkron çitidir.
    const { conversation } = await seed({
      reservationStatus: null,
      guestMessage: "Wifi şifresi nedir?",
    });
    mockSuggest.mockResolvedValue(benignVerdict as never);
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.skippedReason).not.toBe("reservation_ended");
    expect(r.sent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3) YAŞAM DÖNGÜSÜ — karşılama / giriş / çıkış
// ---------------------------------------------------------------------------
describe("yaşam döngüsü göndericileri — iptal + iCal/manuel kanal", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function lifecycleSeed(opts: { status: string; channel: string }) {
    const enabledAt = new Date(Date.now() - 7 * DAY);
    const org = await prisma.organization.create({
      data: {
        name: "Yaşam Döngüsü Org",
        autoWelcome: true,
        autoWelcomeEnabledAt: enabledAt,
        autoCheckin: true,
        autoCheckinEnabledAt: enabledAt,
        autoCheckout: true,
        autoCheckoutEnabledAt: enabledAt,
        timezone: "Europe/Istanbul",
      },
    });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Deniz Daire" },
    });
    for (const category of ["welcome", "checkin", "checkout"]) {
      await prisma.knowledgeBaseItem.create({
        data: { propertyId: property.id, category, title: category, content: `${category} metni`, isActive: true },
      });
    }
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Ayşe Yılmaz",
        arrivalDate: new Date(Date.now() + 2 * DAY), // karşılama + giriş penceresi
        departureDate: new Date(), // çıkış: bugün
        channel: opts.channel,
        status: opts.status,
        sourceReference: `res-${opts.status}-${opts.channel}`,
      },
    });
    return org;
  }

  it("KONTROL: confirmed + airbnb → karşılama ve giriş mesajı GİDER", async () => {
    const org = await lifecycleSeed({ status: "confirmed", channel: "airbnb" });
    expect((await sendDueWelcomes(org.id)).sent).toBe(1);
    expect((await sendDueCheckins(org.id)).sent).toBe(1);
  });

  it("İPTAL → karşılama / giriş / çıkış üçü de GİTMEZ", async () => {
    const org = await lifecycleSeed({ status: "cancelled", channel: "airbnb" });
    expect((await sendDueWelcomes(org.id)).sent).toBe(0);
    expect((await sendDueCheckins(org.id)).sent).toBe(0);
    expect((await sendDueCheckouts(org.id)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KARDEŞ VAKA: iCal / manuel kanal → yaşam döngüsü mesajı GİTMEZ", async () => {
    // Bu satırlarda gönderilebilir bir Hospitable konuşması YOKTUR; `channel:
    // { notIn: ["ics","manual"] }` filtresi tam bunun için var.
    for (const channel of ["ics", "manual"]) {
      await resetDb();
      vi.clearAllMocks();
      mockSend.mockResolvedValue({ ok: true } as never);
      const org = await lifecycleSeed({ status: "confirmed", channel });
      expect((await sendDueWelcomes(org.id)).sent, channel).toBe(0);
      expect((await sendDueCheckins(org.id)).sent, channel).toBe(0);
      expect(mockSend, channel).not.toHaveBeenCalled();
    }
  });

  it("KONTROL: çıkış mesajı confirmed'de GİDER, iptalde GİTMEZ (aynı saat penceresi)", async () => {
    // Çıkış göndericisi org-yerel 08:00–11:59 penceresine bağlı; saat
    // sabitlenmeden bu vaka günün saatine göre rastgele yeşil/kırmızı olurdu.
    // İstanbul (UTC+3) 09:00 = 06:00Z.
    const at9 = new Date();
    at9.setUTCHours(6, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(at9);

    const okOrg = await lifecycleSeed({ status: "confirmed", channel: "airbnb" });
    expect((await sendDueCheckouts(okOrg.id)).sent).toBe(1);

    await resetDb();
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ ok: true } as never);
    const cancelledOrg = await lifecycleSeed({ status: "cancelled", channel: "airbnb" });
    expect((await sendDueCheckouts(cancelledOrg.id)).sent).toBe(0);
  });
});
