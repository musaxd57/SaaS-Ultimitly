import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// STAFF page-leak contract (Codex finding): the /tasks page must not server-
// render business internals to staff — no org-wide property list, no org-wide
// backfill count, no "new task" management UI; /tasks/new (which renders EVERY
// property + user name) must redirect staff away entirely.

let session: SessionPayload;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, requireAuth: vi.fn(async () => session) };
});

import TasksPage from "@/app/(app)/tasks/page";
import NewTaskPage from "@/app/(app)/tasks/new/page";

/** Flatten a React element tree to a string of its props (names leak via props). */
function treeText(node: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(node, (_k, v) => {
      if (typeof v === "function") return undefined;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined; // circular (module refs in element type)
        seen.add(v);
      }
      return v;
    }) ?? ""
  );
}

describe("staff page-leak contract", () => {
  let orgId: string;
  let staffId: string;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const mine = await prisma.property.create({ data: { organizationId: orgId, name: "Benim Daire" } });
    await prisma.property.create({ data: { organizationId: orgId, name: "Gizli Villa" } });
    const staff = await prisma.user.create({
      data: { organizationId: orgId, name: "Temizlikçi", email: "s@x.com", passwordHash: "x", role: "staff" },
    });
    staffId = staff.id;
    await prisma.user.create({
      data: { organizationId: orgId, name: "Patron Owner", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    await prisma.task.create({
      data: { propertyId: mine.id, type: "cleaning", title: "Çıkış temizliği", status: "todo", priority: "standard", assignedToId: staffId },
    });
    // An unassigned-to-staff reservation missing its cleaning task → would drive
    // the org-wide backfill count if the page computed it for staff.
    await prisma.reservation.create({
      data: {
        propertyId: mine.id,
        guestName: "G",
        arrivalDate: new Date(),
        departureDate: new Date(Date.now() + 3 * 86_400_000),
        status: "confirmed",
      },
    });
    session = { userId: staffId, organizationId: orgId, role: "staff", email: "s@x.com", name: "Temizlikçi", sessionEpoch: 0 };
  });

  it("staff /tasks: only assigned-task properties render — no org-wide names, no manager UI", async () => {
    const el = await TasksPage({ searchParams: Promise.resolve({}) });
    const text = treeText(el);
    expect(text).toContain("Benim Daire"); // their own task's property
    expect(text).not.toContain("Gizli Villa"); // unassigned property never renders
    expect(text).not.toContain("/tasks/new"); // no management CTA for staff
  });

  it("staff /tasks/new: redirected away (page renders every property+user name)", async () => {
    await expect(NewTaskPage()).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("manager /tasks keeps the full portfolio + management UI (no regression)", async () => {
    session = { ...session, role: "owner", name: "Patron Owner" };
    const el = await TasksPage({ searchParams: Promise.resolve({}) });
    const text = treeText(el);
    expect(text).toContain("Gizli Villa");
    expect(text).toContain("/tasks/new");
  });
});
