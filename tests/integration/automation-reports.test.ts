import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { applyReservationCreatedRules, applyInboundMessageRules } from "@/lib/automation";
import { getOpsStats, getMonthlyReport } from "@/lib/reports";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe("applyReservationCreatedRules", () => {
  it("creates a check-in prep and a checkout cleaning task", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "John Smith",
        arrivalDate: daysFromNow(2),
        departureDate: daysFromNow(5),
        status: "confirmed",
      },
    });

    await applyReservationCreatedRules(reservation.id);

    const tasks = await prisma.task.findMany({
      where: { reservationId: reservation.id },
      orderBy: { type: "asc" },
    });
    expect(tasks).toHaveLength(2);
    const byType = Object.fromEntries(tasks.map((t) => [t.type, t]));
    expect(byType.checkin_prep).toBeDefined();
    expect(byType.cleaning).toBeDefined();
    expect(byType.checkin_prep.dueAt?.getTime()).toBe(reservation.arrivalDate.getTime());
    expect(byType.cleaning.dueAt?.getTime()).toBe(reservation.departureDate.getTime());
    expect(tasks.every((t) => t.status === "todo")).toBe(true);
  });

  it("does nothing for a cancelled reservation", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Cancelled Guest",
        arrivalDate: daysFromNow(2),
        departureDate: daysFromNow(5),
        status: "cancelled",
      },
    });

    await applyReservationCreatedRules(reservation.id);

    expect(await prisma.task.count()).toBe(0);
  });
});

describe("applyInboundMessageRules", () => {
  async function makeConversation(status: string) {
    const { propertyId } = await makeOrgWithProperty();
    const conversation = await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Laura Bianchi", status, priority: "standard" },
    });
    return conversation;
  }

  it("escalates a complaint: marks the conversation as a problem and opens a maintenance task", async () => {
    const conversation = await makeConversation("new");

    const result = await applyInboundMessageRules(
      conversation.id,
      "Klima çalışmıyor ve oda çok kirli, rezalet!",
    );

    expect(result.isComplaint).toBe(true);
    const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(updated?.status).toBe("problem");
    expect(updated?.priority).toBe("urgent");

    const tasks = await prisma.task.findMany({ where: { type: "maintenance" } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].priority).toBe("urgent");
  });

  it("re-opens a closed conversation when a new non-complaint message arrives", async () => {
    const conversation = await makeConversation("closed");

    await applyInboundMessageRules(conversation.id, "Wifi şifresi nedir acaba?");

    const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(updated?.status).toBe("new");
    expect(await prisma.task.count()).toBe(0);
  });

  it("updates only the priority for a non-complaint on an active conversation", async () => {
    const conversation = await makeConversation("new");

    await applyInboundMessageRules(conversation.id, "Wifi şifresi nedir acaba?");

    const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(updated?.status).toBe("new"); // unchanged
    expect(updated?.priority).toBe("standard");
  });
});

describe("getOpsStats", () => {
  it("aggregates today's operational picture for the org", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();

    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Arriving Today",
        arrivalDate: new Date(),
        departureDate: daysFromNow(3),
        status: "confirmed",
      },
    });
    await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Open", status: "new", priority: "standard" },
    });
    await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Problem", status: "problem", priority: "urgent" },
    });
    await prisma.task.create({
      data: { propertyId, type: "maintenance", title: "Urgent", status: "todo", priority: "urgent" },
    });
    await prisma.task.create({
      data: { propertyId, type: "cleaning", title: "Done", status: "done", priority: "standard" },
    });

    const stats = await getOpsStats(orgId);

    expect(stats.arrivalsToday).toBe(1);
    expect(stats.departuresToday).toBe(0);
    expect(stats.openConversations).toBe(1);
    expect(stats.problemConversations).toBe(1);
    expect(stats.urgentTasks).toBe(1);
    expect(stats.openTasks).toBe(1);
    expect(stats.totalProperties).toBe(1);
    expect(stats.occupiedToday).toBe(1);
    expect(stats.occupancyRate).toBe(100);
  });

  it("scopes stats to the requesting organization only", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: {
        propertyId: b.propertyId,
        guestName: "Other Org",
        arrivalDate: new Date(),
        departureDate: daysFromNow(2),
        status: "confirmed",
      },
    });

    const stats = await getOpsStats(a.orgId);
    expect(stats.arrivalsToday).toBe(0);
    expect(stats.totalProperties).toBe(1);
  });
});

describe("getMonthlyReport", () => {
  it("sums revenue per currency and computes task completion rate", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();

    for (const [amount, currency] of [
      [420, "EUR"],
      [280, "EUR"],
      [6000, "TRY"],
    ] as const) {
      await prisma.reservation.create({
        data: {
          propertyId,
          guestName: "Guest",
          arrivalDate: new Date(),
          departureDate: daysFromNow(2),
          status: "confirmed",
          totalAmount: amount,
          currency,
        },
      });
    }

    await prisma.task.createMany({
      data: [
        { propertyId, type: "cleaning", title: "t1", status: "done", priority: "standard" },
        { propertyId, type: "cleaning", title: "t2", status: "done", priority: "standard" },
        { propertyId, type: "cleaning", title: "t3", status: "todo", priority: "standard" },
        { propertyId, type: "cleaning", title: "t4", status: "todo", priority: "standard" },
      ],
    });

    const conversation = await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "G", status: "new", priority: "standard" },
    });
    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, direction: "inbound", senderName: "G", body: "1" },
        { conversationId: conversation.id, direction: "outbound", senderName: "Host", body: "2" },
        { conversationId: conversation.id, direction: "inbound", senderName: "G", body: "3" },
      ],
    });

    const report = await getMonthlyReport(orgId);

    expect(report.reservationsCount).toBe(3);
    const eur = report.revenueByCurrency.find((r) => r.currency === "EUR");
    const tryRev = report.revenueByCurrency.find((r) => r.currency === "TRY");
    expect(eur?.total).toBe(700);
    expect(tryRev?.total).toBe(6000);
    expect(report.completedTasks).toBe(2);
    expect(report.totalTasks).toBe(4);
    expect(report.taskCompletionRate).toBe(50);
    expect(report.messagesCount).toBe(3);
  });
});
