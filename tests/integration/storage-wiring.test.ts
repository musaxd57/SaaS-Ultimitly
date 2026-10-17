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
import type { StorageAdapter } from "@/lib/storage/adapter";
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
import { DELETE as taskDELETE, PATCH as taskPATCH } from "@/app/api/tasks/[id]/route";
import { DELETE as propertyDELETE } from "@/app/api/properties/[id]/route";

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

describe("gece-4 S7-01: yüklenip göreve BAĞLANMAYAN fotoğraf kovada süresiz kalmaz", () => {
  it("🚨 yükleme 24 saat vadeli sahipsizlik kaydı yazar; bağlanmayan nesne vadesinde silinir, bağlanan nesnenin kaydı iptal edilir (nesne kalır)", async () => {
    stubStorageEnv(true);
    const { taskId } = await seed("owner");
    const orphanRes = await uploadPOST(uploadReq({ taskId }), noCtx);
    const attachedRes = await uploadPOST(uploadReq({ taskId }), noCtx);
    const orphanUrl = ((await orphanRes.json()) as { url: string }).url;
    const attachedUrl = ((await attachedRes.json()) as { url: string }).url;
    const orphanKey = orphanUrl.slice(STORAGE_PHOTO_URL_PREFIX.length);
    const attachedKey = attachedUrl.slice(STORAGE_PHOTO_URL_PREFIX.length);
    const rows = await prisma.storageDeletion.findMany({ orderBy: { objectKey: "asc" } });
    expect(rows.map((r) => r.objectKey).sort()).toEqual([orphanKey, attachedKey].sort());
    // Vade ~24 saat sonra: hemen boşaltma hiçbir şeyi silmez.
    for (const r of rows) expect(r.availableAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
    expect((await drainStorageDeletions({ adapter: fake })).deleted).toBe(0);
    // İstemci yalnız birini göreve bağladı.
    await prisma.taskUpdate.create({ data: { taskId, photoUrl: attachedUrl, note: "foto" } });
    const later = () => new Date(Date.now() + 25 * 60 * 60_000);
    const out = await drainStorageDeletions({ adapter: fake, now: later });
    expect(out).toMatchObject({ deleted: 1, failed: 0 });
    expect(fake.deletes).toEqual([orphanKey]);
    expect(await prisma.storageDeletion.findUnique({ where: { objectKey: attachedKey } })).toBeNull(); // iptal (nesne kalır)
    expect((await prisma.storageDeletion.findUniqueOrThrow({ where: { objectKey: orphanKey } })).status).toBe("deleted");
    // Bağlı nesnenin görevi sonra silinirse normal yoldan gider (eski kayıt engel olmaz).
    await enqueueStorageDeletions(prisma, (await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { property: { select: { organizationId: true } } } })).property.organizationId, [attachedKey]);
    await prisma.taskUpdate.deleteMany({ where: { taskId } });
    expect((await drainStorageDeletions({ adapter: fake, now: later })).deleted).toBe(1);
    expect(fake.deletes).toEqual([orphanKey, attachedKey]);
  });

  it("başka kiracının satırı (istemcinin yazabildiği photoUrl) sahipsiz nesneyi kovada TUTAMAZ (gösterim denetimi nesnenin kendi işletmesinde)", async () => {
    stubStorageEnv(true);
    const victim = await seed("owner");
    const res = await uploadPOST(uploadReq({ taskId: victim.taskId }), noCtx);
    const url = ((await res.json()) as { url: string }).url;
    const attacker = await seed("owner");
    await prisma.taskUpdate.create({ data: { taskId: attacker.taskId, photoUrl: url, note: "x" } });
    const out = await drainStorageDeletions({ adapter: fake, now: () => new Date(Date.now() + 25 * 60 * 60_000) });
    expect(out.deleted).toBe(1);
    expect(fake.deletes).toEqual([url.slice(STORAGE_PHOTO_URL_PREFIX.length)]);
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
    const { orgId, taskId, userId } = await seed("staff", { assignToUser: true });
    stubStorageEnv(false); // serving works WITHOUT the upload flag (rollback-safe)
    const key = `org/${orgId}/task/${taskId}/123-abc.png`;
    // F11 (09-26): yalnız bir görev güncellemesinin HÂLÂ gösterdiği nesne sunulur (↓ayrı test) — fikstür o kaydı kurar.
    await prisma.taskUpdate.create({ data: { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
    const res = await serveGET(req, serveCtx(key));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    // Virtual-hosted addressing (the default): bucket lives in the HOST, the
    // path carries only the key. Asserted on the parsed URL rather than a
    // string prefix so the tenant-scoped key is checked as a real path.
    const target = new URL(loc);
    expect(target.host).toBe(
      `${STORAGE_ENV.STORAGE_BUCKET}.${new URL(STORAGE_ENV.STORAGE_ENDPOINT).host}`,
    );
    expect(target.pathname).toBe(`/${key}`);
    expect(target.protocol).toBe("https:");
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

  it("🚨 F11: hiçbir görev güncellemesinin göstermediği nesne İMZALANMAZ (silinmiş görev/mülk, eski anahtar)", async () => {
    // Nesne kovadan ancak silme kuyruğu boşalınca kalkar; o ana kadar eski anahtarı bilen aynı kiracı kullanıcısı
    // imzalı URL alıyordu (kovada kalan nesne erişilebilirdi). Sunum artık DB'deki bağa bakar.
    const { orgId, taskId, userId } = await seed("owner");
    stubStorageEnv(false);
    const key = `org/${orgId}/task/${taskId}/555-live.png`;
    expect((await serveGET(req, serveCtx(key))).status).toBe(404); // hiç bağlanmamış
    const row = await prisma.taskUpdate.create({ data: { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
    expect((await serveGET(req, serveCtx(key))).status).toBe(302); // bağlı → sunulur
    await prisma.taskUpdate.delete({ where: { id: row.id } });
    expect((await serveGET(req, serveCtx(key))).status).toBe(404); // bağ kalktı → sunulmaz
    await prisma.taskUpdate.create({ data: { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
    await prisma.task.delete({ where: { id: taskId } });
    expect((await serveGET(req, serveCtx(key))).status).toBe(404); // görev silindi → sunulmaz
  });

  it("🚨 K2: görev başka personele geçince ESKİ personel fotoğrafı açamaz; yeni atanan ve yönetici açar", async () => {
    const { orgId, taskId, userId } = await seed("staff", { assignToUser: true });
    stubStorageEnv(false);
    const key = `org/${orgId}/task/${taskId}/900-photo.png`;
    await prisma.taskUpdate.create({ data: { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
    expect((await serveGET(req, serveCtx(key))).status).toBe(302); // atanmışken açar
    const other = await prisma.user.create({ data: { organizationId: orgId, name: "V", email: "v-k2@x.com", passwordHash: "x", role: "staff" } });
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: other.id } });
    expect((await serveGET(req, serveCtx(key))).status).toBe(404); // görevden alındı → kapandı
    session = { userId: other.id, organizationId: orgId, role: "staff", email: other.email, name: "V", sessionEpoch: 0 };
    expect((await serveGET(req, serveCtx(key))).status).toBe(302); // yeni atanan açar
    const manager = await prisma.user.create({ data: { organizationId: orgId, name: "M", email: "m-k2@x.com", passwordHash: "x", role: "manager" } });
    session = { userId: manager.id, organizationId: orgId, role: "manager", email: manager.email, name: "M", sessionEpoch: 0 };
    expect((await serveGET(req, serveCtx(key))).status).toBe(302); // yönetici hepsini açar
  });

  it("F11 aşırı uygulama yok: görev-bağı kuralından ÖNCE başka göreve iliştirilmiş eski satır hâlâ sunulur", async () => {
    // Pano bu satırları çiziyor (`isRenderablePhotoUrl` görev şartı aramaz) → sunum da kırılmamalı.
    const { orgId, propertyId, taskId, userId } = await seed("owner");
    stubStorageEnv(false);
    const other = await prisma.task.create({ data: { propertyId, type: "cleaning", title: "B", status: "todo", priority: "standard" } });
    const key = `org/${orgId}/task/${taskId}/777-old.png`;
    await prisma.taskUpdate.create({ data: { taskId: other.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
    expect((await serveGET(req, serveCtx(key))).status).toBe(302);
  });

  it("🚨 F11: bağ YALNIZ bu kiracının satırından sayılır — başka kiracının (zehirli) satırı nesneyi sunulur yapmaz", async () => {
    const owner = await seed("owner");
    const key = `org/${owner.orgId}/task/${owner.taskId}/888-x.png`;
    const foreign = await seed("owner"); // oturum: yabancı kiracı; satırı bizim anahtarımızı gösteriyor
    await prisma.taskUpdate.create({ data: { taskId: foreign.taskId, userId: foreign.userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
    session = { userId: owner.userId, organizationId: owner.orgId, role: "owner", email: "o@x.com", name: "U", sessionEpoch: 0 };
    stubStorageEnv(false);
    expect((await serveGET(req, serveCtx(key))).status).toBe(404);
  });
});

describe("property DELETE — F11: görev fotoğraflarının silme niyeti AYNI işlemde", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const delReq = (id: string) => new NextRequest(`http://localhost/api/properties/${id}`, { method: "DELETE" });

  it("🚨 mülkün TÜM görevlerinin depo fotoğrafları kuyruğa girer; eski /uploads, yabancı anahtar ve başka mülk GİRMEZ", async () => {
    const { orgId, propertyId, taskId, userId } = await seed("owner");
    const task2 = await prisma.task.create({ data: { propertyId, type: "maintenance", title: "Bakım", status: "todo", priority: "standard" } });
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Diğer" } });
    const otherTask = await prisma.task.create({ data: { propertyId: other.id, type: "cleaning", title: "T", status: "todo", priority: "standard" } });
    const k1 = `org/${orgId}/task/${taskId}/111-a.png`;
    const k2 = `org/${orgId}/task/${task2.id}/222-b.png`;
    const kOther = `org/${orgId}/task/${otherTask.id}/333-c.png`;
    await prisma.taskUpdate.createMany({
      data: [
        { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + k1 },
        { taskId: task2.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + k2 },
        { taskId, userId, photoUrl: "/uploads/legacy/old.png" },
        { taskId, userId, photoUrl: `${STORAGE_PHOTO_URL_PREFIX}org/someone-else/task/${taskId}/9-x.png` }, // zehirli
        { taskId: otherTask.id, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + kOther },
      ],
    });
    const res = await propertyDELETE(delReq(propertyId), ctx(propertyId));
    expect(res.status).toBe(200);
    expect(await prisma.property.count({ where: { id: propertyId } })).toBe(0);
    const queued = (await prisma.storageDeletion.findMany()).map((q) => q.objectKey).sort();
    expect(queued).toEqual([k1, k2].sort());
    expect(await prisma.taskUpdate.count({ where: { taskId: otherTask.id } })).toBe(1); // başka mülk dokunulmadı
  });

  it("fotoğrafsız mülk silinir, kuyruk boş; yabancı kiracının mülkü 404 ve kuyruk boş", async () => {
    const victim = await seed("owner");
    await prisma.taskUpdate.create({
      data: { taskId: victim.taskId, userId: victim.userId, photoUrl: `${STORAGE_PHOTO_URL_PREFIX}org/${victim.orgId}/task/${victim.taskId}/1-v.png` },
    });
    const me = await seed("owner"); // oturum: başka org
    expect((await propertyDELETE(delReq(victim.propertyId), ctx(victim.propertyId))).status).toBe(404);
    expect(await prisma.storageDeletion.count()).toBe(0);
    expect((await propertyDELETE(delReq(me.propertyId), ctx(me.propertyId))).status).toBe(200);
    expect(await prisma.storageDeletion.count()).toBe(0);
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

  it("TENANT CHOKE POINT: a key whose org segment != the enqueuing org is DROPPED (cross-tenant delete blocked)", async () => {
    const n = await enqueueStorageDeletions(prisma, "orgA", [
      "org/orgA/task/t1/mine.png", //    own key → kept
      "org/orgB/task/t1/victim.png", //  another tenant's key → DROPPED (would delete their object)
    ]);
    expect(n).toBe(1);
    const rows = await prisma.storageDeletion.findMany();
    expect(rows.map((r) => r.objectKey)).toEqual(["org/orgA/task/t1/mine.png"]);
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

  it("🚨 15 ajan A11: parti duvar saati bütçesini aşınca KALAN satırlar dokunulmadan sonraki geçişe kalır (başarısız sayılmaz)", async () => {
    await enqueueStorageDeletions(prisma, "o", ["org/o/task/t/a.png", "org/o/task/t/b.png", "org/o/task/t/c.png"]);
    let t = 0;
    // Her sağlayıcı çağrısı 20 sn sürmüş gibi: bütçe 30 sn → ilk iki satır işlenir, üçüncüye başlanmaz.
    // Sınıf örneği YAYILMAZ (prototip metodu `put` düşer — typecheck yakaladı): sözleşmenin iki metodu açıkça.
    const slow: StorageAdapter = {
      put: (key, body, contentType) => fake.put(key, body, contentType),
      delete: async (key: string) => {
        t += 20_000;
        await fake.delete(key);
      },
    };
    const r = await drainStorageDeletions({ adapter: slow, clock: () => t, budgetMs: 30_000 });
    expect(r).toEqual({ skipped: false, deleted: 2, failed: 0 });
    const pending = await prisma.storageDeletion.findMany({ where: { status: "pending" } });
    expect(pending).toHaveLength(1);
    expect(pending[0].attemptCount).toBe(0);
    // Sonraki geçiş kalanı siler.
    const r2 = await drainStorageDeletions({ adapter: fake });
    expect(r2.deleted).toBe(1);
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

  it("POISONED row: a TaskUpdate.photoUrl pointing at ANOTHER org's key is NOT enqueued on delete (choke point)", async () => {
    const { orgId, taskId, userId } = await seed("owner");
    const ownKey = `org/${orgId}/task/${taskId}/own.png`;
    const foreignKey = "org/someOtherOrg/task/x/victim.png"; // a poisoned value (e.g. pre-guard row)
    await prisma.taskUpdate.createMany({
      data: [
        { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + ownKey },
        { taskId, userId, photoUrl: STORAGE_PHOTO_URL_PREFIX + foreignKey },
      ],
    });
    const res = await taskDELETE(delReq(taskId), delCtx(taskId));
    expect(res.status).toBe(200);
    const queued = await prisma.storageDeletion.findMany();
    expect(queued.map((q) => q.objectKey)).toEqual([ownKey]); // foreign key dropped — never deleted
  });
});

describe("task PATCH — write-time guard rejects a cross-org storage photoUrl", () => {
  const patchCtx = (id: string) => ({ params: Promise.resolve({ id }) });
  const patchReq = (id: string, body: unknown) =>
    new NextRequest(`http://localhost/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("own-org storage photoUrl is accepted; another org's is 400; legacy /uploads is accepted", async () => {
    const { orgId, taskId } = await seed("owner");
    const own = `${STORAGE_PHOTO_URL_PREFIX}org/${orgId}/task/${taskId}/1-a.png`;
    const foreign = `${STORAGE_PHOTO_URL_PREFIX}org/otherOrg/task/t/1-a.png`;

    expect((await taskPATCH(patchReq(taskId, { photoUrl: own }), patchCtx(taskId))).status).toBe(200);
    const bad = await taskPATCH(patchReq(taskId, { photoUrl: foreign }), patchCtx(taskId));
    expect(bad.status).toBe(400);
    // Eski yerel yükleme YALNIZ bu org'un dizininde kabul edilir (09-23 daraltması).
    const legacyOwn = `/uploads/${orgId.replace(/[^a-zA-Z0-9-]/g, "")}/legacy.png`;
    expect((await taskPATCH(patchReq(taskId, { photoUrl: legacyOwn }), patchCtx(taskId))).status).toBe(200);
    // 🚨 TERS ÇEVRİLDİ (09-23): eski satır `/uploads/x/legacy.png`in 200 aldığını pinliyordu —
    // şema yalnız "göreli yol" istediği için en düşük yetkili kullanıcı keyfi aynı-kaynak
    // yolu yazabiliyordu ve değer sahibin panosunda `<img src>` olarak TIKSIZ GET üretiyordu.
    for (const arbitrary of ["/uploads/x/legacy.png", "/logout", "/api/account/export"]) {
      const r = await taskPATCH(patchReq(taskId, { photoUrl: arbitrary }), patchCtx(taskId));
      expect(r.status, arbitrary).toBe(400);
    }

    // Only the two accepted updates recorded a photoUrl; the rejected ones never persisted.
    const urls = (await prisma.taskUpdate.findMany({ select: { photoUrl: true } })).map((u) => u.photoUrl);
    expect(urls).toContain(own);
    expect(urls).toContain(legacyOwn);
    expect(urls).not.toContain(foreign);
    expect(urls).not.toContain("/logout");
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
