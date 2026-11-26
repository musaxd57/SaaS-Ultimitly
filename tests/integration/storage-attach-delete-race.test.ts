import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeStorageAdapter } from "../helpers/fake-storage";
import { drainStorageDeletions, enqueueStorageDeletions, enqueueUploadOrphanCheck, hasPendingStorageDeletions, __storageDrainHooks } from "@/lib/storage/deletion-queue";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DİĞER X1 (Codex 11-10) — GÖREVE BAĞLANAN FOTOĞRAFI TEMİZLEYİCİ SİLEMEZ. Gerçek PostgreSQL, sağlayıcı bellekte taklit.
//
// Boşaltıcı "bu nesneyi gösteren görev kaydı var mı" diye bir kez okuyor, sonra siliyordu. Okumadan hemen sonra fotoğraf göreve bağlanırsa
// eski sonuçla silmeye devam ediyor; görev kaydı kovada olmayan bir fotoğrafı gösteriyordu. Artık bağlama ile silmenin sahiplenilmesi
// nesne başına aynı kilitten geçer: ya nesne kalır ve bağlanır, ya silinir ve bağlanamaz — ikisi birden olmaz.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { PATCH as taskPATCH } from "@/app/api/tasks/[id]/route";

let fake = new FakeStorageAdapter();
// Gerçek küçük PNG (K27-K11: yükleme biçimin kabuğunu yürür; çıplak başlık artık kabul edilmez).
const PNG = new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/images/rgba.png")));
const later = () => new Date(Date.now() + 25 * 60 * 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const patchCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (id: string, body: unknown) =>
  new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let seq = 0;
async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `x1-${++seq}@x.com`, passwordHash: "x", role: "owner" } });
  const task = await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Temizlik", status: "todo", priority: "standard" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "U", sessionEpoch: 0 };
  // Yüklenmiş, henüz hiçbir göreve bağlanmamış fotoğraf + yüklemenin 24 saat vadeli sahipsizlik kaydı.
  const key = `org/${orgId}/task/${task.id}/1-a.png`;
  await fake.put(key, PNG, "image/png");
  await enqueueUploadOrphanCheck(prisma, orgId, key);
  return { orgId, taskId: task.id, key, url: `${STORAGE_PHOTO_URL_PREFIX}${key}` };
}
const rowOf = (key: string) => prisma.storageDeletion.findUnique({ where: { objectKey: key } });
const shownBy = (url: string) => prisma.taskUpdate.count({ where: { photoUrl: url } });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
  fake = new FakeStorageAdapter();
  __storageDrainHooks.afterShownRead = null;
});
afterEach(() => {
  __storageDrainHooks.afterShownRead = null;
});

