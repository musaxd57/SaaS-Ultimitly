import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// G2 YENİDEN ÜRETME (11-19) — B4'ün QR (misafir) kolu. Pinli sözleşme (`guest-chat-endpoint.test.ts`): "denetim karakteri (NUL vb.)
// içeren mesaj 500 vermez: karakter sessizce silinir". `GUEST_CONTROL_CHARS` yalnız U+0000–U+001F / U+007F'yi siliyor; JSON'da geçerli
// TEK VEKİL ("\ud800") kalır → mesaj yazımı Prisma'da düşer → 500 + `reportError("api")`. Model çağrısı taklit (ağ yok). Ürün kodu DEĞİŞMEZ.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
const reported: string[] = [];
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return {
    ...actual,
    reportError: vi.fn(async (context: string) => {
      reported.push(context);
      return { notified: false, throttled: false, configured: false };
    }),
  };
});
import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

function result(): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.9,
    reply: "Çöp salı günü toplanır.",
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
  };
}

/** Gövde HAM: tek vekil JSON kaçışı olarak gider (tarayıcının JSON.stringify'ı da böyle yazar). */
function callRaw(token: string, rawBody: string) {
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
    body: rawBody,
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  await prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  return token;
}

describe("(G2 11-19) QR misafir mesajında tek vekil — 500 / uyarı kovası YOK", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    reported.length = 0;
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(result());
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("KONTROL: NUL'lu mesaj (bugünkü pin) → 200, alarm yok", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const res = await callRaw(token, '{"message":"Çöp\\u0000 ne zaman toplanıyor?"}');
    expect(res.status).toBe(200);
    expect(reported.filter((c) => c === "api")).toEqual([]);
  });

  it("🚨 tek vekilli mesaj → 200", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const res = await callRaw(token, '{"message":"Çöp \\ud83d ne zaman toplanıyor?"}');
    // Bilgi: model (canlıda ücretli) yazımdan ÖNCE çağrıldı mı.
    console.log(`G2QR modelCagrisi=${mockSuggest.mock.calls.length} durum=${res.status}`);
    expect({ status: res.status, api: reported.filter((c) => c === "api") }).toEqual({ status: 200, api: [] });
  });
});
