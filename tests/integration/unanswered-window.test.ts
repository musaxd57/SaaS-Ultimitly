import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// CEVAPLANMAMIŞ PENCERE — arka arkaya gelen mesajlarda şikayet kaybolamaz.
// (Derin denetim, 2026-08-01 — KRİTİK.)
//
// Bulunan arıza: hem güvenlik kapısı hem şikayet uyarısı YALNIZ EN SON gelen
// mesaja bakıyordu. Misafir arka arkaya iki mesaj yazdığında —
//
//     1) "Daire çok kirli, param iade edilsin. Bu kabul edilemez!"
//     2) (90 sn sonra) "neyse, wifi şifresi neydi?"
//
// — sonuç şuydu:
//   · `sendDueAlerts` yalnız 2'yi okuyor → şikayet değil → host'a UYARI YOK.
//   · Kapı yalnız 2'yi tarıyor → zararsız → oto-yanıt GİDİYOR, konuşma
//     "answered" oluyor.
//   · "answered" olduğu için satır bir daha hiçbir yolda seçilmiyor →
//     şikayet KALICI olarak kayboluyor.
//
// Ürünün ana sözü ("riskli mesaj HER ZAMAN insana kalır") tam burada kırılıyordu.
//
// Düzeltme DAR: yalnız CEVAPLANMAMIŞ mesajlar (son giden yanıttan sonrakiler)
// taranır. Bir kez cevap verdiğimizde pencere sıfırlanır — yani "dünkü çözülmüş
// şikayet bugünün wifi cevabını engellemez" kuralı korunur (aşağıda test edilir).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import { applyChannelAutoReply, sendDueAlerts } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);

/** Kapıdan GEÇEN, güvenle gönderilebilir bir model hükmü (wifi cevabı). */
const benignVerdict = {
  intent: "wifi",
  confidence: 0.95,
  reply: "Wi-Fi ağı NuveApt, şifre 12345678.",
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

const COMPLAINT = "Daire çok kirli, param iade edilsin. Bu kabul edilemez!";
const FOLLOWUP = "neyse, wifi şifresi neydi?";

async function seed(msgs: { dir: "inbound" | "outbound"; body: string; minutesAgo: number }[]) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Nuve 7" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: new Date(Date.now() - msgs[msgs.length - 1].minutesAgo * 60_000),
      messages: {
        create: msgs.map((m) => ({
          direction: m.dir,
          senderName: m.dir === "inbound" ? "Alex" : "GuestOps AI",
          body: m.body,
          createdAt: new Date(Date.now() - m.minutesAgo * 60_000),
          ...(m.dir === "outbound" ? { externalId: `ext-${m.minutesAgo}` } : {}),
        })),
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("şikayet + zararsız takip — ikisi de cevaplanmamışken", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(benignVerdict);
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KAPI: son mesaj zararsız olsa da oto-yanıt GİTMEZ", async () => {
    const { conversationId } = await seed([
      { dir: "inbound", body: COMPLAINT, minutesAgo: 10 },
      { dir: "inbound", body: FOLLOWUP, minutesAgo: 8 },
    ]);

    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);

    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true },
    });
    expect(conv.status).not.toBe("answered");
  });

  it("UYARI: host'a e-posta GİDER ve içinde ŞİKAYET metni vardır (takip değil)", async () => {
    const { orgId } = await seed([
      { dir: "inbound", body: COMPLAINT, minutesAgo: 10 },
      { dir: "inbound", body: FOLLOWUP, minutesAgo: 8 },
    ]);

    const out = await sendDueAlerts(orgId);
    expect(out.alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);

    const html = String(mockMail.mock.calls[0][2]);
    expect(html).toContain("kirli"); // şikayetin kendisi
    expect(html).not.toContain("wifi şifresi neydi"); // zararsız takip değil
  });

  it("PENCERE SIFIRLANIR: cevap verdikten SONRA gelen zararsız mesaj normal yanıtlanır", async () => {
    // "Dünkü çözülmüş şikayet bugünü engellemesin" kuralı korunuyor mu?
    const { conversationId } = await seed([
      { dir: "inbound", body: COMPLAINT, minutesAgo: 600 },
      { dir: "outbound", body: "Üzgünüz, ekibimiz ilgileniyor.", minutesAgo: 500 },
      { dir: "inbound", body: FOLLOWUP, minutesAgo: 5 },
    ]);

    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true); // eski şikayet ARTIK engellemiyor
  });

  it("cevaplanmamış pencerede GÜVENLİK ACİLİ varsa da oto-yanıt gitmez", async () => {
    const { conversationId } = await seed([
      { dir: "inbound", body: "Daireden gaz kokusu geliyor!", minutesAgo: 12 },
      { dir: "inbound", body: FOLLOWUP, minutesAgo: 9 },
    ]);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
  });

  it("TEK zararsız mesajda hiçbir şey değişmedi (regresyon pini)", async () => {
    const { conversationId } = await seed([{ dir: "inbound", body: FOLLOWUP, minutesAgo: 5 }]);
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
  });
});
