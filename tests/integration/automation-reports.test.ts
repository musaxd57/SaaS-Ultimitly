import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  applyReservationCreatedRules,
  applyInboundMessageRules,
  backfillReservationTasks,
  createReservationTasks,
  removeAutoTasksForCancelledReservation,
  zonedDayRange,
} from "@/lib/automation";
import { getOpsStats, getMonthlyReport, getAiOpsReport } from "@/lib/reports";
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

describe("removeAutoTasksForCancelledReservation", () => {
  it("removes pending auto tasks but keeps manual and completed ones", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Soon Cancelled",
        arrivalDate: daysFromNow(2),
        departureDate: daysFromNow(5),
        status: "confirmed",
      },
    });
    // Auto check-in + cleaning tasks (both pending).
    await createReservationTasks(reservation.id);
    // A manual task on the same booking (host-created) and an already-done auto
    // task — both must survive the cancellation cleanup.
    await prisma.task.create({
      data: { propertyId, reservationId: reservation.id, type: "maintenance", title: "Musluk tamiri", dueAt: daysFromNow(3) },
    });
    await prisma.task.create({
      data: { propertyId, reservationId: reservation.id, type: "cleaning", title: "Erken temizlik", dueAt: daysFromNow(1), status: "done" },
    });
    expect(await prisma.task.count({ where: { reservationId: reservation.id } })).toBe(4);

    // Confirmed booking → no-op.
    expect(await removeAutoTasksForCancelledReservation(reservation.id)).toBe(0);
    expect(await prisma.task.count({ where: { reservationId: reservation.id } })).toBe(4);

    // Cancel, then clean up: only the 2 pending auto tasks go.
    await prisma.reservation.update({ where: { id: reservation.id }, data: { status: "cancelled" } });
    const removed = await removeAutoTasksForCancelledReservation(reservation.id);
    expect(removed).toBe(2);

    const left = await prisma.task.findMany({ where: { reservationId: reservation.id }, orderBy: { type: "asc" } });
    expect(left).toHaveLength(2);
    expect(left.map((t) => t.type).sort()).toEqual(["cleaning", "maintenance"]); // the done cleaning + the manual one
    expect(left.find((t) => t.type === "cleaning")?.status).toBe("done");
  });
});

describe("createReservationTasks supply checklist", () => {
  it("fills the cleaning task checklist from the property's supply profile", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await prisma.property.update({
      where: { id: propertyId },
      data: { supplyProfileJson: JSON.stringify({ carsaf_takimi: 2, banyo_havlusu: 4, cop_poseti: 2 }) },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ayşe",
        arrivalDate: daysFromNow(2),
        departureDate: daysFromNow(5),
        status: "confirmed",
      },
    });

    await createReservationTasks(reservation.id);

    const cleaning = await prisma.task.findFirst({ where: { reservationId: reservation.id, type: "cleaning" } });
    expect(cleaning?.checklistJson).toBeTruthy();
    const list = JSON.parse(cleaning!.checklistJson!) as { label: string; done: boolean }[];
    expect(list).toEqual([
      { label: "Çarşaf takımı × 2", done: false },
      { label: "Banyo havlusu × 4", done: false },
      { label: "Çöp poşeti × 2", done: false },
    ]);
    // The check-in prep task gets no supply checklist (kept simple).
    const prep = await prisma.task.findFirst({ where: { reservationId: reservation.id, type: "checkin_prep" } });
    expect(prep?.checklistJson).toBeNull();
  });

  it("leaves the checklist empty when the property has no supply profile", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Mehmet",
        arrivalDate: daysFromNow(2),
        departureDate: daysFromNow(4),
        status: "confirmed",
      },
    });
    await createReservationTasks(reservation.id);
    const cleaning = await prisma.task.findFirst({ where: { reservationId: reservation.id, type: "cleaning" } });
    expect(cleaning?.checklistJson).toBeNull();
  });
});

