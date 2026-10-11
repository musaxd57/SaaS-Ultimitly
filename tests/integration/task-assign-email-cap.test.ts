import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GÖREV ATAMA E-POSTASI TAVANI (kurucu kararı 10-11, karar listesi 29a: "görev başı saatte 3"). Yönetici aynı görevi döngüyle yeniden
// atarsa personelin e-posta kutusu dolmasın: aynı görev için saatte en çok 3 atama e-postası gider. ATAMA her seferinde yapılır —
// yalnız fazladan e-posta gitmez. Tavan görev başına (başka görevin kovası ayrı). Gerçek PostgreSQL (sayaç veritabanında).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({ emailService: { sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { emailService } from "@/lib/email";
import { __resetRateLimit } from "@/lib/rate-limit";
import { PATCH } from "@/app/api/tasks/[id]/route";

const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: "o@x.com", passwordHash: "x", role: "owner" } });
  const a = await prisma.user.create({ data: { organizationId: org.id, name: "Ayşe", email: "a@x.com", passwordHash: "x", role: "staff" } });
  const b = await prisma.user.create({ data: { organizationId: org.id, name: "Bora", email: "b@x.com", passwordHash: "x", role: "staff" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const task = await prisma.task.create({ data: { propertyId: property.id, title: "Temizlik", type: "cleaning" } });
  const other = await prisma.task.create({ data: { propertyId: property.id, title: "Havlu", type: "laundry" } });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: owner.name, sessionEpoch: 0 };
  return { a, b, task, other };
}

describe("görev atama e-postası tavanı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
  });

  it("🚨 aynı görev döngüyle 5 kez yeniden atanır: ATAMA her seferinde yapılır, e-posta en çok 3", async () => {
    const { a, b, task } = await seed();
    const order = [a, b, a, b, a];
    for (const u of order) expect((await patch(task.id, { assignedToId: u.id })).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(a.id);
    await vi.waitFor(() => expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(3);
  });

  it("🚨 kendine atama (kurucu kararı 10-11): e-posta GİTMEZ ve tavandan SAYMAZ — aynı saatteki 3 başka atama e-postasını alır", async () => {
    const { a, b, task } = await seed();
    const self = { id: session.userId };
    for (const u of [self, a, self, b, a]) expect((await patch(task.id, { assignedToId: u.id })).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(a.id);
    await vi.waitFor(() => expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(emailService.sendReporting).mock.calls.map((c) => c[0])).toEqual(["a@x.com", "b@x.com", "a@x.com"]);
  });

  it("KONTROL: yönetici görevi BAŞKA bir yöneticiye atarsa e-posta gider (yalnız kendine atama atlanır)", async () => {
    const { task } = await seed();
    const m = await prisma.user.create({
      data: { organizationId: session.organizationId, name: "Yönetici", email: "m@x.com", passwordHash: "x", role: "manager" },
    });
    expect((await patch(task.id, { assignedToId: m.id })).status).toBe(200);
    await vi.waitFor(() => expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(emailService.sendReporting).mock.calls[0]?.[0]).toBe("m@x.com");
  });

  it("KONTROL: tavan görev başına — başka görevin ataması e-postasını alır", async () => {
    const { a, b, task, other } = await seed();
    for (const u of [a, b, a, b]) await patch(task.id, { assignedToId: u.id });
    await patch(other.id, { assignedToId: a.id });
    await vi.waitFor(() => expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(4));
    expect(vi.mocked(emailService.sendReporting).mock.calls.at(-1)?.[1]).toBe("Yeni Görev: Havlu");
  });
});
