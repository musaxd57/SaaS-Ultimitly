import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeStorageAdapter } from "../helpers/fake-storage";
import {
  enqueueStorageDeletions,
  drainStorageDeletions,
  hasPendingStorageDeletions,
} from "@/lib/storage/deletion-queue";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";
import { deleteAccountData } from "@/lib/data-retention";
import type { SessionPayload } from "@/lib/auth";

// Red-first wiring tests for private object storage. The provider is ALWAYS the
// in-memory fake (no bucket exists; CI must never call a real provider).

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

let fake = new FakeStorageAdapter();
vi.mock("@/lib/storage/adapter", () => ({
  getStorageAdapter: () => fake,
}));

import { POST as uploadPOST } from "@/app/api/upload/route";
import { GET as serveGET } from "@/app/api/storage/photo/[...key]/route";
import { DELETE as taskDELETE } from "@/app/api/tasks/[id]/route";

const SECRET = "provider-secret-must-never-appear";
const STORAGE_ENV = {
  STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  STORAGE_BUCKET: "lixus-photos",
  STORAGE_ACCESS_KEY_ID: "AKIDEXAMPLE",
  STORAGE_SECRET_ACCESS_KEY: SECRET,
};

function stubStorageEnv(flagOn: boolean) {
  for (const [k, v] of Object.entries(STORAGE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("STORAGE_ENABLED", flagOn ? "1" : "");
}

// A tiny REAL PNG header so sniffImageExt accepts the bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function uploadReq(opts: { bytes?: Uint8Array; type?: string; taskId?: string | null; name?: string } = {}) {
  const fd = new FormData();
  fd.append("file", new File([opts.bytes ?? PNG_BYTES], opts.name ?? "a.png", { type: opts.type ?? "image/png" }));
  if (opts.taskId !== null) fd.append("taskId", opts.taskId ?? "");
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: fd });
}
const noCtx = { params: Promise.resolve({}) };

let seedCounter = 0;
async function seed(role: SessionPayload["role"] = "owner", opts: { assignToUser?: boolean } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "U", email: `u${++seedCounter}@x.com`, passwordHash: "x", role },
  });
  const task = await prisma.task.create({
    data: {
      propertyId,
      type: "cleaning",
      title: "Temizlik",
      status: "todo",
      priority: "standard",
      ...(opts.assignToUser ? { assignedToId: user.id } : {}),
    },
  });
  session = { userId: user.id, organizationId: orgId, role, email: user.email, name: "U", sessionEpoch: 0 };
  return { orgId, propertyId, taskId: task.id, userId: user.id };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
  fake = new FakeStorageAdapter();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  // The flag-OFF pin test exercises the REAL legacy path, writing to
  // public/uploads/{orgSlug}/. Remove ONLY those per-org subdirectories — never
  // the uploads root or its tracked `.gitkeep` (deleting tracked files is off-limits).
  const uploadsRoot = join(process.cwd(), "public", "uploads");
  const entries = await readdir(uploadsRoot, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isDirectory()) await rm(join(uploadsRoot, e.name), { recursive: true, force: true }).catch(() => {});
  }
});

