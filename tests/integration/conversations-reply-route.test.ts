import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// Mock the session + the outbound transport. The product rule (CLAUDE.md Round-4):
// STAFF may NOT send guest-facing replies — only owner/manager. This is the single
// request-triggered send path, so it must be gated. Lock it in.
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", () => ({ sendOnChannel: vi.fn(async () => ({ ok: true, id: "sent-1" })) }));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));

import { sendOnChannel } from "@/lib/messaging";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { POST } from "@/app/api/conversations/[id]/reply/route";
import { POST as QR_REPLY } from "@/app/api/guest-chats/[id]/reply/route";
import { getAiOpsReport } from "@/lib/reports";

const mockSend = vi.mocked(sendOnChannel);
const mockToken = vi.mocked(getOrgHospitableToken);

function req(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/conversations/[id]/reply — staff RBAC gate", () => {
  let orgId: string;
  let conversationId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.unstubAllEnvs(); // clear any DURABLE_OUTBOX_ENABLED stub from a prior test
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const property = await prisma.property.create({
      data: { organizationId: orgId, name: "Daire 1" },
    });
    const conv = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        guestIdentifier: "Guest",
        channel: "airbnb",
        externalReservationId: "res-1",
        status: "waiting",
      },
    });
    conversationId = conv.id;
  });

  it("FORBIDS a staff user from sending — 403, nothing sent, no outbound row", async () => {
    session = { userId: "u", organizationId: orgId, role: "staff", email: "s@x.com", name: "Staff", sessionEpoch: 0 };
    const res = await POST(req(conversationId, { body: "Merhaba" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
    const count = await prisma.message.count({ where: { conversationId, direction: "outbound" } });
    expect(count).toBe(0);
  });

  it("ALLOWS an owner to send — 201, delivered once, outbound row persisted", async () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    const res = await POST(req(conversationId, { body: "Merhaba" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(res.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const count = await prisma.message.count({ where: { conversationId, direction: "outbound" } });
    expect(count).toBe(1);
  });

  it("FAIL-CLOSED translate (Codex #30): translation failure sends NOTHING (502)", async () => {
    // OPENAI_API_KEY is empty in the test env → translate() reports failure.
    // The OLD behavior silently fell through and sent the untranslated Turkish
    // body to the guest while the host believed it went out in their language.
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    const res = await POST(req(conversationId, { body: "Merhaba, hoş geldiniz!", translateTo: "ru" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(res.status).toBe(502);
    expect(mockSend).not.toHaveBeenCalled();
    const count = await prisma.message.count({ where: { conversationId, direction: "outbound" } });
    expect(count).toBe(0);
  });

  it("credits an AI-approved send (aiAssisted) in reports, not a manual reply (#8)", async () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    // One-click "Onayla ve gönder" on an AI draft → flagged.
    await POST(req(conversationId, { body: "AI taslağı", aiAssisted: true }), {
      params: Promise.resolve({ id: conversationId }),
    });
    // A manually-typed reply → not flagged.
    await POST(req(conversationId, { body: "Elle yazıldı" }), {
      params: Promise.resolve({ id: conversationId }),
    });

    const msgs = await prisma.message.findMany({ where: { conversationId, direction: "outbound" } });
    expect(msgs.find((m) => m.body === "AI taslağı")?.aiAssisted).toBe(true);
    expect(msgs.find((m) => m.body === "Elle yazıldı")?.aiAssisted).toBe(false);

    // The reports "AI answered" metric now includes the approved AI reply (was 0
    // for an active host before this fix), but not the manual one.
    const report = await getAiOpsReport(orgId);
    expect(report.aiReplies).toBe(1);
  });

  it("does not let an owner of ANOTHER org reply into this conversation (tenant isolation)", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    session = { userId: "u2", organizationId: otherOrg.id, role: "owner", email: "o2@x.com", name: "Owner2", sessionEpoch: 0 };
    const res = await POST(req(conversationId, { body: "sızıntı" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(res.status).toBe(404); // scoped by property.organizationId → not found
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("persists a reply to an internal qr-chat thread without requiring Hospitable (H1)", async () => {
    // A QR-concierge escalation lands as a synthetic "qr-chat:<propertyId>" thread.
    // The host must be able to answer it (recorded locally) even with NO Hospitable
    // connection — and it is never POSTed to Hospitable. Before the fix this 502'd
    // and the reply was lost.
    const prop = await prisma.property.findFirstOrThrow({ where: { organizationId: orgId } });
    const qr = await prisma.conversation.create({
      data: {
        propertyId: prop.id,
        guestIdentifier: "QR Misafir",
        channel: "chat",
        externalReservationId: `qr-chat:${prop.id}`,
        status: "new",
      },
    });
    mockToken.mockResolvedValueOnce(null); // org has NO Hospitable token
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };

    const res = await POST(req(qr.id, { body: "Çöp salı günü toplanır." }), {
      params: Promise.resolve({ id: qr.id }),
    });

    expect(res.status).toBe(201);
    const count = await prisma.message.count({ where: { conversationId: qr.id, direction: "outbound" } });
    expect(count).toBe(1);
  });

  it("double-click: the identical body twice in a row → second is 409, ONE delivery, ONE row", async () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    const first = await POST(req(conversationId, { body: "Merhaba" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(first.status).toBe(201);
    // Same text again within the claim TTL (double-click / browser retry): must NOT
    // reach the guest a second time.
    const second = await POST(req(conversationId, { body: "Merhaba" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(second.status).toBe(409);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("a FAILED delivery releases the claim → an immediate retry of the same text succeeds", async () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable HTTP 400 (bad_request)" }); // DEFINITIVE → releases
    const failed = await POST(req(conversationId, { body: "Merhaba" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(failed.status).toBe(502);
    // Nothing reached the guest → the same text must be retryable right away.
    const retry = await POST(req(conversationId, { body: "Merhaba" }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(retry.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("a DIFFERENT message right after is not blocked by the duplicate guard", async () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    expect(
      (await POST(req(conversationId, { body: "Merhaba" }), { params: Promise.resolve({ id: conversationId }) })).status,
    ).toBe(201);
    expect(
      (await POST(req(conversationId, { body: "Havlular dolapta." }), { params: Promise.resolve({ id: conversationId }) }))
        .status,
    ).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("AMBIGUOUS delivery failure (timeout) keeps the claim — no immediate identical resend", async () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    mockSend.mockResolvedValueOnce({ ok: false, error: "The operation timed out" });
    const first = await POST(req(conversationId, { body: "Merhaba" }), { params: Promise.resolve({ id: conversationId }) });
    expect(first.status).toBe(502);
    expect((await first.json()).ambiguous).toBe(true);
    // The message MAY have reached the guest → the same text must NOT resend now.
    const retry = await POST(req(conversationId, { body: "Merhaba" }), { params: Promise.resolve({ id: conversationId }) });
    expect(retry.status).toBe(409);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("QR host reply: a double-click creates ONE row, second gets 409", async () => {
    const prop = await prisma.property.findFirstOrThrow({ where: { organizationId: orgId } });
    const qr = await prisma.conversation.create({
      data: {
        propertyId: prop.id,
        guestIdentifier: "QR Misafir",
        channel: "chat",
        externalReservationId: `qr-chat:${prop.id}`,
        status: "new",
      },
    });
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    const first = await QR_REPLY(req(qr.id, { body: "Kapı kodu 1234 değil, 4321." }), {
      params: Promise.resolve({ id: qr.id }),
    });
    expect(first.status).toBe(201);
    const second = await QR_REPLY(req(qr.id, { body: "Kapı kodu 1234 değil, 4321." }), {
      params: Promise.resolve({ id: qr.id }),
    });
    expect(second.status).toBe(409);
    expect(await prisma.message.count({ where: { conversationId: qr.id, direction: "outbound" } })).toBe(1);
  });

  // ── Durable Outbox (#8) — flag-gated integration on the manual reply route ──
  const owner = () => {
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  };

  it("Durable Outbox OFF (default): the reply uses the proven claim-then-send path", async () => {
    owner();
    const res = await POST(req(conversationId, { body: "Merhaba!" }), { params: Promise.resolve({ id: conversationId }) });
    expect(res.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(1); // delivered synchronously (current path)
    expect(await prisma.messageOutbox.count()).toBe(0); // nothing enqueued — outbox untouched
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("Durable Outbox ON: the reply is ENQUEUED (202), not synchronously sent; message has NO externalId yet", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    owner();
    const res = await POST(req(conversationId, { body: "Merhaba!" }), { params: Promise.resolve({ id: conversationId }) });
    expect(res.status).toBe(202); // queued, NOT delivered
    expect(mockSend).not.toHaveBeenCalled(); // the worker delivers later
    const ob = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(ob).toMatchObject({ status: "pending", channel: "airbnb", externalReservationId: "res-1", body: "Merhaba!" });
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
    expect(msg.externalId).toBeNull(); // not delivered yet → no provider id
    // #6: NOT answered on enqueue — only the worker marks it answered on confirmed delivery.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("waiting");
  });

  it("Durable Outbox ON: a double-submit of the same text dedupes to ONE queued row (200)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    owner();
    const a = await POST(req(conversationId, { body: "Aynı metin" }), { params: Promise.resolve({ id: conversationId }) });
    const b = await POST(req(conversationId, { body: "Aynı metin" }), { params: Promise.resolve({ id: conversationId }) });
    expect(a.status).toBe(202);
    expect(b.status).toBe(200); // dedupe-hit — no second queue row
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });
});
