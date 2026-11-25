import { describe, it, expect, beforeEach, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Plan madde 9 — SAYFA BAĞLANTISI ("yüklem var, argüman yok" sınıfı): /tasks sayfası son bakım işini gerçekten okuyup açık bakım kartına
// verir; personel görünümünde vermez. Tarihler bağıl. Tasarım: docs/TASARIM-2026-11-25-son-bakim-isi-notu.md
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAuth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
}));

import { requireAuth } from "@/lib/auth";
import TasksPage from "@/app/(app)/tasks/page";
import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";

const DAY = 86_400_000;

function findBoardTasks(node: ReactNode): TaskCardData[] | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findBoardTasks(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { tasks?: TaskCardData[]; children?: ReactNode };
  if (node.type === TaskBoard) return props.tasks ?? null;
  return findBoardTasks(props.children);
}

let orgId = "";
let ownerId = "";
let staffId = "";
let propertyId = "";

beforeEach(async () => {
  await resetDb();
  orgId = (await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } })).id;
  ownerId = (await prisma.user.create({ data: { organizationId: orgId, name: "Ahmet", email: "tlm-o@x.com", passwordHash: "x", role: "owner" } })).id;
  staffId = (await prisma.user.create({ data: { organizationId: orgId, name: "Zeynep", email: "tlm-s@x.com", passwordHash: "x", role: "staff" } })).id;
  propertyId = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale" } })).id;
  const done = await prisma.task.create({ data: { propertyId, type: "maintenance", title: "Bakım: kombi", status: "done", origin: "manual" } });
  await prisma.taskUpdate.create({ data: { taskId: done.id, userId: ownerId, status: "done", note: "reset yapıldı", createdAt: new Date(Date.now() - 2 * DAY) } });
  // Aynı dairede yeni açık bakım işi (personele atanmış) + açık temizlik.
  await prisma.task.create({ data: { propertyId, type: "maintenance", title: "Bakım: kombi yine", status: "todo", origin: "manual", assignedToId: staffId } });
  await prisma.task.create({ data: { propertyId, type: "cleaning", title: "Temizlik", status: "todo", origin: "manual", assignedToId: staffId } });
});

async function board(role: "owner" | "staff") {
  const userId = role === "owner" ? ownerId : staffId;
  vi.mocked(requireAuth).mockResolvedValue({ userId, organizationId: orgId, role, email: "x@x.com", name: "X", sessionEpoch: 0 } as never);
  const tree = await TasksPage({ searchParams: Promise.resolve({}) });
  const tasks = findBoardTasks(tree);
  expect(tasks).not.toBeNull();
  return tasks!;
}

describe("/tasks — son bakım işi satırı", () => {
  it("🚨 yönetici: açık bakım kartı satırı taşır; temizlik ve bitmiş bakım kartı taşımaz", async () => {
    const tasks = await board("owner");
    const open = tasks.find((t) => t.title === "Bakım: kombi yine")!;
    expect(open.lastMaintenance).toMatch(/^Bu dairede son bakım işi: .+ — 'reset yapıldı' \(Ahmet\)$/);
    expect(tasks.find((t) => t.type === "cleaning")!.lastMaintenance).toBeNull();
    expect(tasks.find((t) => t.status === "done")!.lastMaintenance).toBeNull();
  });

  it("🚨 KONTROL — personel kendi bakım kartında satırı GÖRMEZ", async () => {
    const tasks = await board("staff");
    const open = tasks.find((t) => t.type === "maintenance")!;
    expect(open).toBeTruthy();
    expect(open.lastMaintenance ?? null).toBeNull();
  });
});
