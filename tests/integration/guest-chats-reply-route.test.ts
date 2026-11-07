import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { AI_RESUME_MARKER, guestChatAiPausedFromMessages } from "@/lib/guest-chat";
import type { SessionPayload } from "@/lib/auth";

// Partial mock: real canManage/etc., override only the session source.
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/guest-chats/[id]/reply/route";

function call(id: string, body: string) {
  const req = new Request(`http://localhost/api/guest-chats/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

function sess(orgId: string, name: string): SessionPayload {
  return { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name, sessionEpoch: 0 };
}

async function makeChatConvo(propertyId: string): Promise<string> {
  const convo = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "chat",
      guestIdentifier: "Misafir",
      status: "answered",
      externalReservationId: `qr-chat:${propertyId}:res1`,
    },
  });
  await prisma.message.create({
    data: { conversationId: convo.id, direction: "inbound", authorType: "guest", senderName: "Misafir", body: "Merhaba", language: "tr" },
  });
  return convo.id;
}

const rows = (conversationId: string) =>
  prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { direction: true, senderName: true, authorType: true, systemEventType: true },
  });

describe("POST /api/guest-chats/[id]/reply — handoff identity is authorType, not senderName", () => {
  beforeEach(async () => {
    await resetDb();
    session = null;
  });

  it("a host whose display name equals the RESUME marker is still authorType=host (AI stays paused)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    // A hostile/unlucky display name must NOT let a host reply masquerade as a system
    // resume event — the classifier is authorType, not the host-controlled senderName.
    session = sess(orgId, AI_RESUME_MARKER);
    const res = await call(id, "Ben ilgileniyorum.");
    expect(res.status).toBe(201);
    const stored = await rows(id);
    const out = stored.find((m) => m.direction === "outbound");
    expect(out?.authorType).toBe("host"); // reliable signal
    expect(out?.senderName).toBe(AI_RESUME_MARKER); // real name preserved for display/audit
    expect(guestChatAiPausedFromMessages(stored)).toBe(true); // reads as a takeover, not a resume
  });

  it("a host whose display name equals the BOT marker ('Lixus AI') is still authorType=host", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "Lixus AI");
    await call(id, "Yardımcı olayım.");
    const stored = await rows(id);
    const out = stored.find((m) => m.direction === "outbound");
    expect(out?.authorType).toBe("host");
    expect(guestChatAiPausedFromMessages(stored)).toBe(true);
  });

  it("a normal host reply is authorType=host and pauses the AI", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "Ayşe Yılmaz");
    await call(id, "Merhaba, yardımcı olayım.");
    const stored = await rows(id);
    expect(stored.find((m) => m.direction === "outbound")?.authorType).toBe("host");
    expect(guestChatAiPausedFromMessages(stored)).toBe(true);
  });
});

// Tur 3 (11-04): başka siteden yazma kapısı + içerik türü yazma kotasından ÖNCE (kardeş resume-ai ve withAuth ile aynı sıra).
describe("POST /api/guest-chats/[id]/reply — site dışı / JSON olmayan istek kotaya dokunmaz", () => {
  beforeEach(async () => {
    await resetDb();
    session = null;
  });

  it("site dışı istek 403, JSON olmayan 415; ikisi de yazma kovası satırı açmaz ve mesaj yazmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "Ev Sahibi");
    const cross = new Request(`http://localhost/api/guest-chats/${id}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ body: "Merhaba" }),
    });
    expect((await POST(cross as never, { params: Promise.resolve({ id }) })).status).toBe(403);
    const plain = new Request(`http://localhost/api/guest-chats/${id}/reply`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ body: "Merhaba" }),
    });
    expect((await POST(plain as never, { params: Promise.resolve({ id }) })).status).toBe(415);
    expect(await prisma.rateLimitCounter.count()).toBe(0);
    expect((await rows(id)).filter((r) => r.direction === "outbound")).toHaveLength(0);
    // KONTROL: aynı site + JSON → yazılır.
    expect((await call(id, "Merhaba")).status).toBeLessThan(300);
  });
});

