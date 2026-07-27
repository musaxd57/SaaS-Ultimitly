import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { photoUrlForKey } from "@/lib/storage/keys";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH, DELETE } from "@/app/api/tasks/[id]/route";

let orgId = "";
let taskId = "";
let staffId = "";
let ownerId = "";

function patchReq(body: unknown) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = () => ({ params: Promise.resolve({ id: taskId }) });

describe("PATCH /api/tasks/[id] — staff field restriction", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    // Real users so the route's taskUpdate activity-log write (FK on userId) succeeds.
    const staff = await prisma.user.create({
      data: { organizationId: org.id, name: "Staff", email: "s@x.com", passwordHash: "x", role: "staff" },
    });
    const owner = await prisma.user.create({
      data: { organizationId: org.id, name: "Owner", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    staffId = staff.id;
    ownerId = owner.id;
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
    // Assigned to the staff member, with a manager-authored checklist to tick.
    const task = await prisma.task.create({
      data: {
        propertyId: property.id,
        type: "cleaning",
        title: "Temizlik",
        status: "todo",
        priority: "standard",
        assignedToId: staff.id,
        checklistJson: JSON.stringify([
          { label: "Çarşaf takımı × 2", done: false },
          { label: "Banyo havlusu × 4", done: false },
        ]),
      },
    });
    taskId = task.id;
  });

  const staffSession = () => {
    session = { userId: staffId, organizationId: orgId, role: "staff", email: "s@x.com", name: "Staff", sessionEpoch: 0 };
  };

  it("blocks staff from changing a management field (title) with 403", async () => {
    staffSession();
    const res = await PATCH(patchReq({ title: "Yeni başlık" }), ctx());
    expect(res.status).toBe(403);
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    expect(t?.title).toBe("Temizlik"); // unchanged
  });

  it("lets staff progress THEIR assigned task (status)", async () => {
    staffSession();
    const res = await PATCH(patchReq({ status: "done" }), ctx());
    expect(res.status).toBe(200);
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    expect(t?.status).toBe("done");
  });

  it("blocks staff from touching a task NOT assigned to them (403)", async () => {
    // Re-assign the task to the owner → staff must no longer be able to touch it.
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: ownerId } });
    staffSession();
    const res = await PATCH(patchReq({ status: "done" }), ctx());
    expect(res.status).toBe(403);
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    expect(t?.status).toBe("todo"); // unchanged
  });

  it("lets staff TICK an existing checklist item (done only), keeping the labels", async () => {
    staffSession();
    // Staff sends done flags; even if labels differ, the STORED labels are kept.
    const res = await PATCH(
      patchReq({
        checklist: [
          { label: "hacked label", done: true },
          { label: "another", done: false },
        ],
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { checklistJson: true } });
    expect(JSON.parse(t!.checklistJson!)).toEqual([
      { label: "Çarşaf takımı × 2", done: true }, // label preserved, done applied
      { label: "Banyo havlusu × 4", done: false },
    ]);
  });

  it("blocks staff from adding/removing checklist items (403)", async () => {
    staffSession();
    const res = await PATCH(patchReq({ checklist: [{ label: "only one", done: true }] }), ctx());
    expect(res.status).toBe(403); // length differs → item add/remove is a manager action
  });

  it("lets an owner change a management field (title)", async () => {
    session = { userId: ownerId, organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
    const res = await PATCH(patchReq({ title: "Yeni başlık" }), ctx());
    expect(res.status).toBe(200);
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    expect(t?.title).toBe("Yeni başlık");
  });

  it("does NOT let an owner of another org edit this task (tenant isolation) — 404, unchanged", async () => {
    const other = await prisma.organization.create({ data: { name: "Other Org" } });
    session = { userId: "x", organizationId: other.id, role: "owner", email: "o2@x.com", name: "Owner2", sessionEpoch: 0 };
    const res = await PATCH(patchReq({ title: "sızıntı" }), ctx());
    expect(res.status).toBe(404);
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    expect(t?.title).toBe("Temizlik"); // unchanged
  });

  it("does NOT let an owner of another org delete this task (tenant isolation) — 404, still present", async () => {
    const other = await prisma.organization.create({ data: { name: "Other Org" } });
    session = { userId: "x", organizationId: other.id, role: "owner", email: "o2@x.com", name: "Owner2", sessionEpoch: 0 };
    const res = await DELETE(patchReq({}), ctx());
    expect(res.status).toBe(404);
    expect(await prisma.task.findUnique({ where: { id: taskId } })).not.toBeNull();
  });
});

