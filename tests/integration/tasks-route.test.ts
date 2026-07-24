import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

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
