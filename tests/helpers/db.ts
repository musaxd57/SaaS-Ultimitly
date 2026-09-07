import { prisma } from "@/lib/db";

export { prisma };

/** Wipe every table in FK-safe order. Call in beforeEach for test isolation. */
export async function resetDb(): Promise<void> {
  await prisma.taskUpdate.deleteMany();
  await prisma.task.deleteMany();
  await prisma.supplyRequest.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.systemLock.deleteMany();
  await prisma.riskEvent.deleteMany();
  await prisma.shadowVerdict.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.knowledgeBaseItem.deleteMany();
  await prisma.chatUsage.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.checkoutConsent.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.lead.deleteMany(); // no FK relation → must be cleared explicitly
  await prisma.storageDeletion.deleteMany(); // no org FK (survives cascade) → clear explicitly
  await prisma.rateLimitCounter.deleteMany(); // no FK; DB-backed limits must not leak across tests
  await prisma.property.deleteMany();
  await prisma.emailOutbox.deleteMany(); // FK → User; clear before users
  await prisma.user.deleteMany();
  await prisma.channelConnection.deleteMany(); // FK → Organization (cascade would cover it; explicit for clarity)
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

// ---------------------------------------------------------------------------
// Migration 45's identity unique, and the narrow escape hatch for the tooling
// that exists BECAUSE it did not used to be there.
//
// The dedupe planner/apply and the duplicate-cleanup path can only be tested by
// SEEDING the very duplicates the constraint forbids. Those files therefore drop
// the index for their own duration and put it back afterwards. Safe because
// vitest runs test FILES sequentially (fileParallelism: false in
// vitest.config.ts) — no other file is touching this database meanwhile.
//
// The restore wipes the database FIRST. These files seed duplicates in every
// case and `resetDb` runs per-test in beforeEach, so the last case's fixtures
// are still present when afterAll fires — rebuilding a unique index over them
// would fail on data the file is entitled to have created. Wiping first makes
// the CREATE a real assertion about the SCHEMA rather than a complaint about
// leftover fixtures.
// ---------------------------------------------------------------------------

/** Prisma's generated name for `@@unique([propertyId, externalReservationId])`. */
export const CONVERSATION_IDENTITY_INDEX = "Conversation_propertyId_externalReservationId_key";

export async function dropConversationIdentityUnique(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${CONVERSATION_IDENTITY_INDEX}"`);
}

export async function restoreConversationIdentityUnique(): Promise<void> {
  await resetDb();
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${CONVERSATION_IDENTITY_INDEX}"`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "${CONVERSATION_IDENTITY_INDEX}" ON "Conversation"("propertyId", "externalReservationId")`,
  );
}