describe("görev kartı — NOT kaydetmek FOTOĞRAFI gizlememeli", () => {
  // GERÇEK KULLANICIDA ÇIKTI: temizlik fotoğrafı yüklendi, kartta göründü;
  // ardından "yapıldı" notu kaydedilince fotoğraf ekrandan KAYBOLDU.
  //
  // Sebep: her not/foto/durum değişikliği AYRI bir TaskUpdate satırı açıyor
  // (route.ts taskUpdate.create). Kart ise yalnız EN SON satırı okuyordu
  // (`updates: { take: 1 }`) — o satırda not var, foto yok. Veri kaybı YOK:
  // foto hem bucket'ta hem önceki satırda duruyordu, sadece gösterilmiyordu.
  //
  // Kapsam itirafı: sayfa bir server component, doğrudan render edilmiyor.
  // Bu test kullanıcının GERÇEK sırasını üretir ve sayfanın artık kullandığı
  // sorguyu birebir koşar — hata veri katmanında yaşadığı için doğru katman.
  // Ayrıca ESKİ yaklaşımın bu senaryoda başarısız olduğunu da asserte eder,
  // yoksa test boşuna yeşil olabilirdi.
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const owner = await prisma.user.create({
      data: { organizationId: org.id, name: "Owner", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    ownerId = owner.id;
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
    const task = await prisma.task.create({
      data: { propertyId: property.id, type: "cleaning", title: "Temizlik", status: "todo", priority: "standard" },
    });
    taskId = task.id;
    session = { userId: ownerId, organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  });

  // Rota fotoğrafın BU org'a ve BU göreve ait bir anahtar taşımasını şart koşuyor
  // (route.ts isAcceptablePhotoUrl) — uydurma bir anahtar 400 döner. Gerçek
  // yardımcılarla kurup o kapıdan da geçtiğimizi doğruluyoruz.
  const photoFor = (name: string) => photoUrlForKey(`org/${orgId}/task/${taskId}/${name}`);

  it("önce foto, SONRA not: kart hâlâ fotoğrafı bulur", async () => {
    const PHOTO = photoFor("123-abc.jpg");
    expect((await PATCH(patchReq({ photoUrl: PHOTO }), ctx())).status).toBe(200);
    expect((await PATCH(patchReq({ note: "yapıldı" }), ctx())).status).toBe(200);

    // ESKİ davranış: en son satır → notu var, fotoğrafı YOK (hatanın kendisi).
    const newest = await prisma.taskUpdate.findMany({
      where: { taskId },
      select: { photoUrl: true, note: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(newest[0]?.note).toBe("yapıldı");
    expect(newest[0]?.photoUrl).toBeNull(); // ← kart burayı okuduğu için foto kayboluyordu

    // YENİ davranış (sayfanın kullandığı sorgu): fotoğrafı olan en son satır.
    const photoRows = await prisma.taskUpdate.findMany({
      where: { taskId: { in: [taskId] }, photoUrl: { not: null } },
      select: { taskId: true, photoUrl: true },
      orderBy: { createdAt: "desc" },
    });
    const latestPhotoByTask = new Map<string, string>();
    for (const row of photoRows) {
      if (row.photoUrl && !latestPhotoByTask.has(row.taskId)) latestPhotoByTask.set(row.taskId, row.photoUrl);
    }
    expect(latestPhotoByTask.get(taskId)).toBe(PHOTO);
  });

  it("İKİ fotoğraf yüklenirse EN YENİSİ gösterilir", async () => {
    const PHOTO = photoFor("123-abc.jpg");
    const older = photoFor("111-old.jpg");
    expect((await PATCH(patchReq({ photoUrl: older }), ctx())).status).toBe(200);
    expect((await PATCH(patchReq({ photoUrl: PHOTO }), ctx())).status).toBe(200);
    const photoRows = await prisma.taskUpdate.findMany({
      where: { taskId: { in: [taskId] }, photoUrl: { not: null } },
      select: { taskId: true, photoUrl: true },
      orderBy: { createdAt: "desc" },
    });
    expect(photoRows[0]?.photoUrl).toBe(PHOTO); // eskisi değil
  });
});

describe("REGRESYON PİNİ — kart fotoğrafı 'son güncelleme'ye geri bağlanmasın", () => {
  it("tasks/page.tsx fotoğrafı FOTOĞRAFLI son satırdan alır, son satırdan DEĞİL", async () => {
    // Yukarıdaki veri testi bu dosyanın kendisini korumuyor: sayfayı eski hâline
    // döndürdüğümde yine yeşil kalıyordu (ölçtüğü şey sorgu kuralı, sayfa değil).
    // Bu repoda aynı sorun için kullanılan desen kaynak taramasıdır (bkz.
    // canonical-origin ve deployment-timezone pinleri) — gelecekte biri
    // "sadeleştirme" niyetiyle `updates[0]`a dönerse test derhal kırmızıya döner.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/tasks/page.tsx", "utf8");
    expect(src, "fotoğraflı son satırı çeken sorgu kaybolmuş").toMatch(
      /photoUrl:\s*\{\s*not:\s*null\s*\}/,
    );
    expect(src, "latestPhotoUrl yeniden 'son güncelleme'ye bağlanmış").not.toMatch(
      /latestPhotoUrl:\s*latestUpdate/,
    );
  });
});
