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
    data: { conversationId: convo.id, direction: "inbound", senderName: "Misafir", body: "Merhaba", language: "tr" },
  });
  return convo.id;
}

const rows = (conversationId: string) =>
  prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { direction: true, senderName: true },
  });

describe("POST /api/guest-chats/[id]/reply — handoff-marker identity is reliable", () => {
  beforeEach(async () => {
    await resetDb();
    session = null;
  });

  it("a host whose display name collides with a reserved marker is still a HOST reply (AI stays paused)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    // The handoff state keys off senderName; a host must not be able to masquerade as
    // the resume marker by setting their account name to the sentinel value.
    session = sess(orgId, AI_RESUME_MARKER);
    const res = await call(id, "Ben ilgileniyorum.");
    expect(res.status).toBe(201);
    const stored = await rows(id);
    expect(stored.some((m) => m.senderName === AI_RESUME_MARKER)).toBe(false); // sanitized
    expect(guestChatAiPausedFromMessages(stored)).toBe(true); // reads as a takeover, not a resume
  });

  it("a host name colliding with the bot marker ('Lixus AI') is likewise stored as a host reply", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "Lixus AI");
    await call(id, "Yardımcı olayım.");
    const stored = await rows(id);
    expect(stored.some((m) => m.direction === "outbound" && m.senderName === "Lixus AI")).toBe(false);
    expect(guestChatAiPausedFromMessages(stored)).toBe(true);
  });

  it("a normal host reply keeps the host's name and pauses the AI", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "Ayşe Yılmaz");
    await call(id, "Merhaba, yardımcı olayım.");
    expect(guestChatAiPausedFromMessages(await rows(id))).toBe(true);
  });
});
