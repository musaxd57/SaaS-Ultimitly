import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// SQLite health & repair (admin aid)
//
// A read query (e.g. organization.findMany) can fail with "Foreign key
// constraint violated" when the database file contains orphaned rows — a child
// row whose parent no longer exists. SQLite reports such pending violations on
// the next statement that touches the connection, which is why the error
// surfaces on an innocent SELECT.
//
//   GET  /api/admin/db-health        → report orphans (PRAGMA foreign_key_check)
//   POST /api/admin/db-health?fix=1  → delete the orphaned rows, then re-check
//
// Only the PII-free structure is returned (table names + rowids), never guest
// data. Requires a logged-in session.
// ---------------------------------------------------------------------------

interface FkViolation {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

async function findOrphans(): Promise<FkViolation[]> {
  // PRAGMA foreign_key_check returns one row per violating child row.
  const rows = await prisma.$queryRawUnsafe<
    Array<{ table: string; rowid: bigint | number; parent: string; fkid: bigint | number }>
  >("PRAGMA foreign_key_check;");
  return rows.map((r) => ({
    table: r.table,
    rowid: Number(r.rowid),
    parent: r.parent,
    fkid: Number(r.fkid),
  }));
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const orphans = await findOrphans();
    const integrity = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>(
      "PRAGMA integrity_check;",
    );
    return NextResponse.json({
      ok: true,
      orphanCount: orphans.length,
      orphans,
      integrity: integrity.map((r) => r.integrity_check),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const fix = new URL(req.url).searchParams.get("fix");
  if (fix !== "1") {
    return NextResponse.json({
      ok: false,
      error: "Add ?fix=1 to delete orphaned rows.",
    });
  }

  try {
    const before = await findOrphans();
    let deleted = 0;

    // Delete each orphaned child row by its rowid. Table names come from SQLite
    // itself (PRAGMA output), not user input, so interpolation is safe here.
    for (const o of before) {
      const n = await prisma.$executeRawUnsafe(
        `DELETE FROM "${o.table}" WHERE rowid = ${o.rowid};`,
      );
      deleted += n;
    }

    const after = await findOrphans();
    return NextResponse.json({
      ok: true,
      deleted,
      remainingOrphans: after.length,
      cleaned: before.map((o) => ({ table: o.table, parent: o.parent })),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
