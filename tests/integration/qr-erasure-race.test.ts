// ---------------------------------------------------------------------------
// Y3 (10-14 dış inceleme): QR — model çağrısı sürerken misafirin verisi SİLİNİRSE bekleyen istek hiçbir şeyi geri yazmaz.
//
// Eski akış: giriş kapısı (`resolveGuestChat` → `loadErasureGuard`) yalnız istek BAŞINDA bakıyordu; model dönünce `record()` misafirin
// ham mesajını ve istek başındaki ADI yeniden yazıyor, üretim izi açıksa taslak / gönderilen metin de iz satırına giriyordu. Yeni akış:
// yazma işlemi işletmenin silme kilidini alıp kapıyı İŞLEM İÇİNDE yeniden okur (öteki girişlerle aynı iki-sıralama kuralı).
// Gerçek PostgreSQL + gerçek QR rotası + gerçek silme yürütücüsü; yalnız cevap modeli sahte (silme, model "düşünürken" koşar).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptvqr1"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";
import { eraseReservationData } from "@/lib/erasure";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const DAY = 86_400_000;
const GUEST = "Zeynep Kaya";
const SECRET_TEXT = "Telefonum 0532 999 88 77, giriş saatini öğrenebilir miyim?";

const draft = () => ({
  reply: "Giriş 15:00'ten itibaren.",
  intent: "checkin",
  riskLevel: "none",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none", stance: "none" },
  llmUsage: { m: "served-model", pt: 900, ct: 40 },
});

async function seedQr() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: GUEST,
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      sourceReference: `res-${Math.random().toString(36).slice(2)}`,
    },
  });
  return { orgId, propertyId, token, reservationId: reservation.id };
}

let seq = 0;
async function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `er${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  const cookieOut = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { status: res.status, body: (await res.json()) as { reply?: string; closed?: boolean }, cookie: cookieOut };
}

async function leaks(propertyId: string) {
  const messages = await prisma.message.findMany({ where: { conversation: { propertyId, channel: "chat" } }, select: { body: true, senderName: true } });
  const conversations = await prisma.conversation.findMany({ where: { propertyId, channel: "chat" }, select: { guestIdentifier: true } });
  const traces = await prisma.aiGeneration.findMany({ where: { propertyId }, select: { draftText: true, sentText: true } });
  const all = JSON.stringify({ messages, conversations, traces });
  return { secret: all.includes("0532 999 88 77"), name: all.includes("Zeynep"), traces: traces.length, messages: messages.length };
}

describe("Y3 — QR yazması silme sınırının arkasında", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("KONTROL: silme yokken mesaj ve iz yazılır", async () => {
    const { token, propertyId } = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const r = await ask(token, SECRET_TEXT);
    expect(r.status).toBe(200);
    const l = await leaks(propertyId);
    expect(l.messages).toBeGreaterThan(0);
    expect(l.secret).toBe(true);
  });

  it("🚨 ilk mesaj: model sürerken silme tamamlandı → misafir metni, ad, konuşma satırı ve iz YAZILMAZ; misafire 'sohbet kapalı'", async () => {
    const { orgId, token, propertyId, reservationId } = await seedQr();
    mockSuggest.mockImplementation((async () => {
      expect(await eraseReservationData(orgId, reservationId)).not.toBeNull();
      return draft();
    }) as never);
    const r = await ask(token, SECRET_TEXT);
    expect(mockSuggest).toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(r.body.closed).toBe(true);
    const l = await leaks(propertyId);
    expect(l.secret).toBe(false);
    expect(l.name).toBe(false);
    expect(l.traces).toBe(0);
  });

  it("🚨 süren sohbet: ikinci mesajda model sürerken silme → yeni metin yazılmaz, silinen ad geri gelmez", async () => {
    const { orgId, token, propertyId, reservationId } = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const first = await ask(token, "Merhaba, Wi-Fi şifresi nedir?");
    expect(first.status).toBe(200);
    mockSuggest.mockImplementation((async () => {
      await eraseReservationData(orgId, reservationId);
      return draft();
    }) as never);
    const r = await ask(token, SECRET_TEXT, first.cookie);
    expect(r.body.closed).toBe(true);
    const l = await leaks(propertyId);
    expect(l.secret).toBe(false);
    expect(l.name).toBe(false);
  });
});