describe("upload — flag ON: task-bound, org-owned, fail-closed validation", () => {
  it("owner uploads to their own task → org/task-scoped PRIVATE key, no public /uploads URL", async () => {
    const { orgId, taskId } = await seed("owner");
    stubStorageEnv(true);
    const res = await uploadPOST(uploadReq({ taskId }), noCtx);
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url.startsWith(`${STORAGE_PHOTO_URL_PREFIX}org/${orgId}/task/${taskId}/`)).toBe(true);
    expect(url).not.toContain("/uploads/"); // never the legacy public path
    // Object landed in the (fake) bucket with the sniffed content type.
    expect(fake.puts.length).toBe(1);
    expect(fake.objects.get(fake.puts[0])?.contentType).toBe("image/png");
    // The stored photoUrl passes the EXISTING task validator (same-origin relative).
    expect(/^\/(?!\/)/.test(url)).toBe(true);
  });

  it("staff: assigned task OK; unassigned task 403; nothing reaches the provider on refusal", async () => {
    const a = await seed("staff", { assignToUser: true });
    stubStorageEnv(true);
    expect((await uploadPOST(uploadReq({ taskId: a.taskId }), noCtx)).status).toBe(200);

    const b = await seed("staff", { assignToUser: false }); // new org+task, NOT assigned
    stubStorageEnv(true);
    const res = await uploadPOST(uploadReq({ taskId: b.taskId }), noCtx);
    expect(res.status).toBe(403);
    expect(fake.puts.length).toBe(1); // only the first upload stored anything
  });

  it("cross-tenant taskId → 404 (IDOR) and no object is stored", async () => {
    const victim = await seed("owner"); // creates victim org + task
    await seed("owner"); //               session now belongs to a DIFFERENT org
    stubStorageEnv(true);
    const res = await uploadPOST(uploadReq({ taskId: victim.taskId }), noCtx);
    expect(res.status).toBe(404);
    expect(fake.puts.length).toBe(0);
  });

  it("missing taskId → 400 (storage uploads are ALWAYS task-bound)", async () => {
    await seed("owner");
    stubStorageEnv(true);
    expect((await uploadPOST(uploadReq({ taskId: null }), noCtx)).status).toBe(400);
    expect((await uploadPOST(uploadReq({ taskId: "" }), noCtx)).status).toBe(400);
    expect(fake.puts.length).toBe(0);
  });

  it("fail-closed validation: spoofed bytes, wrong MIME, oversize → 400, provider untouched", async () => {
    const { taskId } = await seed("owner");
    stubStorageEnv(true);
    // Declared image/png but the BYTES are not an image.
    const spoofed = await uploadPOST(uploadReq({ taskId, bytes: new TextEncoder().encode("not an image") }), noCtx);
    expect(spoofed.status).toBe(400);
    // Disallowed MIME type field.
    const badMime = await uploadPOST(uploadReq({ taskId, type: "application/pdf", name: "a.pdf" }), noCtx);
    expect(badMime.status).toBe(400);
    // Over the 5 MB cap.
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    const oversize = await uploadPOST(uploadReq({ taskId, bytes: big }), noCtx);
    expect(oversize.status).toBe(400);
    expect(fake.puts.length).toBe(0);
  });
});

describe("upload — flag OFF: the legacy local-disk path is unchanged (pin)", () => {
  it("uploads to /uploads/{orgSlug}/… exactly as before and NEVER touches the adapter", async () => {
    const { orgId } = await seed("owner");
    stubStorageEnv(false); // creds present, flag OFF → still legacy (DEFAULT OFF)
    const res = await uploadPOST(uploadReq({ taskId: null }), noCtx); // no taskId — legacy never needed one
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(new RegExp(`^/uploads/${orgId.replace(/[^a-zA-Z0-9-]/g, "")}/\\d+-[0-9a-f]{12}\\.png$`));
    expect(fake.puts.length).toBe(0); // provider NEVER called with the flag off
  });
});

