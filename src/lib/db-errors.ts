import { Prisma } from "@prisma/client";

/**
 * True ONLY for a P2002 unique-constraint violation on exactly the given
 * columns (Codex rule: a dedupe-hit catch must never swallow a DIFFERENT
 * unique violation). Prisma's meta.target is an array of column names on
 * PostgreSQL, but be tolerant of the string (index-name) form too.
 */
export function isUniqueViolation(err: unknown, columns: readonly string[]): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    const cols = target.map(String);
    return cols.length === columns.length && columns.every((c) => cols.includes(c));
  }
  if (typeof target === "string") return columns.every((c) => target.includes(c));
  return false;
}