describe("fotoğraf bağlama ↔ silme yarışı (X1)", () => {
  it("🚨 boşaltıcı 'gösterilmiyor' okuduktan SONRA gelen bağlama isteği: nesne silinir, bağlama REDDEDİLİR — görev olmayan fotoğrafı göstermez", async () => {
    const { taskId, key, url } = await seed();
    let attach: Promise<Response> | null = null;
    __storageDrainHooks.afterShownRead = async () => {
      // Tam bu anda kullanıcı fotoğrafı göreve bağlıyor (istek başladı; sonucu aşağıda okunur).
      attach = taskPATCH(patchReq(taskId, { status: "in_progress", photoUrl: url }), patchCtx(taskId));
      await sleep(400);
    };
    const out = await drainStorageDeletions({ adapter: fake, now: later });
    expect(attach).not.toBeNull();
    const res = await (attach as unknown as Promise<Response>);

    expect(out).toMatchObject({ deleted: 1, failed: 0 });
    expect(fake.objects.has(key)).toBe(false);
    expect((await rowOf(key))?.status).toBe("deleted");
    // ⬅️ ESKİDE: bağlama 200 dönüyor, görev kaydı silinmiş nesneyi gösteriyordu.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: { photoUrl: string } }).fields.photoUrl).toBe("Fotoğraf artık kullanılamıyor. Yeniden yükleyip tekrar deneyin.");
    expect(await shownBy(url)).toBe(0);
    // İstek bütün olarak geri alındı: aynı istekteki durum değişikliği de yazılmadı (yarım kayıt yok).
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("todo");
  });

  it("🚨 ters sıra: bağlama ÖNCE tamamlanırsa boşaltıcı nesneyi SİLMEZ, kaydı iptal eder", async () => {
    const { taskId, key, url } = await seed();
    expect((await taskPATCH(patchReq(taskId, { photoUrl: url }), patchCtx(taskId))).status).toBe(200); // bekleyen kayıt bağlamayı engellemez
    const out = await drainStorageDeletions({ adapter: fake, now: later });
    expect(out).toMatchObject({ deleted: 0, failed: 0 });
    expect(fake.objects.has(key)).toBe(true);
    expect(fake.deletes).toEqual([]);
    expect(await rowOf(key)).toBeNull();
    expect(await shownBy(url)).toBe(1);
  });

  it("🚨 silmesi sahiplenilmiş ama sağlayıcıda doğrulanmamış nesne (sağlayıcı hatası) bağlanamaz; kayıt açık kalır ve sonra silinir", async () => {
    const { taskId, key, url } = await seed();
    fake.failDeletes = true;
    const t0 = later();
    expect(await drainStorageDeletions({ adapter: fake, now: () => t0 })).toEqual({ skipped: false, deleted: 0, failed: 1 });
    const row = await rowOf(key);
    expect(row?.status).toBe("deleting");
    expect(row?.attemptCount).toBe(1);
    expect(row!.availableAt.getTime()).toBeGreaterThan(t0.getTime());
    expect(await hasPendingStorageDeletions()).toBe(true); // zamanlayıcı kuyruğu boş SAYMAZ

    // Sağlayıcı hatası belirsizdir (nesne silinmiş olabilir) → bağlama kapalı.
    const res = await taskPATCH(patchReq(taskId, { photoUrl: url }), patchCtx(taskId));
    expect(res.status).toBe(400);
    expect(await shownBy(url)).toBe(0);

    // Geri çekilme dolmadan yeniden denenmez; dolunca silinir.
    expect((await drainStorageDeletions({ adapter: fake, now: () => t0 })).deleted).toBe(0);
    fake.failDeletes = false;
    const t1 = new Date(row!.availableAt.getTime() + 1_000);
    expect((await drainStorageDeletions({ adapter: fake, now: () => t1 })).deleted).toBe(1);
    expect((await rowOf(key))?.status).toBe("deleted");
    expect(fake.objects.has(key)).toBe(false);
  });

  it("🚨 silinmiş nesnenin adresi sonradan yeniden gönderilirse bağlanmaz", async () => {
    const { taskId, key, url } = await seed();
    expect((await drainStorageDeletions({ adapter: fake, now: later })).deleted).toBe(1);
    expect((await rowOf(key))?.status).toBe("deleted");
    const res = await taskPATCH(patchReq(taskId, { photoUrl: url, note: "foto" }), patchCtx(taskId));
    expect(res.status).toBe(400);
    expect(await prisma.taskUpdate.count({ where: { taskId } })).toBe(0); // not da yazılmadı
  });

  it("KONTROL: kuyrukta hiç kaydı olmayan fotoğraf (kayıt daha önce iptal edilmiş) yine bağlanır", async () => {
    const { taskId, key, url } = await seed();
    await prisma.storageDeletion.deleteMany({ where: { objectKey: key } });
    expect((await taskPATCH(patchReq(taskId, { photoUrl: url }), patchCtx(taskId))).status).toBe(200);
    expect(await shownBy(url)).toBe(1);
  });

  it("KONTROL: fotoğrafsız görev güncellemesi kuyruk durumuna bakmaz (durum / not aynen yazılır)", async () => {
    const { taskId } = await seed();
    expect((await taskPATCH(patchReq(taskId, { status: "in_progress", note: "başladım" }), patchCtx(taskId))).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("in_progress");
  });

  it("sahiplenilmiş kayıt yeniden silme niyetiyle bozulmaz: aynı anahtarın niyeti gelirse durum `deleting` kalır", async () => {
    const { orgId, key } = await seed();
    fake.failDeletes = true;
    await drainStorageDeletions({ adapter: fake, now: later });
    await enqueueStorageDeletions(prisma, orgId, [key]);
    expect((await rowOf(key))?.status).toBe("deleting");
    expect(await prisma.storageDeletion.count()).toBe(1);
  });
});
