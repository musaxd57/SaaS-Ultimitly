import "server-only";

import { prisma } from "@/lib/db";

/**
 * Write an audit-log entry. FIRE-AND-FORGET and SWALLOWS errors: auditing must
 * never break or block the action it records. Use for sensitive/privileged
 * operations — above all operator impersonation (an operator entering a customer
 * org sees that customer's guest PII, so every enter/exit must leave a trace).
 *
 *   action  — dotted verb, e.g. "impersonate.enter", "customer.create"
 *   actorUserId — the REAL operator behind the action (not the impersonated user)
 */
export async function writeAudit(entry: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (err) {
    // Never let an audit write affect the real action — but do leave a breadcrumb
    // in the server logs (and Sentry, which captures console.error) so a silently
    // dropped audit trail is at least visible to operators.
    console.error("[audit] dropped entry", entry.action, err);
  }
}
