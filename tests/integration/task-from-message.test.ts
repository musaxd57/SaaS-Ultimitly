import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";

describe("createOperationalTaskFromMessage", () => {
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    ({ propertyId } = await makeOrgWithProperty());
  });

  it("creates a maintenance task from a fault message with source + dedupe key", async () => {
    const r = await createOperationalTaskFromMessage({
      propertyId,
      message: "Klima çalışmıyor, oda çok sıcak",
      sourceMessageId: "msg-1",
      ai: { intent: "amenity" },
    });
    expect(r.status).toBe("created");
    const task = await prisma.task.findFirst({ where: { propertyId } });
    expect(task?.type).toBe("maintenance");
    expect(task?.status).toBe("todo");
    expect(task?.sourceMessageId).toBe("msg-1");
    expect(task?.dedupeKey).toContain(`${propertyId}:maintenance:`);
    expect(task?.dueAt).toBeTruthy();
  });

  it("dedupes a second same-day message about the same category to ONE task", async () => {
    const now = new Date("2026-07-10T09:00:00.000Z");
    const first = await createOperationalTaskFromMessage({
      propertyId, message: "musluk akıtıyor", now,
    });
    const second = await createOperationalTaskFromMessage({
      propertyId, message: "musluk hâlâ akıtıyor, acele edin", now,
    });
    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("does not dedupe across DIFFERENT categories on the same day", async () => {
    const now = new Date("2026-07-10T09:00:00.000Z");
    await createOperationalTaskFromMessage({ propertyId, message: "musluk akıtıyor", now });
    await createOperationalTaskFromMessage({ propertyId, message: "havlu eksik", now });
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
  });

  it("does not dedupe two DISTINCT same-category problems on the same day", async () => {
    // Both are maintenance, but a leaking faucet and a broken A/C are different
    // issues — the topic-keyed dedupe must let the host action both.
    const now = new Date("2026-07-10T09:00:00.000Z");
    await createOperationalTaskFromMessage({ propertyId, message: "musluk akıtıyor", now });
    await createOperationalTaskFromMessage({ propertyId, message: "klima bozuk", now });
    expect(await prisma.task.count({ where: { propertyId, type: "maintenance" } })).toBe(2);
  });

  it("re-opens a task the next day once the previous one is done", async () => {
    const day1 = new Date("2026-07-10T09:00:00.000Z");
    const day2 = new Date("2026-07-11T09:00:00.000Z");
    const first = await createOperationalTaskFromMessage({ propertyId, message: "musluk akıtıyor", now: day1 });
    // The open task blocks a same-day repeat...
    expect((await createOperationalTaskFromMessage({ propertyId, message: "musluk akıtıyor", now: day1 })).status).toBe("duplicate");
    // ...but a different day is a different dedupe key.
    expect((await createOperationalTaskFromMessage({ propertyId, message: "musluk akıtıyor", now: day2 })).status).toBe("created");
    if (first.status === "created") {
      await prisma.task.update({ where: { id: first.taskId }, data: { status: "done" } });
    }
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
  });

  it("returns 'none' (no task) for a non-operational message", async () => {
    const r = await createOperationalTaskFromMessage({
      propertyId,
      message: "Paramı iade edin",
      ai: { riskType: "money_refund" },
    });
    expect(r.status).toBe("none");
    expect(await prisma.task.count({ where: { propertyId } })).toBe(0);
  });
});
