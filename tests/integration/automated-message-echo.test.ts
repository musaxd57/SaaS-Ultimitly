import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// ---------------------------------------------------------------------------
// K7 (kurucu onayı 09-30, migration 58): OTOMATİK MESAJIMIZ "EV SAHİBİ YAZDI" SAYILMAZ. Canlı senaryo (inceleme b6-1):
// misafir IBAN ister → istek ev sahibinde tutulur → aynı gün karşılama mesajımız gider → senkron onu sağlayıcıdan geri
// getirir → eskiden "ev sahibi" yazılıyordu: konuşma "cevaplandı", tutulan öğe "Yanıtladınız" oluyordu. Gerçek yazma yolu:
// gönderici (`sendDueWelcomes`, kanal çağrısı sahte) + senkron (`syncHospitable` → sahte sağlayıcı → write service → PG).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes } from "@/lib/automation";
import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { openItemCounts } from "@/lib/conversation-items/store";
import { closableAfter } from "@/lib/ai/closing-turn";
import { purgeAutomatedSends, AUTOMATED_SEND_RETENTION_MS, automatedBodyHash } from "@/lib/automated-sends";
import { drainOutboxOnce } from "@/lib/outbox/worker";

const mockSend = vi.mocked(sendOnChannel);
const fake = new FakeIngestProvider();
const TOKEN = "tok-k7";
const HP = "hp-k7";
const ARR = daysFromNow(5);
const DEP = daysFromNow(9);
const GUEST_AT = new Date(Date.now() - 60 * 60_000); // 1 saat önce
const IBAN_Q = canonicalMessage({ externalId: "g-1", body: "Merhaba, IBAN numaranızı gönderir misiniz?", createdAt: GUEST_AT });

const reservation = (lastMessageAt: Date) =>
  canonicalReservation({
    externalId: "res-k7",
    code: "HMK7",
    arrivalDate: ARR,
    departureDate: DEP,
    conversationExternalId: "conv-k7",
    conversationLanguage: "tr",
    lastMessageAt,
  });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: { autoWelcome: true, autoWelcomeEnabledAt: new Date("2026-01-01T00:00:00Z") },
  });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "welcome", title: "Karşılama", content: "Hoş geldiniz!\nGiriş 15:00, çıkış 11:00.", isActive: true },
  });
  await setOrgHospitableToken(orgId, TOKEN, "K7");
  fake.addProperty(TOKEN, HP, "Test Property");
  fake.setReservations(HP, [reservation(GUEST_AT)]);
  fake.setMessages("res-k7", [IBAN_Q]);
  await syncHospitable(orgId);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { propertyId, externalReservationId: "res-k7" } });
  return { orgId, propertyId, conversationId: conversation.id };
}

/** Karşılama mesajını gerçek göndericiyle gönderir; kanala giden gövdeyi döndürür. */
async function sendWelcome(orgId: string, providerMessageId: string | null): Promise<string> {
  mockSend.mockResolvedValue({ ok: true, providerMessageId } as never);
  const r = await sendDueWelcomes(orgId);
  expect(r.sent).toBe(1);
  return mockSend.mock.calls[0][1];
}

/** Sağlayıcı karşılama mesajını thread'in son giden mesajı olarak geri verir; senkron koşar. */
async function echo(orgId: string, body: string, externalId: string, at: Date) {
  fake.setReservations(HP, [reservation(at)]);
  fake.setMessages("res-k7", [IBAN_Q, canonicalMessage({ externalId, direction: "outbound", senderName: "Ev Sahibi", body, createdAt: at })]);
  await syncHospitable(orgId);
}

