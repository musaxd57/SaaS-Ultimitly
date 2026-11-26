import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Task.origin (migration 17): manual | system | ai. The cancellation cleanup
// used to delete ANY not-done checkin_prep/cleaning task tied to a reservation —
// including the HOST'S OWN manually created one (user-data loss, Codex #18).
// It may now delete ONLY origin="system".

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";
import { POST as createTaskRoute } from "@/app/api/tasks/route";
import { NextRequest } from "next/server";

describe("Task.origin stamping + selective cancellation cleanup", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeReservation(status = "confirmed") {
    return prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ada Guest",
        arrivalDate: daysFromNow(2),
        departureDate: daysFromNow(4),
        channel: "airbnb",
        status,
      },
    });
  }

  it("lifecycle tasks are stamped origin=system", async () => {
    const r = await makeReservation();
    await createReservationTasks(r.id);
    const tasks = await prisma.task.findMany({ where: { reservationId: r.id } });
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    for (const t of tasks) expect(t.origin).toBe("system");
  });

  it("smart (message-driven) tasks are stamped origin=ai", async () => {
    const res = await createOperationalTaskFromMessage({
      propertyId,
      message: "Klima bozuldu, hiç soğutmuyor ve su damlatıyor!",
      sourceMessageId: "msg-1",
      reservationId: null,
    });
    expect(res.status).toBe("created");
    const t = await prisma.task.findFirstOrThrow({ where: { propertyId, sourceMessageId: "msg-1" } });
    expect(t.origin).toBe("ai");
  });

  it("manual route tasks are stamped origin=manual", async () => {
    const req = new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId, type: "cleaning", title: "Balkonu yıka", status: "todo", priority: "standard" }),
    });
    const res = await createTaskRoute(req, { params: Promise.resolve({} as Record<string, never>) });
    expect(res.status).toBe(201);
    const t = await prisma.task.findFirstOrThrow({ where: { propertyId, title: "Balkonu yıka" } });
    expect(t.origin).toBe("manual");
  });

  it("RED-FIRST: cancellation cleanup deletes ONLY system tasks — the host's manual task survives", async () => {
    const r = await makeReservation();
    await createReservationTasks(r.id); // system checkin_prep + cleaning
    // The host's OWN task, tied to the same reservation, same type: old code deleted it.
    const manual = await prisma.task.create({
      data: {
        propertyId,
        reservationId: r.id,
        type: "cleaning",
        origin: "manual",
        title: "Perdeleri yıkatmayı unutma",
        status: "todo",
        priority: "standard",
      },
    });
    // An ai task tied to the reservation must also survive.
    const ai = await prisma.task.create({
      data: {
        propertyId,
        reservationId: r.id,
        type: "cleaning",
        origin: "ai",
        title: "cleaning: misafir bildirdi",
        status: "todo",
        priority: "standard",
      },
    });

    await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
    const deleted = await removeAutoTasksForCancelledReservation(r.id);

    expect(deleted).toBe(2); // exactly the two system lifecycle tasks
    const remaining = await prisma.task.findMany({ where: { reservationId: r.id } });
    expect(remaining.map((t) => t.id).sort()).toEqual([manual.id, ai.id].sort());
  });
});
