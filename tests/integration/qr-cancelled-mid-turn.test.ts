// ---------------------------------------------------------------------------
// SON KONTROL — QR: MODEL DÜŞÜNÜRKEN İPTAL EDİLEN KONAKLAMA (kurucu 11-20 sabah Ö-1: "Cevap gitmesin"; kanal yolundaki 6ad784cc'nin QR eşi).
// İstek başı yalnız onaylı / tamamlanmış konaklamada sohbeti açar; model cevap yazarken (birkaç saniye) rezervasyon iptal edilirse cevap
// (ör. Wi-Fi şifresi) yine gidiyordu. Artık kayıt işlemi, cevap yazılacaksa rezervasyonun iptal edilmediğini İŞLEM İÇİNDE yeniden okur;
// iptalse hiçbir şey yazılmaz, misafire bugünkü "sohbet kapalı" metni döner ve mesajı ev sahibine iletilir (iptal edilmiş konaklamada QR'a
// yazılınca bugün olanla aynı yol: `recordCancelledStayMessage`).
// Gerçek PostgreSQL + gerçek QR rotası; yalnız cevap modeli sahte (iptal, model "düşünürken" olur).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptvqr1"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
// Giriş kapısının anlık görüntüsünü (silme ÖNCESİ) tekrar verebilmek için — varsayılan gerçek fonksiyon.
vi.mock("@/lib/guest-chat", async (orig) => {
  const actual = await orig<typeof import("@/lib/guest-chat")>();
  return { ...actual, resolveGuestChat: vi.fn(actual.resolveGuestChat) };
});
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
import { resolveGuestChat } from "@/lib/guest-chat";
import { emailService } from "@/lib/email";

const mockSuggest = vi.mocked(suggestReply);
const DAY = 86_400_000;
const GUEST = "Zeynep Kaya";

const draft = () => ({
  reply: "Wi-Fi ağımız LaleNet, şifresi deniz2024.",
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


const NO_ACTIVE = "Şu an bu daire için aktif bir konaklama görünmüyor; sohbet kapalı. Bir konaklamanız varsa lütfen giriş gününüzde tekrar deneyin.";

async function flushDetached() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 10));
}

describe("QR — model düşünürken iptal edilen konaklamaya cevap gitmez (Ö-1)", () => {
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

  it("🚨 model çağrıdayken rezervasyon iptal edilir → misafire 'sohbet kapalı', cevap kaydı YOK, mesaj ev sahibine iletilir", async () => {
    const s = await seedQr();
    mockSuggest.mockImplementation(async () => {
      await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "cancelled" } });
      return draft() as never;
    });
    const out = await ask(s.token, "Wi-Fi şifresi ne?");
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ closed: true, reply: NO_ACTIVE });
    await flushDetached();
    const messages = await prisma.message.findMany({ where: { conversation: { propertyId: s.propertyId, channel: "chat" } }, select: { direction: true, body: true } });
    // Cevap (şifre) hiçbir yere yazılmadı; misafirin mesajı ev sahibi için kaydedildi.
    expect(messages.some((m) => m.body.includes("deniz2024"))).toBe(false);
    expect(messages.filter((m) => m.direction === "outbound")).toEqual([]);
    expect(messages.filter((m) => m.direction === "inbound").map((m) => m.body)).toEqual(["Wi-Fi şifresi ne?"]);
  });

  it("KONTROL: iptal yoksa cevap gider ve kaydedilir", async () => {
    const s = await seedQr();
    mockSuggest.mockResolvedValue(draft() as never);
    const out = await ask(s.token, "Wi-Fi şifresi ne?");
    expect(out.body.closed).not.toBe(true);
    expect(out.body.reply).toContain("deniz2024");
  });
});