describe("K7 — otomatik mesajımız senkronla geri gelince ev sahibi cevabı sayılmaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    resetPrimaryOrgCache();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    __setIngestAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 IBAN isteği + karşılama mesajı: mesaj 'otomatik', konuşma 'yeni' kalır, tutulan öğe açık, etkinlik anı ilerlemez", async () => {
    const { orgId, conversationId } = await seed();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("new");
    const guestRow = await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "g-1" } });
    // Ev sahibinde tutulan ödeme isteği (konuşma öğesi, bayrak açık kipte yazılan satır).
    await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId, messageId: guestRow.id, requestIndex: 0, kind: "payment_invoice", sensitivity: "sensitive", sources: "understanding", status: "pending_host" },
    });

    const body = await sendWelcome(orgId, "post-id-1");
    const trace = await prisma.automatedMessageSend.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(trace).toMatchObject({ kind: "welcome", state: "sent", providerMessageId: "post-id-1", externalReservationId: "res-k7" });
    expect(Object.keys(trace)).not.toContain("body"); // metin saklanmaz

    // Sağlayıcı okuma kimliği POST kimliğinden FARKLI ve satır sonlarını CRLF'e çevirmiş → gövde özeti eşleşir.
    const echoAt = new Date(Date.now() + 30_000);
    await echo(orgId, `${body.replace(/\n/g, "\r\n")}  `, "get-id-9", echoAt);

    const welcomeRow = await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "get-id-9" } });
    expect(welcomeRow.authorType).toBe("automation");
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(convo.status).toBe("new"); // misafirin IBAN sorusu hâlâ cevapsız
    expect(convo.lastMessageAt.getTime()).toBe(GUEST_AT.getTime()); // otomatik mesaj oto-yanıtı yeniden tetiklemez
    expect(convo.syncCursorAt?.getTime()).toBe(echoAt.getTime()); // imleç sağlayıcının anı (thread her geçişte yeniden çekilmez)
    const open = await openItemCounts(prisma, { organizationId: orgId, conversationIds: [conversationId] });
    expect(open.get(conversationId)).toBe(1); // "Yanıtladınız" DEĞİL
    expect((await prisma.automatedMessageSend.findUniqueOrThrow({ where: { id: trace.id } })).matchedExternalId).toBe("get-id-9");

    // Ardından gelen "Teşekkürler" bir kapanış değildir (önceki bir CEVAP yok).
    const thread = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
    expect(closableAfter([...thread, { direction: "inbound", senderName: "Alex", authorType: "guest", body: "Teşekkürler" }])).toBe(false);

    // Aynı thread'in yeniden içe aktarımı (replay) yeni satır ya da ikinci eşleşme üretmez.
    await echo(orgId, `${body.replace(/\n/g, "\r\n")}  `, "get-id-9", echoAt);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(2);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("new");
  });

  it("🚨 ikinci otomatik mesaj geldiğinde (yeniden içe aktarma) önceden kayıtlı otomatik mesaj da cevap sayılmaz", async () => {
    const { orgId, propertyId, conversationId } = await seed();
    const body = await sendWelcome(orgId, "w-1");
    const t1 = new Date(Date.now() + 30_000);
    await echo(orgId, body, "w-1", t1);
    // Giriş bilgisi mesajı (ikinci otomatik mesaj) gönderilmiş gibi iz.
    const checkinBody = "Giriş bilgileri: kapı kodu kartta.";
    await prisma.automatedMessageSend.create({
      data: {
        organizationId: orgId,
        propertyId,
        externalReservationId: "res-k7",
        kind: "checkin",
        bodyHash: automatedBodyHash(checkinBody),
        state: "sent",
        sentAt: new Date(),
      },
    });
    const t2 = new Date(Date.now() + 60_000);
    fake.setReservations(HP, [reservation(t2)]);
    fake.setMessages("res-k7", [
      IBAN_Q,
      canonicalMessage({ externalId: "w-1", direction: "outbound", senderName: "Ev Sahibi", body, createdAt: t1 }),
      canonicalMessage({ externalId: "c-1", direction: "outbound", senderName: "Ev Sahibi", body: checkinBody, createdAt: t2 }),
    ]);
    await syncHospitable(orgId);
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "c-1" } })).authorType).toBe("automation");
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(convo.status).toBe("new");
    expect(convo.lastMessageAt.getTime()).toBe(GUEST_AT.getTime());
  });

  it("sağlayıcı kimliği POST kimliğiyle aynıysa gövde farklı olsa da eşleşir (kanal metni biçimlendirmiş olabilir)", async () => {
    const { orgId, conversationId } = await seed();
    await sendWelcome(orgId, "same-id-5");
    await echo(orgId, "Biçimi değişmiş karşılama metni", "same-id-5", new Date(Date.now() + 20_000));
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "same-id-5" } })).authorType).toBe("automation");
  });

  it("KONTROL — ev sahibinin GERÇEK cevabı hâlâ 'ev sahibi' ve konuşmayı cevaplar", async () => {
    const { orgId, conversationId } = await seed();
    await sendWelcome(orgId, "post-id-2");
    await echo(orgId, "IBAN'ı özelden paylaşıyorum.", "host-7", new Date(Date.now() + 20_000));
    const row = await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "host-7" } });
    expect(row.authorType).toBe("host");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("answered");
  });

  it("KONTROL — kesin başarısız gönderimin izi eşleşmez (aynı metin pencere içinde görünse de)", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 422" } as never);
    await sendDueWelcomes(orgId);
    const failed = await prisma.automatedMessageSend.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(failed.state).toBe("failed");
    const body = mockSend.mock.calls[0][1];
    await echo(orgId, body, "same-text-1", new Date(Date.now() + 60_000));
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "same-text-1" } })).authorType).toBe("host");
  });

  it("belirsiz (zaman aşımı) gönderimin izi eşleşmeye açık kalır (mesaj teslim edilmiş olabilir)", async () => {
    const { orgId, conversationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "timeout" } as never);
    await sendDueWelcomes(orgId);
    expect((await prisma.automatedMessageSend.findFirstOrThrow({ where: { organizationId: orgId } })).state).toBe("unverified");
    await echo(orgId, mockSend.mock.calls[0][1], "amb-1", new Date(Date.now() + 60_000));
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "amb-1" } })).authorType).toBe("automation");
  });

  it("KONTROL — pencere dışı (24 saatten sonra) aynı metin eşleşmez", async () => {
    const { orgId, conversationId } = await seed();
    const body = await sendWelcome(orgId, null);
    await echo(orgId, body, "late-1", new Date(Date.now() + 25 * 3_600_000));
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "late-1" } })).authorType).toBe("host");
  });

  it("kalıcı kuyruk yolu (bayrak açık): işçi gönderimden ÖNCE iz yazar, sağlayıcı kimliğiyle kapatır; yankı 'otomatik'", async () => {
    const { orgId, conversationId } = await seed();
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*"); // O1: liste açıkça bütün işletmeler (Opus F10: liste yoksa kimse)
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(mockSend).not.toHaveBeenCalled(); // kuyruğa girdi
    expect(await prisma.automatedMessageSend.count()).toBe(0); // iz gönderim anında (işçide) yazılır
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    let seenTraceBeforeSend = -1;
    await drainOutboxOnce({
      tokenFor: async () => "t",
      send: async () => {
        seenTraceBeforeSend = await prisma.automatedMessageSend.count({ where: { state: "pending" } });
        return { ok: true, providerMessageId: "outbox-pm-1" };
      },
    });
    expect(seenTraceBeforeSend).toBe(1); // POST sırasında iz zaten vardı
    const trace = await prisma.automatedMessageSend.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(trace).toMatchObject({ state: "sent", providerMessageId: "outbox-pm-1", kind: "welcome" });
    await echo(orgId, row.body, "outbox-pm-1", new Date(Date.now() + 60_000));
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId, externalId: "outbox-pm-1" } })).authorType).toBe("automation");
  });

  it("izler 14 gün sonra silinir (metin taşımasa da süresiz tutulmaz)", async () => {
    const { orgId } = await seed();
    await sendWelcome(orgId, "p-1");
    expect(await purgeAutomatedSends(prisma, new Date(Date.now() + AUTOMATED_SEND_RETENTION_MS - 60_000))).toBe(0);
    expect(await purgeAutomatedSends(prisma, new Date(Date.now() + AUTOMATED_SEND_RETENTION_MS + 60_000))).toBe(1);
  });
});
