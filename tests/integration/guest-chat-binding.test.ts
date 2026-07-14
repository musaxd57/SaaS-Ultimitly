import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken, bindOrCheckStay } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { suggestReply } from "@/lib/ai";
import { GET, POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

function result(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
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
    ...over,
  };
}

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  return token;
}

function getReq(token: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, { method: "GET", headers });
  return GET(req as never, { params: Promise.resolve({ token }) });
}
function postReq(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.9",
  };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}
function deviceCookie(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : undefined;
}

describe("bindOrCheckStay (per-stay device binding)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(result());
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("first caller binds, the same secret matches, a wrong/absent secret does not", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const r = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "A",
        arrivalDate: daysFromNow(-1),
        departureDate: daysFromNow(2),
        status: "confirmed",
      },
    });

    const first = await bindOrCheckStay(r.id, null, { allowClaim: true });
    expect(first.status).toBe("bound");
    const secret = first.status === "bound" ? first.secret : "";
    expect(secret.length).toBeGreaterThanOrEqual(32);

    expect((await bindOrCheckStay(r.id, secret, { allowClaim: true })).status).toBe("match");
    expect((await bindOrCheckStay(r.id, "not-the-secret", { allowClaim: true })).status).toBe("mismatch");
    expect((await bindOrCheckStay(r.id, null, { allowClaim: true })).status).toBe("mismatch");
  });

  it("rotates per stay: a previous stay's secret never binds the next reservation", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const r1 = await prisma.reservation.create({
      data: { propertyId, guestName: "A", arrivalDate: daysFromNow(-3), departureDate: daysFromNow(-1), status: "completed" },
    });
    const r2 = await prisma.reservation.create({
      data: { propertyId, guestName: "B", arrivalDate: daysFromNow(0), departureDate: daysFromNow(3), status: "confirmed" },
    });

    const b1 = await bindOrCheckStay(r1.id, null, { allowClaim: true });
    const s1 = b1.status === "bound" ? b1.secret : "";

    // The next stay is unbound; presenting the OLD secret does NOT reuse it — a
    // fresh secret is minted (rotation), and it differs from the previous stay's.
    const b2 = await bindOrCheckStay(r2.id, s1, { allowClaim: true });
    expect(b2.status).toBe("bound");
    const s2 = b2.status === "bound" ? b2.secret : "";
    expect(s2).not.toBe(s1);
    // The old secret can't read the new stay.
    expect((await bindOrCheckStay(r2.id, s1, { allowClaim: true })).status).toBe("mismatch");
  });

  it("GET: the first device sees history; a different (cookieless) device is blocked; the bound cookie still works", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // Device A sends a message (creates history) and gets the stay cookie.
    const sent = await postReq(token, "Çöp ne zaman?");
    expect((await sent.json()).escalated).toBe(false);
    const cookie = deviceCookie(sent);
    expect(cookie).toBeTruthy();

    // Device A re-opens WITH the cookie → sees the thread.
    const mine = await getReq(token, cookie);
    const mineJson = await mine.json();
    expect(mineJson.open).toBe(true);
    expect(mineJson.boundElsewhere).toBeFalsy();
    expect(mineJson.messages.length).toBe(2); // question + AI reply

    // Device B (no cookie) scans the same physical QR → no history revealed.
    const other = await getReq(token);
    const otherJson = await other.json();
    expect(otherJson.boundElsewhere).toBe(true);
    expect(otherJson.messages).toEqual([]);
  });
});
