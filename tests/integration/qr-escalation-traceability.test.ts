import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// QR DEVİR GEREKÇESİ İZLENEBİLİR (kurucu AI kalite turu, 2026-09-08).
//
// 🚨 ÖLÇÜLEN AÇIK: canlıda "her soruya 'ev sahibine ilettim'" gözlendi ama kod
// devir SEBEBİNİ hiçbir yere yazmıyordu — rota yalnız `{escalated, reply}`
// döndürüyor. Teşhis ancak yeniden üretimle yapılabiliyordu; hangi kapının
// kapattığı (model riski mi, düşük güven mi, kelime ağı mı, model yok mu)
// canlıda GÖRÜLEMİYORDU.
//
// SÖZLEŞME: her QR yanıt kararı — devir DE, otomatik cevap DA — `RiskEvent`
// satırı yazar (surface "guest_chat"), kapalı-küme `reason` ile. PII yok;
// gerekçe kodu, model risk seviyesi ve güveni kaydedilir. Kayıt YAN ETKİDİR:
// başarısız olursa misafirin yanıtını BOZMAZ.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";

const DAY = 86_400_000;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return { orgId, propertyId, token };
}

let seq = 0;
function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `req-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
}
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? undefined;

const okReply = (over: Record<string, unknown> = {}) => ({
  reply: "Otopark bina altındadır.",
  intent: "parking",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  ...over,
});

describe("QR devir gerekçesi — RiskEvent izlenebilirliği", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("DÜŞÜK GÜVEN devri: reason 'low_confidence', model seviyesi ve güveni kaydedilir", async () => {
    const { orgId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ confidence: 0.4 }));

    const res = await ask(token, "Gidilebilecek tarihi yerler nereler?");
    expect((await res.json()).escalated).toBe(true);

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("low_confidence");
    expect(ev.riskLevel).toBe("none");
    expect(ev.confidence).toBeCloseTo(0.4, 5);
  });

  it("MODEL RİSK SEVİYESİ devri: reason 'model_risk_level'", async () => {
    const { orgId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ riskLevel: "high", confidence: 0.95 }));

    await ask(token, "Otopark var mı?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.reason).toBe("model_risk_level");
    expect(ev.riskLevel).toBe("high");
  });

  it("MODEL YOK/FALLBACK devri: reason 'model_unavailable' (şema ihlali de buraya düşer)", async () => {
    const { orgId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ source: "fallback" }));

    await ask(token, "Otopark var mı?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.reason).toBe("model_unavailable");
  });

  it("KELİME AĞI devri (şikayet): reason 'keyword_escalated'", async () => {
    const { orgId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ intent: "general" }));

    await ask(token, "Klima bozuk, çalışmıyor.");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.reason).toBe("keyword_escalated");
  });

  it("OTOMATİK CEVAP da kaydedilir: finalDecision 'auto_sent', reason 'gate_passed'", async () => {
    const { orgId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply());

    const res = await ask(token, "Otopark var mı?");
    const body = await res.json();
    expect(body.escalated).toBeFalsy();
    expect(body.reply).toContain("Otopark");

    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.finalDecision).toBe("auto_sent");
    expect(ev.reason).toBe("gate_passed");
    expect(ev.confidence).toBeCloseTo(0.9, 5);
  });

  it("kayıt PII taşımaz: misafir metni hiçbir alana yazılmaz", async () => {
    const { orgId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ confidence: 0.3 }));

    await ask(token, "Benim adım Ada Lovelace, telefonum 0555 111 22 33.");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toMatch(/Ada|Lovelace|0555/);
  });

  it("kiracı kapsamı: kayıt mülkün org'una yazılır ve conversation/property bağlanır", async () => {
    const { orgId, propertyId, token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ confidence: 0.1 }));

    await ask(token, "Otopark var mı?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { organizationId: orgId, surface: "guest_chat" } });
    expect(ev.propertyId).toBe(propertyId);
    expect(ev.conversationId).toBeTruthy();
    expect(ev.triggerId).toBeTruthy();
  });
  it("kayıt yan etkidir: RiskEvent yazılamasa da misafir yanıtını alır", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ confidence: 0.2 }));
    const spy = vi.spyOn(prisma.riskEvent, "create").mockRejectedValueOnce(new Error("db down"));

    const res = await ask(token, "Otopark var mı?");
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBeTruthy();
    spy.mockRestore();
  });
});
