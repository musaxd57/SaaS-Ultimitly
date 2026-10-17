import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// CODEX 09-30 (A4): YENİDEN ATAMA YARIŞI. Personel kapsamı istek başında okunan atamaya göreydi, yazma koşulsuzdu → okuma ile
// yazma arasında yönetici görevi BAŞKA personele atadıysa eski personelin "bitti"si / notu yeni atananın görevine yazılıyordu.
// Yarış, görevin okunmasının hemen ardından yeniden atamayı enjekte eden bir casusla deterministik kurulur (casus dosya
// başında BİR KEZ kurulur, geri alınmaz — Prisma temsilcisinde geri alma yöntemi siliyor; `armed` bayrağıyla açılır).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/tasks/[id]/route";

let orgId = "";
let taskId = "";
let staffA = "";
let staffB = "";

let armed = false;
const originalFindFirst = prisma.task.findFirst.bind(prisma.task);
vi.spyOn(prisma.task, "findFirst").mockImplementation((async (args: Parameters<typeof originalFindFirst>[0]) => {
  const row = await originalFindFirst(args);
  if (armed) {
    armed = false;
    await prisma.task.update({ where: { id: taskId }, data: { assignedToId: staffB } }); // yönetici bu sırada B'ye atadı
  }
  return row;
}) as never);

function patchReq(body: unknown) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = () => ({ params: Promise.resolve({ id: taskId }) });

describe("görev yeniden atama yarışı (Codex 09-30 A4)", () => {
  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    staffA = (await prisma.user.create({ data: { organizationId: org.id, name: "A", email: "a@x.com", passwordHash: "x", role: "staff" } })).id;
    staffB = (await prisma.user.create({ data: { organizationId: org.id, name: "B", email: "b@x.com", passwordHash: "x", role: "staff" } })).id;
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
    taskId = (
      await prisma.task.create({
        data: { propertyId: property.id, type: "cleaning", title: "Temizlik", status: "todo", priority: "standard", assignedToId: staffA },
      })
    ).id;
    session = { userId: staffA, organizationId: orgId, role: "staff", email: "a@x.com", name: "A", sessionEpoch: 0 };
  });
  afterEach(() => {
    armed = false;
  });

  it("🚨 okuma ile yazma arasında B'ye atanan görevi A 'bitti' YAPAMAZ; geçmişe A'nın kaydı yazılmaz", async () => {
    armed = true;
    const res = await PATCH(patchReq({ status: "done", note: "bitti" }), ctx());
    expect(res.status).toBe(403);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t.assignedToId).toBe(staffB);
    expect(t.status).toBe("todo");
    expect(await prisma.taskUpdate.count({ where: { taskId } })).toBe(0);
  });

  it("KONTROL — yarış yokken A kendi görevini günceller", async () => {
    const res = await PATCH(patchReq({ status: "done", note: "bitti" }), ctx());
    expect(res.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("done");
    expect(await prisma.taskUpdate.count({ where: { taskId, userId: staffA } })).toBe(1);
  });

  it("KONTROL — yönetici yarıştan etkilenmez (her görevi güncelleyebilir)", async () => {
    const owner = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    armed = true;
    const res = await PATCH(patchReq({ status: "done" }), ctx());
    expect(res.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("done");
  });
});
