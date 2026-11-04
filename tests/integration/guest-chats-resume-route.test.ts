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
    data: { conversationId: convo.id, direction: "inbound", authorType: "guest", senderName: "Misafir", body: "Merhaba", language: "tr" },
  });
  if (withHostReply) {
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Ben bakıyorum", language: "tr" },
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

  it("🚨 K8: bürünmüşken (salt-okunur destek görünümü) 403 — yapay zekâ yeniden açılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const id = await makeChatConvo(propertyId);
    session = { ...sess(orgId, "owner"), actorUserId: "op1", actorEmail: "ops@lixusai.com", impersonatedAt: Math.floor(Date.now() / 1000) };
    const res = await call(id);
    expect(res.status).toBe(403);
    expect(await markerCount(id)).toBe(0);
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
    // The marker is a typed SYSTEM event (reliable), not just a senderName string.
    const marker = await prisma.message.findFirst({
      where: { conversationId: id, senderName: AI_RESUME_MARKER },
      select: { authorType: true, systemEventType: true },
    });
    expect(marker?.authorType).toBe("system");
    expect(marker?.systemEventType).toBe("guest_chat_ai_resumed");
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

  it("🚨 K-T1 (kurucu 11-04): yeniden açma O konaklamanın kritik acil tekrar hafızasını siler (aynı acil yeniden uyarır); başka konaklamanınki kalır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const mk = (guestName: string) =>
      prisma.reservation.create({
        data: { propertyId, guestName, arrivalDate: new Date(Date.now() - 86_400_000), departureDate: new Date(Date.now() + 2 * 86_400_000), status: "confirmed", channel: "airbnb" },
      });
    const res = await mk("Misafir");
    const other = await mk("Diğer");
    const id = await makeChatConvo(propertyId);
    await prisma.conversation.update({ where: { id }, data: { externalReservationId: `qr-chat:${propertyId}:${res.id}` } });
    const until = new Date(Date.now() + 3_600_000);
    await prisma.systemLock.createMany({
      data: [
        { name: `qr-crit-recent:${res.id}:crit:aaa`, lockedUntil: until },
        { name: `qr-crit-recent:${other.id}:crit:bbb`, lockedUntil: until },
      ],
    });
    await prisma.reservation.update({ where: { id: res.id }, data: { qrEscalationEmailMessageId: "crit:aaa", qrEscalationEmailAt: new Date() } });
    session = sess(orgId, "manager");
    expect((await call(id)).status).toBe(201);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: `qr-crit-recent:${res.id}:` } } })).toBe(0);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: `qr-crit-recent:${other.id}:` } } })).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } })).qrEscalationEmailMessageId).toBeNull();
  });
});
