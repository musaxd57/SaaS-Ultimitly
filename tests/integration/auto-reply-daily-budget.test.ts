import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { NEW_ORG_AUTO_REPLY_WINDOW } from "@/lib/constants";

// ---------------------------------------------------------------------------
// İKİ KULLANICI KARARI (2026-07-31) — ikisi de müşteriye verilen sözü kodla
// eşitliyor.
//
// 1. GÜNLÜK AI KOTASI OTO-YANITI DA KAPSAR. Kota panelde "günde N AI işlemi"
//    diye satılıyordu ama en büyük harcama kalemi — misafire giden otomatik
//    yanıt — sayaca HİÇ dokunmuyordu. Hem söylenen tavan uygulanmıyordu hem de
//    maliyet korumasının asıl hedefi kapsam dışıydı.
//
// 2. YENİ İŞLETME "TÜM GÜN" AÇIK DOĞAR. Şema varsayılanı 00:00–09:00 idi (yalnız
//    gece), oysa satış sayfası üç yerde "7/24" diyor: host toggle'ı açıyor,
//    gündüz gelen hiçbir mesaja cevap gitmiyordu.
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

import { suggestReply } from "@/lib/ai";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);

/** Kapıdan GEÇEN, güvenle otomatik gönderilebilir bir model hükmü. */
const cleanVerdict = {
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

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Org", autoReplyHospitable: true, ...NEW_ORG_AUTO_REPLY_WINDOW },
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
      lastMessageAt: new Date(),
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: "Alex",
            body: "Wifi şifresi nedir?",
            createdAt: new Date(),
          },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("oto-yanıt günlük AI kotasına bağlı", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(cleanVerdict);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kota İÇİNDEYKEN normal gönderir (regresyon pini)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "50");
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("kota DOLUNCA gönderilmez ve MODEL HİÇ ÇAĞRILMAZ (asıl maliyet korumasi)", async () => {
    // Tavan 1: ilk çağrı kotayı doldurur, ikincisi reddedilir.
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { conversationId } = await seed();

    const first = await applyChannelAutoReply(conversationId);
    expect(first.sent).toBe(true);

    // İkinci konuşma aynı org'da.
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { propertyId: true },
    });
    const second = await prisma.conversation.create({
      data: {
        propertyId: conv.propertyId,
        channel: "airbnb",
        guestIdentifier: "Bea",
        externalReservationId: "res-2",
        status: "new",
        lastMessageAt: new Date(),
        messages: {
          create: [
            { direction: "inbound", senderName: "Bea", body: "Çöp nereye?", createdAt: new Date() },
          ],
        },
      },
    });

    mockSuggest.mockClear();
    const out = await applyChannelAutoReply(second.id);

    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("daily_budget");
    // KRİTİK: kota kontrolü model çağrısının ÖNÜNDE — yoksa "maliyet tavanı"
    // maliyeti harcadıktan sonra devreye girerdi.
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("kota dolduğunda sebep host'a GÖRÜNÜR yazılır", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { conversationId } = await seed();
    await applyChannelAutoReply(conversationId); // kotayı doldur

    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { propertyId: true },
    });
    const second = await prisma.conversation.create({
      data: {
        propertyId: conv.propertyId,
        channel: "airbnb",
        guestIdentifier: "Bea",
        externalReservationId: "res-2",
        status: "new",
        lastMessageAt: new Date(),
        messages: {
          create: [
            { direction: "inbound", senderName: "Bea", body: "Çöp nereye?", createdAt: new Date() },
          ],
        },
      },
    });
    await applyChannelAutoReply(second.id);

    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: second.id },
      select: { skippedReason: true, status: true, autoReplyAttemptedAt: true },
    });
    expect(after.skippedReason).toBe("daily_budget");
    // Konuşma "new" KALIR ve damgalanmaz → pencere dönünce normal yanıtlanır.
    // Damgalansaydı misafir hiç cevap alamazdı: kayıp, gecikme değil.
    expect(after.status).toBe("new");
    expect(after.autoReplyAttemptedAt).toBeNull();
  });

  it("ÖNİZLEME (dryRun) kotadan düşmez — çifte cezalandırma yok", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { conversationId } = await seed();

    await applyChannelAutoReply(conversationId, { dryRun: true });
    await applyChannelAutoReply(conversationId, { dryRun: true });
    await applyChannelAutoReply(conversationId, { dryRun: true });

    // Üç önizlemeden sonra GERÇEK gönderim hâlâ mümkün olmalı.
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
  });
});

describe("yeni işletme TÜM GÜN açık doğar (7/24 sözü)", () => {
  it("sabit değer: başlangıç == bitiş == 0 → kod bunu 'tüm gün' sayar", async () => {
    expect(NEW_ORG_AUTO_REPLY_WINDOW.autoReplyStartHour).toBe(
      NEW_ORG_AUTO_REPLY_WINDOW.autoReplyEndHour,
    );
    const { isWithinActiveHours } = await import("@/lib/automation");
    for (let h = 0; h < 24; h++) {
      expect(
        isWithinActiveHours(
          NEW_ORG_AUTO_REPLY_WINDOW.autoReplyStartHour,
          NEW_ORG_AUTO_REPLY_WINDOW.autoReplyEndHour,
          h,
        ),
        `saat ${h}`,
      ).toBe(true);
    }
  });

  it("ESKİ varsayılan (0–9) gündüzü kapatıyordu — kırmızı-önce kanıtı", async () => {
    const { isWithinActiveHours } = await import("@/lib/automation");
    expect(isWithinActiveHours(0, 9, 14)).toBe(false); // öğleden sonra: cevap YOK
    expect(isWithinActiveHours(0, 9, 3)).toBe(true); // gece: cevap var
  });

  it("org yaratan İKİ yol da bu sabiti kullanıyor (kaynak-tarama pini)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const rel of [
      "src/app/api/auth/register/route.ts",
      "src/app/api/admin/customers/route.ts",
    ]) {
      const src = readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
      expect(src, rel).toContain("NEW_ORG_AUTO_REPLY_WINDOW");
    }
  });
});
