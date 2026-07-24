import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// Mock ONLY the model call — deterministic, no network. The safety gate
// (classifyFallback cross-check) stays real.
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

function call(token: string, message: unknown, cookie?: string, extra?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.5",
  };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, ...extra }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

/** The per-stay device cookie the server set, as a "name=value" request header. */
function deviceCookie(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : undefined;
}

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true },
  });
  // An active stay so the chat is OPEN (the open/closed window itself is tested
  // in guest-chat.test.ts). Without this, the endpoint would return "closed".
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

describe("POST /api/chat/[token] (public QR concierge)", () => {
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

  it("404s when the global kill-switch is off — surface is inert by default", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    delete process.env.GUEST_CHAT_ENABLED;
    expect((await call(token, "merhaba")).status).toBe(404);
  });

  it("404s for unknown and per-apartment-disabled tokens", async () => {
    expect((await call(generateChatToken(), "merhaba")).status).toBe(404); // unknown
    const { propertyId } = await makeOrgWithProperty();
    const token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: false } });
    expect((await call(token, "merhaba")).status).toBe(404); // disabled
  });

  it("rejects empty and over-long messages", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    expect((await call(token, "")).status).toBe(400);
    expect((await call(token, "x".repeat(2001))).status).toBe(400);
  });

  it("records a confident answer (question + AI reply) as a non-urgent 'chat' thread", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const res = await call(token, "Çöp ne zaman toplanıyor?");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.escalated).toBe(false);
    expect(json.reply).toContain("Çöp");

    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].channel).toBe("chat"); // its own tab, NOT the Airbnb inbox
    expect(convos[0].priority).toBe("standard"); // not escalated
    expect(convos[0].externalReservationId?.startsWith(`qr-chat:${propertyId}:`)).toBe(true);
    const msgs = await prisma.message.findMany({
      where: { conversationId: convos[0].id },
      orderBy: { createdAt: "asc" },
    });
    expect(msgs).toHaveLength(2); // BOTH the guest question and the AI reply
    expect(msgs[0].direction).toBe("inbound");
    expect(msgs[0].body).toBe("Çöp ne zaman toplanıyor?");
    expect(msgs[1].direction).toBe("outbound");
    expect(msgs[1].body).toContain("Çöp");
  });

  it("records an escalated exchange flagged urgent; reuses the same per-guest thread", async () => {
    mockSuggest.mockResolvedValue(result({ source: "fallback" }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    const first = await call(token, "Çöp ne zaman?");
    const json = await first.json();
    expect(json.escalated).toBe(true);
    // The first message binds the stay to this device; carry its cookie so the
    // second message is recognised as the SAME device (per-stay binding).
    const cookie = deviceCookie(first);

    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].channel).toBe("chat");
    expect(convos[0].priority).toBe("urgent"); // escalated → flagged
    expect(await prisma.message.count({ where: { conversationId: convos[0].id } })).toBe(2);

    // A second message from the same guest (same cookie) reuses the same thread.
    await call(token, "Park var mı?", cookie);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: convos[0].id } })).toBe(4);
  });

  it("blocks a DIFFERENT device once the stay is bound (no history hijack, no write)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // Device A opens the chat first → claims the stay.
    const a = await call(token, "Çöp ne zaman?");
    expect((await a.json()).escalated).toBe(false);
    const before = await prisma.message.count();

    // Device B scans the same physical QR (no cookie) → refused, nothing recorded.
    const b = await call(token, "Merhaba, geçen haftaki misafir ne sordu?");
    const bJson = await b.json();
    expect(bJson.boundElsewhere).toBe(true);
    expect(bJson.reply).toMatch(/başka bir cihaz/i);
    expect(mockSuggest).toHaveBeenCalledTimes(1); // only device A reached the model
    expect(await prisma.message.count()).toBe(before); // device B wrote nothing
  });

  it("escalates sensitive intents (complaint/refund) instead of answering", async () => {
    mockSuggest.mockResolvedValue(result({ intent: "complaint", confidence: 0.95 }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Daire çok kirliydi, şikayetçiyim")).json();
    expect(json.escalated).toBe(true);
    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].priority).toBe("urgent");
  });

  it("escalates on the keyword cross-check even if the model under-rates the risk", async () => {
    mockSuggest.mockResolvedValue(result({ intent: "general", confidence: 0.95, riskLevel: "none" }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Param iadesi istiyorum, rezervasyonu iptal edin")).json();
    expect(json.escalated).toBe(true);
  });

  it("escalates a benign-worded message the model LABELS high-stakes (riskType parity with the inbox gate)", async () => {
    // intent=general + riskLevel low + confidence high + benign wording → the
    // intent, fallback, injection, detectRiskType, riskLevel and confidence checks
    // ALL pass. The ONLY thing that should hold this back is the model's own
    // high-stakes riskType label — the parity the inbox auto-send gate already has.
    mockSuggest.mockResolvedValue(
      result({ intent: "general", riskLevel: "low", confidence: 0.9, riskType: "review_threat" }),
    );
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Otoparkı nasıl kullanabilirim?")).json();
    expect(json.escalated).toBe(true);
  });

  it("escalates a low-confidence answer rather than guessing at the doorway", async () => {
    mockSuggest.mockResolvedValue(result({ confidence: 0.5 }));
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const json = await (await call(token, "Klima nasıl çalışır?")).json();
    expect(json.escalated).toBe(true);
  });

  it("escalates WITHOUT a paid model call once the durable daily AI cap is hit (H2)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const day = new Date().toISOString().slice(0, 10);
    await prisma.chatUsage.create({ data: { propertyId, day, count: 200 } });

    const res = await call(token, "Bir sorum var");
    const json = await res.json();
    expect(json.escalated).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled(); // over cap → the model is never called
    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    expect(convos[0].priority).toBe("urgent");
    expect(await prisma.message.count({ where: { conversationId: convos[0].id } })).toBe(2);
  });

  it("returns 'closed' (no model call, no inbox write) when there is no active stay", async () => {
    const { propertyId } = await makeOrgWithProperty();
    // Enable the chat but DON'T create a reservation → the apartment is vacant.
    const token = generateChatToken();
    await prisma.property.update({
      where: { id: propertyId },
      data: { chatToken: token, chatEnabled: true },
    });

    const res = await call(token, "Merhaba, bir sorum var");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.closed).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(0);
  });

  it("YARIŞ (Codex P1): aynı cihazdan iki PARALEL ilk mesaj rezervasyona TEK konuşma açar", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // Cihazı bağla (ilk mesaj) ve çerezi al; sonra konuşmayı silerek "cihaz
    // bağlı ama konuşma henüz yok" ilk-oluşturma durumunu yeniden kur (host
    // reset sonrası ile aynı durum) — yarış tam bu pencerede yaşanır.
    const first = await call(token, "İlk bağlama mesajı");
    expect(first.status).toBe(200);
    const cookie = deviceCookie(first);
    await prisma.message.deleteMany({ where: { conversation: { propertyId } } });
    await prisma.conversation.deleteMany({ where: { propertyId } });

    const [a, b] = await Promise.all([
      call(token, "Paralel mesaj A", cookie),
      call(token, "Paralel mesaj B", cookie),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200); // yarışı kaybeden istek de mesajını KAYBETMEZ

    // Deterministik PK sayesinde interleaving ne olursa olsun TEK konuşma.
    const convos = await prisma.conversation.findMany({ where: { propertyId } });
    expect(convos).toHaveLength(1);
    const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(convos[0].id).toBe(`qrconv_${reservation.id}`);
    // Her iki misafir mesajı da aynı thread'de (2 inbound + 2 bot yanıtı).
    const inbound = await prisma.message.count({
      where: { conversationId: convos[0].id, direction: "inbound" },
    });
    expect(inbound).toBe(2);
  });

  // ── requestId idempotency (Codex 07-24 #2): a lost-response retry must not
  // duplicate the guest message, burn a second paid model call, or re-escalate. ──
  describe("requestId idempotency", () => {
    const RID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";

    it("same requestId + same message → processed ONCE; the retry is a deduped no-op", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const first = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(first.status).toBe(200);
      const cookie = deviceCookie(first);

      const retry = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: RID });
      expect(retry.status).toBe(200);
      expect((await retry.json()).deduped).toBe(true);

      expect(mockSuggest).toHaveBeenCalledTimes(1); // no second paid model call
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(1);
      expect(await prisma.message.count({ where: { direction: "outbound" } })).toBe(1);
      // The per-apartment daily AI budget burned once, not twice.
      expect((await prisma.chatUsage.findFirstOrThrow()).count).toBe(1);
    });

    it("a FRESH requestId with the same text is a DELIBERATE repeat → recorded again ('ok' twice works)", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const first = await call(token, "ok", undefined, { requestId: RID });
      const cookie = deviceCookie(first);
      const second = await call(token, "ok", cookie, {
        requestId: "cccccccc-4444-5555-6666-dddddddddddd",
      });
      expect(second.status).toBe(200);
      expect((await second.json()).deduped).toBeUndefined();
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(2);
    });

    it("same requestId + DIFFERENT message → 409 (Codex r2): neither swallowed nor double-processed", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const first = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(first.status).toBe(200);
      const cookie = deviceCookie(first);

      const reused = await call(token, "Bambaşka bir mesaj", cookie, { requestId: RID });
      expect(reused.status).toBe(409); // loud contract violation, not a silent dedupe
      expect(await prisma.message.count({ where: { body: "Bambaşka bir mesaj" } })).toBe(0);
      expect(mockSuggest).toHaveBeenCalledTimes(1); // second body never reached the model
      // The original claim is untouched: the SAME payload still dedupes.
      const retry = await call(token, "Çöp ne zaman toplanıyor?", cookie, { requestId: RID });
      expect((await retry.json()).deduped).toBe(true);
    });

    it("TTL: a crashed claim holder cannot lock the retry out forever — the expired row is swept", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      // A claim row left behind by a process that died mid-flight, past its TTL.
      await prisma.systemLock.create({
        data: {
          name: `outbound-send:qr-in:${reservation.id}:${RID}`,
          lockedUntil: new Date(Date.now() - 1000),
          holder: "stale-digest-of-a-dead-run",
        },
      });
      const res = await call(token, "Çöp ne zaman toplanıyor?", undefined, { requestId: RID });
      expect(res.status).toBe(200);
      expect((await res.json()).deduped).toBeUndefined(); // processed, not deduped
      expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(1);
    });

    it("malformed requestId → 400, nothing recorded, no model call", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      const res = await call(token, "merhaba", undefined, { requestId: "x; DROP TABLE" });
      expect(res.status).toBe(400);
      expect(mockSuggest).not.toHaveBeenCalled();
      expect(await prisma.message.count()).toBe(0);
    });

    it("PRE-RECORD failure releases the claim — a crashed attempt does not swallow the retry", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const token = await enableChat(propertyId);
      // Bind the device first (mirrors the page-open GET) so the failing POST and
      // its retry share the stay cookie.
      const warm = await call(token, "merhaba");
      const cookie = deviceCookie(warm);

      mockSuggest.mockRejectedValueOnce(new Error("model down"));
      await expect(call(token, "Çöp günü hangi gün?", cookie, { requestId: RID })).rejects.toThrow("model down");
      expect(await prisma.message.count({ where: { body: "Çöp günü hangi gün?" } })).toBe(0); // nothing persisted

      // Same id retried → the released claim lets it process normally.
      const retry = await call(token, "Çöp günü hangi gün?", cookie, { requestId: RID });
      expect(retry.status).toBe(200);
      expect((await retry.json()).deduped).toBeUndefined();
      expect(
        await prisma.message.count({ where: { body: "Çöp günü hangi gün?", direction: "inbound" } }),
      ).toBe(1);
    });
  });
});
