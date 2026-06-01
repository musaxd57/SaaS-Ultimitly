import { PrismaClient } from "@prisma/client";

// Prevent multiple Prisma instances during dev hot-reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  journalReset: boolean | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Ensure the database uses the standard rollback journal, NOT WAL. A previous
// build briefly switched the database to WAL mode, which this host's volume
// does not support reliably — reads and writes started failing. Switching back
// to DELETE here also performs a checkpoint, flushing any rows still sitting in
// the -wal sidecar file back into the main database (so no committed data is
// lost). Idempotent and a no-op once the database is already in DELETE mode.
if (!globalForPrisma.journalReset) {
  globalForPrisma.journalReset = true;
  void (async () => {
    try {
      await prisma.$executeRawUnsafe("PRAGMA journal_mode = DELETE;");
    } catch {
      // Not fatal — ignore on non-SQLite engines or if already set.
    }
  })();
}
