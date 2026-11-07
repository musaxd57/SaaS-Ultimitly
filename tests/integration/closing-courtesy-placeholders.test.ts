import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Tur 7 S7-2 (kurucu onayı 11-05) — ev sahibinin nezaket cevabı metnindeki `{isim}` / `{daire}` yaşam döngüsü mesajlarıyla AYNI
// doldurucudan çözülür; doldurulamayan alan misafire GİTMEZ (sessiz kapanış). Önizleme ("AI cevabını gör") aynı doldurucu + aynı kapı.
// Eskiden: Ayarlar "{isim} yazarsanız misafirin adıyla değiştirilir" diyordu ama misafire "Rica ederiz {isim}, …" HAM gidiyordu.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as AI_TEST } from "@/app/api/ai/test/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSend = vi.mocked(sendOnChannel);

async function seedChannel(opts: { closingReplyText: string; guestIdentifier?: string; propertyName?: string }) {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      timezone: "Europe/Istanbul",
      autoClosingReplyEnabled: true,
      closingReplyText: opts.closingReplyText,
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: opts.propertyName ?? "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const t0 = Date.now() - 4 * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: opts.guestIdentifier ?? "Ayşe Yılmaz",
      status: "new",
      externalReservationId: "res-s72",
      lastMessageAt: new Date(t0 + 2 * 60_000),
      messages: {
        create: [
          { direction: "inbound", senderName: "Ayşe", body: "Wifi şifresi nedir?", createdAt: new Date(t0) },
          { direction: "outbound", senderName: "Host", body: "Wifi şifresi kılavuzda.", createdAt: new Date(t0 + 60_000) },
          { direction: "inbound", senderName: "Ayşe", body: "Teşekkürler", createdAt: new Date(t0 + 2 * 60_000) },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

const sentBody = () => String(mockSend.mock.calls[0][1]);

describe("nezaket cevabı — {isim} / {daire} doldurulur, doldurulamayan GİTMEZ (S7-2)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 '{isim}' misafirin adıyla gider — ham belirteç yok", async () => {
    const { conversationId } = await seedChannel({ closingReplyText: "Rica ederiz {isim}, keyifli konaklamalar!" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expect(sentBody()).toContain("Rica ederiz Ayşe, keyifli konaklamalar!");
    expect(sentBody()).not.toContain("{isim}");
  });

  it("🚨 ad bilinmiyorsa (yer tutucu ad) hitap adsız — 'Rezervasyon' yazılmaz", async () => {
    const { conversationId } = await seedChannel({ closingReplyText: "Rica ederiz {isim}, keyifli konaklamalar!", guestIdentifier: "Rezervasyon HM4K2" });
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    expect(sentBody()).toContain("Rica ederiz, keyifli konaklamalar!");
    expect(sentBody()).not.toMatch(/Rezervasyon|\{isim\}/);
  });

  for (const c of [
    { name: "doldurulmamış köşeli alan", text: "Rica ederiz! Adres: [AÇIK ADRES]" },
    { name: "çözülemeyen {daire} (mülk adında numara yok)", text: "Rica ederiz, {daire} numaralı dairede iyi konaklamalar!" },
    { name: "çift süslü parantez", text: "Rica ederiz {{guestName}}!" },
  ]) {
    it(`🚨 ${c.name}: nezaket cevabı GİTMEZ (sessiz kapanış)`, async () => {
      const { conversationId } = await seedChannel({ closingReplyText: c.text });
      const out = await applyChannelAutoReply(conversationId);
      expect(mockSend).not.toHaveBeenCalled();
      expect(out.sent).toBe(false);
      expect(out.skippedReason).toBe("closing_ack");
    });
  }
});

describe("önizleme — gönderimle aynı doldurucu + aynı kapı (S7-2)", () => {
  const req = (body: unknown) =>
    new NextRequest("http://localhost/api/ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ctx = { params: Promise.resolve({}) };

  async function seedOwner(closingReplyText: string) {
    const { orgId } = await seedChannel({ closingReplyText });
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o${Date.now()}@x.com`, passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
  }

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(suggestReply).mockResolvedValue({
      intent: "general",
      confidence: 0.3,
      reply: "Rica ederiz, iyi günler!",
      risk: null,
      priority: "standard",
      source: "openai",
      actionSuggestion: null,
      riskLevel: "none",
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      missingInfo: [],
      statedCheckoutTime: null,
      stayChange: { asked: "none", stance: "none" },
    } as unknown as Awaited<ReturnType<typeof suggestReply>>);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 '{isim}' önizlemede örnek misafirin adıyla", async () => {
    await seedOwner("Rica ederiz {isim}, keyifli konaklamalar!");
    const json = await (await AI_TEST(req({ message: "Teşekkürler" }), ctx)).json();
    expect(json.closingReplyEnabled).toBe(true);
    expect(json.closingReplyPreview).toContain("Rica ederiz Ada, keyifli konaklamalar!");
    expect(json.closingReplyIssue).toBeNull();
  });

  it("🚨 doldurulamayan alan: önizleme 'gönderilir' demez, sebebi söyler", async () => {
    await seedOwner("Rica ederiz! Adres: [AÇIK ADRES]");
    const json = await (await AI_TEST(req({ message: "Teşekkürler" }), ctx)).json();
    expect(json.closingAck).toBe(true);
    expect(json.closingReplyEnabled).toBe(false);
    expect(json.closingReplyPreview).toBeNull();
    expect(json.closingReplyIssue).toBe("Mesajda doldurulmamış alan var — düzeltilene kadar gönderilmez.");
  });
});
