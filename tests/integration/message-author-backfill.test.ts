import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// Run the ACTUAL migration-28 backfill SQL (not a copy) against populated fixtures,
// so the test can never drift from the migration file. Strip comment lines, split on
// ';', keep the UPDATE statements.
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/28_message_author_type/migration.sql"),
  "utf8",
);
const BACKFILL_UPDATES = MIGRATION_SQL.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.toUpperCase().startsWith("UPDATE"));

async function runBackfill() {
  for (const sql of BACKFILL_UPDATES) await prisma.$executeRawUnsafe(sql);
}

async function makeConvo(): Promise<string> {
  const { propertyId } = await makeOrgWithProperty();
  const c = await prisma.conversation.create({
    data: { propertyId, channel: "chat", guestIdentifier: "M", status: "answered" },
  });
  return c.id;
}

const authorOf = (id: string) =>
  prisma.message.findUniqueOrThrow({ where: { id }, select: { authorType: true, systemEventType: true } });

describe("migration 28 backfill — deterministic authorType from legacy signals", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("extracts exactly the 4 backfill UPDATEs from the migration file", () => {
    expect(BACKFILL_UPDATES).toHaveLength(4);
  });

  it("classifies every legacy row (authorType NULL) by direction + senderName; leaves 0 nulls", async () => {
    const conversationId = await makeConvo();
    // authorType OMITTED → NULL. This IS the old-deployment INSERT-compat case: the
    // nullable column accepts an insert that doesn't mention authorType.
    const mk = (direction: string, senderName: string) =>
      prisma.message.create({ data: { conversationId, direction, senderName, body: "x", language: "tr" } });

    const guest = await mk("inbound", "Ayşe");
    const aiGuestOps = await mk("outbound", "GuestOps AI");
    const aiLixus = await mk("outbound", "Lixus AI");
    const resume = await mk("outbound", "__lixus_ai_resumed__");
    const host = await mk("outbound", "Mehmet");
    // Trap: a host whose legacy name LOOKS like the AI classifier. Legacy rows only
    // have senderName to go on, so this backfills to 'ai' — the documented residual
    // (new rows dual-write authorType='host' explicitly, so this can't recur).
    const trap = await mk("outbound", "GuestOps AI");

    expect(await prisma.message.count({ where: { authorType: null } })).toBe(6);

    await runBackfill();

    expect(await authorOf(guest.id)).toMatchObject({ authorType: "guest" });
    expect(await authorOf(aiGuestOps.id)).toMatchObject({ authorType: "ai" });
    expect(await authorOf(aiLixus.id)).toMatchObject({ authorType: "ai" });
    expect(await authorOf(resume.id)).toMatchObject({ authorType: "system", systemEventType: "guest_chat_ai_resumed" });
    expect(await authorOf(host.id)).toMatchObject({ authorType: "host" });
    expect(await authorOf(trap.id)).toMatchObject({ authorType: "ai" }); // documented residual

    // RECONCILIATION: no classifiable message left without the new metadata.
    expect(await prisma.message.count({ where: { authorType: null } })).toBe(0);
  });

  it("is idempotent — re-running never overwrites a value new code already wrote", async () => {
    const conversationId = await makeConvo();
    // NEW code already classified this as host, despite a resume-looking name. The
    // senderName-based backfill must NOT rewrite it to 'system' on a re-run (healing
    // is guarded by authorType IS NULL).
    const kept = await prisma.message.create({
      data: { conversationId, direction: "outbound", authorType: "host", senderName: "__lixus_ai_resumed__", body: "x", language: "tr" },
    });
    await runBackfill();
    await runBackfill();
    expect((await authorOf(kept.id)).authorType).toBe("host");
  });
});