describe("backfillReservationTasks", () => {
  it("creates tasks for existing reservations and is idempotent", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Backfill A",
        arrivalDate: daysFromNow(3),
        departureDate: daysFromNow(6),
        status: "confirmed",
      },
    });
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Backfill B",
        arrivalDate: daysFromNow(10),
        departureDate: daysFromNow(12),
        status: "confirmed",
      },
    });

    // No tasks until backfill runs (reservations created directly).
    expect(await prisma.task.count()).toBe(0);

    const first = await backfillReservationTasks(orgId);
    expect(first.processed).toBe(2);
    expect(first.created).toBe(4); // 2 check-in prep + 2 cleaning
    expect(await prisma.task.count()).toBe(4);

    // Re-running must not duplicate tasks.
    const second = await backfillReservationTasks(orgId);
    expect(second.processed).toBe(2);
    expect(second.created).toBe(0);
    expect(await prisma.task.count()).toBe(4);
  });

  it("creates only a cleaning task for a stay that ends today but started in the past", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Checkout Today",
        arrivalDate: daysFromNow(-3),
        departureDate: daysFromNow(0), // departs today → still actionable
        status: "confirmed",
      },
    });

    const result = await backfillReservationTasks(orgId);
    expect(result.created).toBe(1);
    const tasks = await prisma.task.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe("cleaning");
  });

  it("backfills a MISSING cleaning task when only a check-in task exists (per-type)", async () => {
    // Regression: a reservation that earlier got only a check-in task used to be
    // blocked forever by the "has any task → bail" guard, so today's checkouts
    // never got their cleaning task. Per-type creation must fill just the gap.
    const { orgId, propertyId } = await makeOrgWithProperty();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Half Tasked",
        arrivalDate: daysFromNow(1),
        departureDate: daysFromNow(4),
        status: "confirmed",
      },
    });
    await prisma.task.create({
      data: {
        propertyId,
        reservationId: reservation.id,
        type: "checkin_prep",
        title: "existing check-in",
        description: "",
        dueAt: reservation.arrivalDate,
        status: "todo",
        priority: "standard",
      },
    });

    const result = await backfillReservationTasks(orgId);
    expect(result.created).toBe(1); // only the missing cleaning task

    const tasks = await prisma.task.findMany({ where: { reservationId: reservation.id } });
    expect(tasks).toHaveLength(2);
    expect(tasks.filter((t) => t.type === "checkin_prep")).toHaveLength(1); // not duplicated
    expect(tasks.filter((t) => t.type === "cleaning")).toHaveLength(1); // now present
  });

  it("creates the cleaning task for a checkout stored at Istanbul midnight of today", async () => {
    // The exact field failure: departureDate at Istanbul midnight (e.g. 21:00Z the
    // previous UTC day) is BEFORE UTC midnight, so the old date-fns startOfDay (UTC)
    // gate treated today's checkout as past → "Eksik görevleri oluştur" created 0.
    // The Istanbul-zoned gate must include it.
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { start: istanbulToday } = zonedDayRange(new Date(), "Europe/Istanbul");
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Istanbul Midnight Checkout",
        arrivalDate: daysFromNow(-2),
        departureDate: istanbulToday,
        status: "confirmed",
      },
    });

    const result = await backfillReservationTasks(orgId);
    expect(result.created).toBe(1);
    const tasks = await prisma.task.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe("cleaning");
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

  it("excludes a cancelled reservation from arrivals and occupancy", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // A booking that would arrive + occupy today, but it's cancelled → must not
    // count anywhere (the guarantee behind the dashboard going quiet on a cancel).
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Cancelled Today",
        arrivalDate: new Date(),
        departureDate: daysFromNow(3),
        status: "cancelled",
      },
    });

    const stats = await getOpsStats(orgId);
    expect(stats.arrivalsToday).toBe(0);
    expect(stats.occupiedToday).toBe(0);
    expect(stats.occupancyRate).toBe(0);
  });

  it("counts a turnover day once — occupancy never exceeds 100%", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Same flat: one guest checks OUT today, another checks IN today.
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Leaving",
        arrivalDate: daysFromNow(-3),
        departureDate: new Date(),
        status: "confirmed",
      },
    });
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Arriving",
        arrivalDate: new Date(),
        departureDate: daysFromNow(3),
        status: "confirmed",
      },
    });

    const stats = await getOpsStats(orgId);

    expect(stats.totalProperties).toBe(1);
    expect(stats.occupiedToday).toBe(1); // distinct flat, not 2 reservations
    expect(stats.occupancyRate).toBe(100); // never 200
    expect(stats.stayingTonight).toBe(1); // the arriving guest is in the house tonight
  });

  it("staying-tonight is night-strict: a checkout-today flat with no re-let is NOT counted", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Guest checks OUT today, nobody re-lets → the flat is empty tonight.
    await prisma.reservation.create({
      data: { propertyId, guestName: "Leaving Today", arrivalDate: daysFromNow(-3), departureDate: new Date(), status: "confirmed" },
    });
    const stats = await getOpsStats(orgId);
    expect(stats.occupiedToday).toBe(1); // occupancy: the flat WAS used today (overlap) → stays correct
    expect(stats.stayingTonight).toBe(0); // ...but nobody is in the house tonight
  });

  it("staying-tonight counts a mid-stay guest", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: { propertyId, guestName: "Mid Stay", arrivalDate: daysFromNow(-2), departureDate: daysFromNow(2), status: "confirmed" },
    });
    const stats = await getOpsStats(orgId);
    expect(stats.occupiedToday).toBe(1);
    expect(stats.stayingTonight).toBe(1);
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

