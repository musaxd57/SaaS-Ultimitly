import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken, AI_RESUME_MARKER, guestChatAiPausedFromMessages } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// The pure state rule shared by the guest route, the resume endpoint, and the host
// panel: the AI is paused only until the host explicitly re-enables it (a resume
// marker), never on a timer.
describe("guestChatAiPausedFromMessages (pure handoff-state rule)", () => {
  const host = (s = "Ev Sahibi") => ({ direction: "outbound", senderName: s });
  const bot = { direction: "outbound", senderName: "Lixus AI" };
  const guest = { direction: "inbound", senderName: "Misafir" };
  const resume = { direction: "outbound", senderName: AI_RESUME_MARKER };

  it("is active with no host activity (only guest + bot messages)", () => {
    expect(guestChatAiPausedFromMessages([guest, bot, guest, bot])).toBe(false);
  });
  it("pauses once a host has replied", () => {
    expect(guestChatAiPausedFromMessages([guest, bot, host()])).toBe(true);
  });
  it("re-activates after a resume marker", () => {
    expect(guestChatAiPausedFromMessages([guest, bot, host(), resume])).toBe(false);
  });
  it("pauses again if the host takes over AFTER a resume (latest transition wins)", () => {
    expect(guestChatAiPausedFromMessages([host(), resume, guest, host()])).toBe(true);
  });
  it("ignores the bot's own 'Lixus AI' replies as handoff markers", () => {
    expect(guestChatAiPausedFromMessages([host(), resume, bot, guest, bot])).toBe(false);
  });
});

// QR concierge HOST HANDOFF: once a human host replies in a stay's thread, the AI
// hands off for the rest of the stay. A new guest message must NOT get an AI reply
// (pause), and an AI reply prepared while a host reply lands must be vetoed at
// send-time. Migration-free: "host joined" is derived from an existing outbound
// message whose senderName is not the bot's "Lixus AI".

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";

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

function call(token: string, message: unknown, cookie?: string) {
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

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
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

/** Simulate the host replying from the "Misafir Sohbetleri" tab: an OUTBOUND
 *  message whose senderName is a human (NOT the bot's "Lixus AI"). */
async function hostReplies(propertyId: string, body = "Merhaba, ben ilgileniyorum."): Promise<void> {
  const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
  await prisma.message.create({
    data: { conversationId: convo.id, direction: "outbound", senderName: "Ev Sahibi Adı", body, language: "tr" },
  });
}

async function chatMessages(propertyId: string) {
  const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
  return prisma.message.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: "asc" } });
}

describe("QR host handoff (AI pause + send-time veto)", () => {
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

  it("pauses the AI once a host has replied — the next guest message gets NO model call", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // First message → AI answers, thread + device binding created.
    const first = await call(token, "Çöp ne zaman?");
    const cookie = deviceCookie(first);
    expect((await first.json()).escalated).toBe(false);

    // Host takes over the thread.
    await hostReplies(propertyId);
    mockSuggest.mockClear();

    // Guest asks again → PAUSED: no paid model call, only the inbound is stored.
    const res = await call(token, "Peki otopark var mı?", cookie);
    const json = await res.json();
    expect(json.handoff).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();

    const msgs = await chatMessages(propertyId);
    // 2 (first exchange) + 1 (host) + 1 (new guest inbound, NO AI reply) = 4
    expect(msgs).toHaveLength(4);
    expect(msgs[msgs.length - 1]).toMatchObject({ direction: "inbound", body: "Peki otopark var mı?" });
    // Exactly ONE "Lixus AI" outbound total — none added for the paused message.
    expect(msgs.filter((m) => m.senderName === "Lixus AI")).toHaveLength(1);
  });

  it("vetoes an AI reply at SEND-TIME when a host reply lands while the model runs", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    const first = await call(token, "Merhaba");
    const cookie = deviceCookie(first);

    // The SECOND message races: the model call inserts a host reply WHILE it runs,
    // then returns a normal answer. The send-time re-check must veto that answer.
    mockSuggest.mockImplementationOnce(async () => {
      await hostReplies(propertyId, "Ben bakıyorum, birazdan dönerim.");
      return result();
    });

    const res = await call(token, "Çöp ne zaman?", cookie);
    const json = await res.json();
    expect(json.handoff).toBe(true); // AI reply vetoed, not delivered

    const msgs = await chatMessages(propertyId);
    // still only the FIRST exchange's AI reply — the raced second answer was vetoed.
    expect(msgs.filter((m) => m.senderName === "Lixus AI")).toHaveLength(1);
    // the new guest message IS recorded (so the host sees it).
    const inbound = msgs.filter((m) => m.direction === "inbound");
    expect(inbound[inbound.length - 1].body).toBe("Çöp ne zaman?");
  });

  it("re-activates the AI after a resume marker — the next guest message is answered again", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    const first = await call(token, "Çöp ne zaman?");
    const cookie = deviceCookie(first);

    // Host takes over, THEN explicitly re-enables the AI (resume marker = newest
    // non-bot outbound). The AI must not auto-resume on a timer — only this marker
    // flips it back on.
    await hostReplies(propertyId);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId, channel: "chat" } });
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "outbound", senderName: AI_RESUME_MARKER, body: "Lixus AI yeniden etkinleştirildi", language: "tr" },
    });

    mockSuggest.mockClear();
    mockSuggest.mockResolvedValue(result({ reply: "Otopark arka sokakta." }));

    const res = await call(token, "Otopark var mı?", cookie);
    const json = await res.json();
    expect(json.handoff).toBeUndefined(); // AI is active again
    expect(json.escalated).toBe(false);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("the AI's OWN 'Lixus AI' reply does not count as a host takeover", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    const first = await call(token, "Çöp ne zaman?");
    const cookie = deviceCookie(first);
    mockSuggest.mockClear();
    mockSuggest.mockResolvedValue(result({ reply: "Otopark arka sokakta." }));

    // No host reply — a normal second question STILL gets an AI answer.
    const res = await call(token, "Otopark var mı?", cookie);
    const json = await res.json();
    expect(json.handoff).toBeUndefined();
    expect(json.escalated).toBe(false);
    expect(mockSuggest).toHaveBeenCalledTimes(1);

    const msgs = await chatMessages(propertyId);
    expect(msgs.filter((m) => m.senderName === "Lixus AI")).toHaveLength(2); // both AI replies
  });
});
