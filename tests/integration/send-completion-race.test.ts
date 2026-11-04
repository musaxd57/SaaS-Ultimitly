import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Codex 11-04 P1 — DOĞRUDAN gönderimin tamamlanması daha YENİ konuşma durumunu ezmez. Sağlayıcının cevabı beklenirken: yeni misafir mesajı gelir
// (senkron) ya da başka bir yönetici konuşmayı Sorunlu / Tamamlandı yapar. Eskiden tamamlama koşulsuz "answered" yazıyordu → yeni soru
// "cevaplandı" görünüp hiç cevaplanmıyor, yöneticinin kararı siliniyordu. Kuyruk yolu (`markConversationDelivered`) zaten koşulluydu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels")>()),
  resolveOrgChannelCredential: vi.fn(async () => ({ token: "t" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { sendHostMessage } from "@/lib/host-send";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSend = vi.mocked(sendOnChannel);
const mockSuggest = vi.mocked(suggestReply);

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

async function seed(status = "new") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 } });
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Deniz",
      status,
      externalReservationId: "res-race-2",
      messages: {
        create: [{ direction: "inbound", authorType: "guest", senderName: "Deniz", body: "Giriş saati kaçta?", createdAt: new Date(Date.now() - 60_000) }],
      },
    },
  });
  return { orgId, conv };
}

const guestWritesDuringSend = (conversationId: string, body = "Bir de otopark var mı?") =>
  prisma.message.create({ data: { conversationId, direction: "inbound", authorType: "guest", senderName: "Deniz", body, createdAt: new Date() } });

function hostSend(orgId: string, convId: string, body = "Giriş 15:00'te.") {
  return sendHostMessage({
    organizationId: orgId,
    conversation: { id: convId, channel: "airbnb", guestIdentifier: "Deniz", externalReservationId: "res-race-2" },
    body,
    claimBody: body,
    senderName: "Ayşe",
    aiAssisted: false,
    idempotencyKey: `k-${body}`,
    strictIdempotency: false,
  });
}
const statusOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.stubEnv("AUTO_REPLY_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("ev sahibi cevabı — doğrudan gönderim", () => {
  it("🚨 gönderim sürerken misafir YENİ mesaj yazdı → konuşma 'answered' OLMAZ (yeni soru açık kalır); mesaj yine kaydedilir", async () => {
    const { orgId, conv } = await seed("new");
    mockSend.mockImplementation(async () => {
      await guestWritesDuringSend(conv.id);
      return { ok: true, providerMessageId: "pm-a" } as never;
    });
    expect((await hostSend(orgId, conv.id)).status).toBe("sent");
    expect(await statusOf(conv.id)).toBe("new");
    expect(await prisma.message.count({ where: { conversationId: conv.id, direction: "outbound" } })).toBe(1);
  });

  it.each(["problem", "closed"])("🚨 gönderim sürerken başka yönetici konuşmayı '%s' yaptı → tamamlama bunu EZMEZ", async (st) => {
    const { orgId, conv } = await seed("new");
    mockSend.mockImplementation(async () => {
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: st } });
      return { ok: true, providerMessageId: `pm-${st}` } as never;
    });
    expect((await hostSend(orgId, conv.id)).status).toBe("sent");
    expect(await statusOf(conv.id)).toBe(st);
  });

  it("🚨 senkron cevabı önce içeri aldı (tekil kimlik çakışması) + arada yeni misafir mesajı → yine 'answered' OLMAZ", async () => {
    const { orgId, conv } = await seed("new");
    mockSend.mockImplementation(async () => {
      await prisma.message.create({
        data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Giriş 15:00'te.", externalId: "pm-dup" },
      });
      await guestWritesDuringSend(conv.id);
      return { ok: true, providerMessageId: "pm-dup" } as never;
    });
    expect((await hostSend(orgId, conv.id)).status).toBe("sent");
    expect(await statusOf(conv.id)).toBe("new");
  });

  it("KONTROL: arada hiçbir şey olmadıysa 'answered' + lastMessageAt ileri; Sorunlu konuşmaya ev sahibinin cevabı (bugünkü kural) 'answered'", async () => {
    const { orgId, conv } = await seed("new");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "pm-ok" } as never);
    const before = Date.now();
    expect((await hostSend(orgId, conv.id)).status).toBe("sent");
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.status).toBe("answered");
    expect(row.lastMessageAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    const p = await seed("problem");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "pm-ok2" } as never);
    expect((await hostSend(p.orgId, p.conv.id)).status).toBe("sent");
    expect(await statusOf(p.conv.id)).toBe("answered");
  });
});

describe("yapay zekâ cevabı — doğrudan gönderim (claim-then-send)", () => {
  it("🚨 gönderim sürerken misafir YENİ mesaj yazdı → tamamlama 'answered'ı yeniden yazıp yeni mesajı kapatmaz", async () => {
    mockSuggest.mockResolvedValue(SAFE_REPLY as never);
    const { conv } = await seed("new");
    mockSend.mockImplementation(async () => {
      await guestWritesDuringSend(conv.id);
      // Senkronun yaptığı gibi: son mesaj misafirin → konuşma yeniden "new".
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: "new" } });
      return { ok: true, providerMessageId: "pm-ai-1" } as never;
    });
    const out = await applyChannelAutoReply(conv.id);
    expect(out.sent).toBe(true);
    expect(await statusOf(conv.id)).toBe("new");
  });

  it("🚨 gönderim sürerken yönetici 'problem' yaptı + risk alanı yazıldı → tamamlama durum / risk alanlarını EZMEZ", async () => {
    mockSuggest.mockResolvedValue(SAFE_REPLY as never);
    const { conv } = await seed("new");
    mockSend.mockImplementation(async () => {
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: "problem", lastRiskType: "safety_emergency", skippedReason: "escalated_to_human" } });
      return { ok: true, providerMessageId: "pm-ai-2" } as never;
    });
    expect((await applyChannelAutoReply(conv.id)).sent).toBe(true);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row).toMatchObject({ status: "problem", lastRiskType: "safety_emergency", skippedReason: "escalated_to_human" });
  });

  it("KONTROL: arada hiçbir şey olmadıysa 'answered', risk alanları cevabınki, lastMessageAt ileri", async () => {
    mockSuggest.mockResolvedValue(SAFE_REPLY as never);
    const { conv } = await seed("new");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "pm-ai-3" } as never);
    const before = Date.now();
    expect((await applyChannelAutoReply(conv.id)).sent).toBe(true);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.status).toBe("answered");
    expect(row.lastRiskLevel).toBe("none");
    expect(row.lastMessageAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });
});
