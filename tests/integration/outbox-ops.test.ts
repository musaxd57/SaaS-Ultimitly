import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { listOutboxDeliveries, canManualRetry } from "@/lib/outbox/ops";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import type { SessionPayload } from "@/lib/auth";

// Ops screen (#8 görünürlük): tenant-scoped, PII-free list + the ONE narrow
// manual action (retry a definitively-failed row). The route is exercised
// through the real withManage wrapper — only requireSession is mocked.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/outbox/[id]/retry/route";

const SECRET_BODY = "GIZLI-GOVDE kapı kodu 4711 misafir Ayşe Yılmaz";
const CLAIM_TOKEN = "worker-claim-token-abc";
let keyCounter = 0;

async function mkRow(
  organizationId: string,
  over: Partial<{
    status: string;
    lastErrorKind: string | null;
    lastErrorCode: string | null;
    attemptCount: number;
    conversationId: string | null;
    messageType: string | null;
    claimedBy: string | null;
  }> = {},
) {
  return prisma.messageOutbox.create({
    data: {
      organizationId,
      conversationId: over.conversationId ?? null,
      messageId: null,
      channel: "airbnb",
      externalReservationId: `res-${++keyCounter}`,
      messageType: over.messageType ?? "ai",
      body: SECRET_BODY,
      idempotencyKey: `k-${keyCounter}`,
      status: over.status ?? "pending",
      attemptCount: over.attemptCount ?? 0,
      lastErrorKind: over.lastErrorKind ?? null,
      lastErrorCode: over.lastErrorCode ?? null,
      claimedBy: over.claimedBy ?? null,
    },
    select: { id: true },
  });
}

async function seedOrg(role: SessionPayload["role"] = "owner") {
  const { orgId } = await makeOrgWithProperty();
  // Real user so the audit write (FK on actorUserId) actually persists.
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `o${++keyCounter}@x.com`, passwordHash: "x", role },
  });
  session = { userId: user.id, organizationId: orgId, role, email: user.email, name: "O", sessionEpoch: 0 };
  return { orgId, userId: user.id };
}

const req = (id: string) => new NextRequest(`http://localhost/api/outbox/${id}/retry`, { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
});

