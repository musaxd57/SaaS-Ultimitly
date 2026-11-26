// ---------------------------------------------------------------------------
// "Son bakım işi" toplu okuması (plan madde 9). Kurallar ve biçim: `last-maintenance.ts` (saf). Sayfa kartları kurmadan önce bir kez çağırır.
// ---------------------------------------------------------------------------

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { oneLine, type LastMaintenance } from "./last-maintenance";

/** Her daire için en son kapanmış bakım işi (yoksa haritada yok). Yalnız `organizationId`'nin daireleri okunur. */
export async function lastClosedMaintenanceByProperty(organizationId: string, propertyIds: readonly string[]): Promise<Map<string, LastMaintenance>> {
  const ids = [...new Set(propertyIds)];
  const out = new Map<string, LastMaintenance>();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw<{ propertyId: string; closedAt: Date; note: string | null; by: string | null }[]>(Prisma.sql`
    SELECT DISTINCT ON (t."propertyId")
      t."propertyId" AS "propertyId",
      COALESCE(d."createdAt", t."updatedAt") AS "closedAt",
      COALESCE(
        NULLIF(BTRIM(d."note"), ''),
        (SELECT n."note" FROM "TaskUpdate" n
          WHERE n."taskId" = t."id" AND n."status" IS NULL AND n."note" IS NOT NULL AND BTRIM(n."note") <> ''
          ORDER BY n."createdAt" DESC, n."id" DESC LIMIT 1)
      ) AS "note",
      u."name" AS "by"
    FROM "Task" t
    JOIN "Property" p ON p."id" = t."propertyId"
    LEFT JOIN LATERAL (
      SELECT x."createdAt", x."note", x."userId" FROM "TaskUpdate" x
      WHERE x."taskId" = t."id" AND x."status" = 'done'
      ORDER BY x."createdAt" DESC, x."id" DESC LIMIT 1
    ) d ON TRUE
    LEFT JOIN "User" u ON u."id" = d."userId"
    WHERE p."organizationId" = ${organizationId}
      AND t."propertyId" = ANY(${ids}::text[])
      AND t."type" = 'maintenance'
      AND t."status" = 'done'
    ORDER BY t."propertyId", COALESCE(d."createdAt", t."updatedAt") DESC, t."id" DESC`);
  for (const r of rows) {
    const note = oneLine(r.note);
    out.set(r.propertyId, { closedAt: new Date(r.closedAt), note: note || null, by: r.by?.trim() || null });
  }
  return out;
}
