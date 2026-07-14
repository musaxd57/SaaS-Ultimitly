import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { AI_RESUME_MARKER } from "@/lib/guest-chat";
import type { SessionPayload } from "@/lib/auth";

// Partial mock: keep the real canManage/unauthorized/forbidden, override only the
// session source so we can drive the role gate.
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/guest-chats/[id]/resume-ai/route";

function call(id: string) {
  const req = new Request(`http://localhost/api/guest-chats/${id}/resume-ai`, { method: "POST" });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

function sess(orgId: string, role: SessionPayload["role"]): SessionPayload {
  return { userId: "u", organizationId: orgId, role, email: "x@x.com", name: "Ekip", sessionEpoch: 0 };
}

/** A qr-chat thread with a guest message and (optionally) a host reply → paused. */
async function makeChatConvo(propertyId: string, withHostReply = true): Promise<string> {
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
  if (withHostReply) {
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "outbound", senderName: "Ev Sahibi", body: "Ben bakıyorum", language: "tr" },
    });
  }
  return convo.id;
}

const markerCount = (conversationId: string) =>
  prisma.message.count({ where: { conversationId, senderName: AI_RESUME_MARKER } });

describe("POST /api/guest-chats/[id]/resume-ai (host re-enables the AI)", () => {
  beforeEach(async () => {
    await resetDb();
    session = null;
  });

  it("401 when unauthenticated", async () => {
    expect((await call("x")).status).toBe(401);
  });

  it("403 for staff — owner/manager only", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "staff");
    expect((await call(id)).status).toBe(403);
    expect(await markerCount(id)).toBe(0); // nothing written
  });

  it("owner resumes a paused thread → writes exactly one resume marker", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = sess(orgId, "owner");
    const res = await call(id);
    expect(res.status).toBe(201);
    expect(await markerCount(id)).toBe(1);
    // The marker is the newest non-bot outbound → thread is active again.
    const last = await prisma.message.findFirst({
      where: { conversationId: id, direction: "outbound", senderName: { not: "Lixus AI" } },
      orderBy: { createdAt: "desc" },
      select: { senderName: true },
    });
    expect(last?.senderName).toBe(AI_RESUME_MARKER);
  });

  it("is idempotent — a no-op (200) when the AI is already active", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId, false); // no host reply → already active
    session = sess(orgId, "manager");
    const res = await call(id);
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyActive).toBe(true);
    expect(await markerCount(id)).toBe(0);
  });

  it("404 for another org's conversation (IDOR-safe)", async () => {
    const a = await makeOrgWithProperty();
    const id = await makeChatConvo(a.propertyId);
    const b = await makeOrgWithProperty();
    session = sess(b.orgId, "owner");
    expect((await call(id)).status).toBe(404);
    expect(await markerCount(id)).toBe(0);
  });
});