describe("serve — authenticated 302 to a SHORT-LIVED signed URL, tenant-checked", () => {
  const serveCtx = (key: string) => ({ params: Promise.resolve({ key: key.split("/") }) });
  const req = new NextRequest("http://localhost/api/storage/photo/x");

  it("owning-org member (staff included) gets a 302 whose target is signed, private and secret-free", async () => {
    const { orgId, taskId } = await seed("staff", { assignToUser: true });
    stubStorageEnv(false); // serving works WITHOUT the upload flag (rollback-safe)
    const key = `org/${orgId}/task/${taskId}/123-abc.png`;
    const res = await serveGET(req, serveCtx(key));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith(`${STORAGE_ENV.STORAGE_ENDPOINT}/${STORAGE_ENV.STORAGE_BUCKET}/${key}?`)).toBe(true);
    expect(loc).toContain("X-Amz-Expires=300"); // short-lived
    expect(loc).toContain("X-Amz-Signature=");
    expect(loc).not.toContain(SECRET); // credential never leaves the signer
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("cross-tenant key → opaque 404; traversal/malformed key → 404; unconfigured env → 404", async () => {
    const victim = await seed("owner");
    const victimKey = `org/${victim.orgId}/task/${victim.taskId}/123-abc.png`;
    await seed("owner"); // session: different org
    stubStorageEnv(false);
    expect((await serveGET(req, serveCtx(victimKey))).status).toBe(404);
    expect((await serveGET(req, serveCtx(`org/${victim.orgId}/task/x/../../secret.png`))).status).toBe(404);
    expect((await serveGET(req, serveCtx("weird/shape"))).status).toBe(404);
    vi.unstubAllEnvs(); // no storage env at all
    const { orgId, taskId } = await seed("owner");
    expect((await serveGET(req, serveCtx(`org/${orgId}/task/${taskId}/a.png`))).status).toBe(404);
  });
});

describe("deletion queue — idempotent, provider failure is NEVER a fake success", () => {
  it("enqueue is idempotent and drops unsafe keys", async () => {
    const n1 = await enqueueStorageDeletions(prisma, "org1", [
      "org/org1/task/t1/a.png",
      "org/org1/task/t1/a.png", // duplicate within the call
      "org/org1/task/t1/../evil.png", // unsafe → dropped
    ]);
    expect(n1).toBe(1);
    const n2 = await enqueueStorageDeletions(prisma, "org1", ["org/org1/task/t1/a.png"]); // replay
    expect(n2).toBe(0);
    expect(await prisma.storageDeletion.count()).toBe(1);
  });

  it("drain deletes the object and settles the row; a re-drain is a no-op; missing objects settle too", async () => {
    fake.objects.set("org/o/task/t/a.png", { body: PNG_BYTES, contentType: "image/png" });
    await enqueueStorageDeletions(prisma, "o", ["org/o/task/t/a.png", "org/o/task/t/never-stored.png"]);
    const r1 = await drainStorageDeletions({ adapter: fake });
    expect(r1).toEqual({ skipped: false, deleted: 2, failed: 0 }); // missing object = idempotent success
    expect(fake.objects.size).toBe(0);
    expect(await hasPendingStorageDeletions()).toBe(false);
    const rows = await prisma.storageDeletion.findMany();
    expect(rows.every((r) => r.status === "deleted" && r.deletedAt != null)).toBe(true);
    const r2 = await drainStorageDeletions({ adapter: fake });
    expect(r2).toEqual({ skipped: false, deleted: 0, failed: 0 }); // nothing pending → no provider calls
    expect(fake.deletes.length).toBe(2);
  });

  it("provider failure: row STAYS pending with backoff + attempt count (no fake success), then succeeds later", async () => {
    fake.objects.set("org/o/task/t/a.png", { body: PNG_BYTES, contentType: "image/png" });
    await enqueueStorageDeletions(prisma, "o", ["org/o/task/t/a.png"]);
    fake.failDeletes = true;
    // t0 must be AT/AFTER the row's availableAt (set to real now() at enqueue), else the
    // row isn't "due" and the drain finds nothing. A small forward offset is safe + stable.
    const t0 = new Date(Date.now() + 60_000);
    const r = await drainStorageDeletions({ adapter: fake, now: () => t0 });
    expect(r).toEqual({ skipped: false, deleted: 0, failed: 1 });
    const row = await prisma.storageDeletion.findFirstOrThrow();
    expect(row.status).toBe("pending"); // NEVER marked deleted on failure
    expect(row.attemptCount).toBe(1);
    expect(row.availableAt.getTime()).toBeGreaterThan(t0.getTime()); // backed off
    expect(row.lastError).toBe("HTTP 503"); // status code only
    expect(fake.objects.size).toBe(1); // object still there
    // Provider recovers → the SAME row settles on a later drain.
    fake.failDeletes = false;
    const later = new Date(row.availableAt.getTime() + 1000);
    const r2 = await drainStorageDeletions({ adapter: fake, now: () => later });
    expect(r2.deleted).toBe(1);
    expect((await prisma.storageDeletion.findFirstOrThrow()).status).toBe("deleted");
    expect(fake.objects.size).toBe(0);
  });

  it("unconfigured (adapter null) → skipped, rows wait untouched", async () => {
    await enqueueStorageDeletions(prisma, "o", ["org/o/task/t/a.png"]);
    const r = await drainStorageDeletions({ adapter: null });
    expect(r).toEqual({ skipped: true, deleted: 0, failed: 0 });
    expect((await prisma.storageDeletion.findFirstOrThrow()).status).toBe("pending");
  });
});

describe("task DELETE — enqueues ONLY that task's storage keys, atomically", () => {
  const delCtx = (id: string) => ({ params: Promise.resolve({ id }) });
  const delReq = (id: string) => new NextRequest(`http://localhost/api/tasks/${id}`, { method: "DELETE" });

  it("storage-backed photos are queued; legacy /uploads photos are NOT; task row is gone", async () => {
    const { orgId, taskId, userId } = await seed("owner");
    const key = `org/${orgId}/task/${taskId}/111-aaa.png`;
    await prisma.taskUpdate.createMany({
      data: [
        { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key },
        { taskId, userId, photoUrl: "/uploads/legacy/old.png" }, // legacy: never migrated/deleted
        { taskId, userId, note: "no photo" },
      ],
    });
    const res = await taskDELETE(delReq(taskId), delCtx(taskId));
    expect(res.status).toBe(200);
    expect(await prisma.task.count({ where: { id: taskId } })).toBe(0);
    const queued = await prisma.storageDeletion.findMany();
    expect(queued.map((q) => q.objectKey)).toEqual([key]); // ONLY the storage key
    expect(queued[0].organizationId).toBe(orgId);
  });

  it("cross-tenant task DELETE → 404 and NOTHING is queued", async () => {
    const victim = await seed("owner");
    const key = `org/${victim.orgId}/task/${victim.taskId}/111-aaa.png`;
    await prisma.taskUpdate.create({
      data: { taskId: victim.taskId, userId: victim.userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key },
    });
    await seed("owner"); // different org session
    const res = await taskDELETE(delReq(victim.taskId), delCtx(victim.taskId));
    expect(res.status).toBe(404);
    expect(await prisma.task.count({ where: { id: victim.taskId } })).toBe(1);
    expect(await prisma.storageDeletion.count()).toBe(0);
  });
});

describe("account erasure — intents SURVIVE the org cascade; provider outage can't fake-success", () => {
  it("deleteAccountData queues the org's storage keys, deletes the org, and the queue rows persist", async () => {
    const { orgId, taskId, userId } = await seed("owner");
    const key = `org/${orgId}/task/${taskId}/222-bbb.png`;
    await prisma.taskUpdate.createMany({
      data: [
        { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key },
        { taskId, userId, photoUrl: "/uploads/legacy/old.png" }, // legacy path handled by local rm, not the queue
      ],
    });
    fake.objects.set(key, { body: PNG_BYTES, contentType: "image/png" });

    await deleteAccountData(orgId);

    // Org (and every FK'd row) is gone — but the deletion intent SURVIVED (no FK).
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
    expect(await prisma.taskUpdate.count()).toBe(0);
    const queued = await prisma.storageDeletion.findMany();
    expect(queued.map((q) => q.objectKey)).toEqual([key]);
    expect(queued[0].organizationId).toBe(orgId); // opaque tenant tag for ops/audit

    // Provider down at drain time → row stays pending (erasure NOT faked as done)…
    fake.failDeletes = true;
    await drainStorageDeletions({ adapter: fake });
    expect((await prisma.storageDeletion.findFirstOrThrow()).status).toBe("pending");
    expect(fake.objects.size).toBe(1);
    // …provider back → the object really goes away.
    fake.failDeletes = false;
    const later = new Date(Date.now() + 60 * 60_000);
    await drainStorageDeletions({ adapter: fake, now: () => later });
    expect((await prisma.storageDeletion.findFirstOrThrow()).status).toBe("deleted");
    expect(fake.objects.size).toBe(0);
  });
});