describe("getMonthlyReport — Istanbul month window", () => {
  it("buckets by the ISTANBUL calendar month: pre-month-start excluded, month-start included", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Reconstruct the exact window the report uses (Istanbul fixed UTC+3).
    const ym = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }).slice(0, 7);
    const [y, m] = ym.split("-").map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1) - 3 * 60 * 60 * 1000);

    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Önceki ay",
        arrivalDate: new Date(monthStart.getTime() - 1000), // 1s BEFORE the Istanbul month
        departureDate: new Date(monthStart.getTime() + 86_400_000),
        status: "confirmed",
        totalAmount: 111,
        currency: "TRY",
      },
    });
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ay başı",
        arrivalDate: monthStart, // exactly the first Istanbul instant of the month
        departureDate: new Date(monthStart.getTime() + 2 * 86_400_000),
        status: "confirmed",
        totalAmount: 222,
        currency: "TRY",
      },
    });

    const report = await getMonthlyReport(orgId);
    expect(report.reservationsCount).toBe(1); // only the in-month one
    expect(report.revenueByCurrency.find((r) => r.currency === "TRY")?.total).toBe(222);
  });
});

describe("getAiOpsReport — AI credit DECIDED by authorType (senderName is display only)", () => {
  const conv = (propertyId: string, channel = "airbnb") =>
    prisma.conversation.create({
      data: { propertyId, channel, guestIdentifier: "G", status: "answered", priority: "standard" },
    });

  it("counts AI-authored + host-approved; excludes an AI-NAMED host row and the QR surface", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await conv(propertyId);
    const mk = (authorType: string | null, senderName: string, aiAssisted = false) =>
      prisma.message.create({ data: { conversationId: c.id, direction: "outbound", body: "x", authorType, senderName, aiAssisted } });

    await mk("ai", "GuestOps AI"); //              new AI send      → COUNT
    await mk(null, "GuestOps AI"); //              legacy NULL AI   → COUNT (fallback)
    await mk("host", "GuestOps AI"); //            host w/ AI name  → NOT (authorType decides)
    await mk("host", "Ayşe", true); //             host-approved AI → COUNT
    await mk("host", "Mehmet"); //                 plain host reply → NOT

    // QR AI lives on the "chat" surface with its own metrics → NOT counted here.
    const qr = await conv(propertyId, "chat");
    await prisma.message.create({
      data: { conversationId: qr.id, direction: "outbound", authorType: "ai", senderName: "Lixus AI", body: "x" },
    });

    expect((await getAiOpsReport(orgId)).aiReplies).toBe(3);
  });

  it("parity: a legacy-only fixture (every authorType NULL) counts exactly as before", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await conv(propertyId);
    await prisma.message.createMany({
      data: [
        { conversationId: c.id, direction: "outbound", senderName: "GuestOps AI", body: "1" },
        { conversationId: c.id, direction: "outbound", senderName: "GuestOps AI", body: "2" },
        { conversationId: c.id, direction: "inbound", senderName: "G", body: "3" }, //        guest → not AI
        { conversationId: c.id, direction: "outbound", senderName: "Host Adı", body: "4" }, // host  → not AI
      ],
    });
    expect((await getAiOpsReport(orgId)).aiReplies).toBe(2); // unchanged: exactly the two legacy AI sends
  });
});
