// ---------------------------------------------------------------------------
// CEVAP DİLİ HEDEFİ — GÖLGE KAYDI (11-20, konu 1 gölge dilimi; anahtar `AI_REPLY_LANGUAGE_SHADOW_ENABLED`, varsayılan KAPALI).
// Gerçek PostgreSQL + gerçek QR rotası; yalnız cevap modeli sahte. Anahtar misafire gideni DEĞİŞTİRMEZ: yalnız bir gölge satırı yazar.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptvqr1"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const DAY = 86_400_000;

const draft = (reply: string, over: Record<string, unknown> = {}) => ({
  reply,
  intent: "wifi",
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
  ...over,
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
      guestName: "Zeynep Kaya",
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
const newId = () => `tm${++seq}-${Math.random().toString(36).slice(2)}aaaa`;
type Body = { reply?: string | null; merged?: boolean; escalated?: boolean; handoff?: boolean; deduped?: boolean; noReply?: boolean };
async function ask(token: string, message: string, cookie?: string, requestId: string | null = newId()) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestId ? { message, requestId } : { message }),
    }),
    { params: Promise.resolve({ token }) },
  );
  const cookieOut = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { status: res.status, body: (await res.json()) as Body, cookie: cookieOut };
}

const thread = (propertyId: string) =>
  prisma.message.findMany({
    where: { conversation: { propertyId, channel: "chat" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, direction: true, body: true, externalId: true, createdAt: true },
  });


describe("cevap dili hedefi — gölge kaydı (QR yolu)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const EN_Q = "Could you please answer in Turkish? Where is the nearest supermarket?";
  const EN_A = "The nearest supermarket is two minutes away on the main street.";

  it("KONTROL (anahtar kapalı): gölge satırı yazılmaz", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft(EN_A, { detectedLanguage: "en", intent: "general" }) as never);
    const out = await ask(s.token, EN_Q);
    expect(out.status).toBe(200);
    expect(await prisma.semanticReading.count()).toBe(0);
  });

  it("anahtar açık: tur başına TEK satır — üç tüketicinin okuduğu dil + hedef; misafire dönen yanıt AYNI; metin kaydedilmez", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft(EN_A, { detectedLanguage: "en", intent: "general" }) as never);
    const off = await ask(s.token, EN_Q);
    vi.stubEnv("AI_REPLY_LANGUAGE_SHADOW_ENABLED", "1");
    const on = await ask(s.token, EN_Q, off.cookie);
    expect(on.body).toEqual(off.body);
    const rows = await prisma.semanticReading.findMany({ where: { layer: "reply_language" } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const inbound = await thread(s.propertyId);
    expect(row.messageId).toBe(inbound.filter((m) => m.direction === "inbound")[1]!.id);
    // Bugün üç yer de "İngilizce" okuyor (mesajın yazıldığı dil); hedef, dil isteği adayı yüzünden belirsiz kalıyor.
    expect(row).toMatchObject({ outcome: "ok", lexicalDecision: "en", modelDecision: "none", agreement: "target_unsure" });
    expect(JSON.parse(row.detailJson!)).toMatchObject({ p: "en", g: "en", c: "en", x: true, t: null, s: "request_unread" });
    expect(row.detailJson).not.toContain("supermarket");
  });

  it("anahtar yalnız tam '1' ile açılır", async () => {
    vi.stubEnv("AI_REPLY_LANGUAGE_SHADOW_ENABLED", "true");
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft(EN_A, { detectedLanguage: "en", intent: "general" }) as never);
    await ask(s.token, EN_Q);
    expect(await prisma.semanticReading.count()).toBe(0);
  });
});