describe("listOutboxDeliveries — tenant-scoped, PII-free, filtered, paginated", () => {
  it("returns ONLY the caller org's rows and NEVER the body / idempotency key / claim token", async () => {
    const { orgId: a } = await seedOrg();
    const { orgId: b } = await makeOrgWithProperty();
    await mkRow(a, { status: "pending" });
    await mkRow(a, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400", claimedBy: CLAIM_TOKEN });
    await mkRow(a, { status: "blocked", lastErrorKind: "blocked", lastErrorCode: "HTTP 402" });
    const bRow = await mkRow(b, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400" });

    const list = await listOutboxDeliveries(a);
    expect(list.total).toBe(3);
    expect(list.rows.map((r) => r.id)).not.toContain(bRow.id); // tenant isolation

    // PII/secret scan on the WHOLE returned structure: no body text, no guest
    // name, no claim token — and the sensitive keys are not even selected.
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("GIZLI-GOVDE");
    expect(serialized).not.toContain("Ayşe");
    expect(serialized).not.toContain(CLAIM_TOKEN);
    for (const row of list.rows) {
      expect("body" in row).toBe(false);
      expect("idempotencyKey" in row).toBe(false);
      expect("claimedBy" in row).toBe(false);
      expect("providerMessageId" in row).toBe(false);
    }
  });

  it("filters by status, exposes per-status counts, and ignores an invalid status string", async () => {
    const { orgId } = await seedOrg();
    await mkRow(orgId, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400" });
    await mkRow(orgId, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 422" });
    await mkRow(orgId, { status: "blocked", lastErrorKind: "blocked", lastErrorCode: "HTTP 402" });
    await mkRow(orgId, { status: "sent" });

    const failed = await listOutboxDeliveries(orgId, { status: "failed" });
    expect(failed.total).toBe(2);
    expect(failed.rows.every((r) => r.status === "failed")).toBe(true);
    expect(failed.counts.failed).toBe(2);
    expect(failed.counts.blocked).toBe(1);
    expect(failed.counts.sent).toBe(1);
    expect(failed.counts.pending).toBe(0);

    // A crafted/unknown status is NOT a filter (and not an error).
    const crafted = await listOutboxDeliveries(orgId, { status: "'; DROP TABLE --" });
    expect(crafted.total).toBe(4);
  });

  it("paginates and clamps an out-of-range page onto the last real page", async () => {
    const { orgId } = await seedOrg();
    for (let i = 0; i < 5; i++) await mkRow(orgId, { status: "pending" });

    const p1 = await listOutboxDeliveries(orgId, { take: 2, page: 1 });
    const p3 = await listOutboxDeliveries(orgId, { take: 2, page: 3 });
    expect(p1.rows.length).toBe(2);
    expect(p1.total).toBe(5);
    expect(p3.rows.length).toBe(1);

    const clamped = await listOutboxDeliveries(orgId, { take: 2, page: 99 });
    expect(clamped.page).toBe(3); // never an empty page hiding live rows
    expect(clamped.rows.length).toBe(1);
  });

  it("marks ONLY a non-402 failed row retryable (blocked/review/sent/canceled/pending never)", async () => {
    const { orgId } = await seedOrg();
    await mkRow(orgId, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400" });
    await mkRow(orgId, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 402" }); // legacy pre-blocked row
    await mkRow(orgId, { status: "blocked", lastErrorKind: "blocked", lastErrorCode: "HTTP 402" });
    await mkRow(orgId, { status: "review" });
    await mkRow(orgId, { status: "sent" });
    await mkRow(orgId, { status: "canceled" });
    await mkRow(orgId, { status: "pending" });

    const list = await listOutboxDeliveries(orgId);
    const byStatusAndCode = (s: string, c: string | null) =>
      list.rows.find((r) => r.status === s && r.lastErrorCode === c);
    expect(byStatusAndCode("failed", "HTTP 400")?.retryable).toBe(true);
    expect(byStatusAndCode("failed", "HTTP 402")?.retryable).toBe(false);
    for (const s of ["blocked", "review", "sent", "canceled", "pending"]) {
      expect(list.rows.find((r) => r.status === s)?.retryable).toBe(false);
    }
    // The predicate itself, pinned.
    expect(canManualRetry("failed", "HTTP 400")).toBe(true);
    expect(canManualRetry("failed", "HTTP 402")).toBe(false);
    expect(canManualRetry("blocked", "HTTP 402")).toBe(false);
    expect(canManualRetry("review", null)).toBe(false);
  });
});

describe("POST /api/outbox/[id]/retry — tenant-bound controlled retry", () => {
  it("owner requeues a definitively-failed row → pending with a fresh budget; audit is PII-free; the worker can deliver it", async () => {
    const { orgId } = await seedOrg("owner");
    const { id } = await mkRow(orgId, {
      status: "failed",
      lastErrorKind: "definitive_failure",
      lastErrorCode: "HTTP 400",
      attemptCount: 6,
    });

    const res = await POST(req(id), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");

    const row = await prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(0);
    expect(row.lastErrorKind).toBeNull();
    expect(row.lastErrorCode).toBeNull();

    // Audit: action + outbox id only — never the body or guest data.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "outbox.manual_retry" } });
    expect(audit.organizationId).toBe(orgId);
    expect(audit.metadataJson ?? "").toContain(id);
    expect(audit.metadataJson ?? "").not.toContain("GIZLI-GOVDE");
    expect(audit.metadataJson ?? "").not.toContain("Ayşe");

    // The requeued row is genuinely claimable: one drain delivers it.
    let calls = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++calls}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect(calls).toBe(1);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
  });

  it("is idempotent: a second click after the requeue gets 409 (row is pending, not failed)", async () => {
    const { orgId } = await seedOrg("owner");
    const { id } = await mkRow(orgId, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400" });
    expect((await POST(req(id), ctx(id))).status).toBe(200);
    const second = await POST(req(id), ctx(id));
    expect(second.status).toBe(409);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  });

  it.each([
    ["blocked", { status: "blocked", lastErrorKind: "blocked", lastErrorCode: "HTTP 402" }],
    ["review (maybe delivered)", { status: "review" }],
    ["sent", { status: "sent" }],
    ["canceled", { status: "canceled" }],
    ["legacy failed-402", { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 402" }],
  ] as const)("refuses %s with 409 and does not touch the row", async (_label, over) => {
    const { orgId } = await seedOrg("owner");
    const { id } = await mkRow(orgId, { ...over });
    const res = await POST(req(id), ctx(id));
    expect(res.status).toBe(409);
    const row = await prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(over.status); // unchanged — no blind resend, no hammering a paused subscription
    expect(await prisma.auditLog.count({ where: { action: "outbox.manual_retry" } })).toBe(0);
  });

  it("IDOR: another org's session gets 404 and the target row is untouched", async () => {
    const { orgId: victim } = await makeOrgWithProperty();
    const { id } = await mkRow(victim, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400" });
    await seedOrg("owner"); // session now belongs to a DIFFERENT org
    const res = await POST(req(id), ctx(id));
    expect(res.status).toBe(404);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });

  it("STAFF gets 403 (withManage) and nothing changes", async () => {
    const { orgId } = await seedOrg("staff");
    const { id } = await mkRow(orgId, { status: "failed", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 400" });
    const res = await POST(req(id), ctx(id));
    expect(res.status).toBe(403);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });

  it("no session → 401", async () => {
    session = null;
    const res = await POST(req("whatever"), ctx("whatever"));
    expect(res.status).toBe(401);
  });
});
