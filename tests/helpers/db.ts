import { prisma } from "@/lib/db";

export { prisma };

/** Wipe every table in FK-safe order. Call in beforeEach for test isolation. */
export async function resetDb(): Promise<void> {
  await prisma.taskUpdate.deleteMany();
  await prisma.task.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.systemLock.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.knowledgeBaseItem.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.property.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}

/** Create an organization + one property and return both ids. */
export async function makeOrgWithProperty(overrides?: {
  checkInTime?: string;
  checkOutTime?: string;
}) {
  const org = await prisma.organization.create({
    data: { name: "Test Org" },
  });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "Test Property",
      checkInTime: overrides?.checkInTime ?? "15:00",
      checkOutTime: overrides?.checkOutTime ?? "11:00",
    },
  });
  return { orgId: org.id, propertyId: property.id };
}

const DAY = 24 * 60 * 60 * 1000;

/** A date offset from now by whole days (positive = future). */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}
