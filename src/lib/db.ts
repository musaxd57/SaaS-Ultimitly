import { PrismaClient } from "@prisma/client";

// Prevent multiple Prisma instances during dev hot-reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  sqliteTuned: boolean | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Tune SQLite for concurrent access. WAL lets readers and a writer proceed at
// the same time (instead of blocking), and busy_timeout makes a contended
// write wait briefly rather than fail with "database is locked". Both are
// persistent/connection-level no-ops to re-run, so doing this once on startup
// is safe. Fire-and-forget: errors (e.g. non-SQLite engines) are ignored.
if (!globalForPrisma.sqliteTuned) {
  globalForPrisma.sqliteTuned = true;
  void (async () => {
    try {
      await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
      await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
    } catch {
      // Not fatal — the app works without the tuning.
    }
  })();
}

