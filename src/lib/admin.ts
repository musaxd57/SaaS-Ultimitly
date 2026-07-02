import "server-only";

import { prisma } from "@/lib/db";
import { setSessionCookie, clearSessionCookie, getSession, type SessionPayload } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { UserRole } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Operator panel (agency model): a SUPER-ADMIN operator manages many customer
// organizations from one login, and can "enter" (impersonate) a customer org to
// run its inbox / settings, then switch back.
//
// Super-admin is granted by env SUPERADMIN_EMAILS (comma-separated). Default is
// EMPTY → nobody is a super-admin and /admin is inaccessible (safe by default).
// ---------------------------------------------------------------------------

function superAdminEmails(): Set<string> {
  return new Set(
    (process.env.SUPERADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The REAL operator email behind a session: the impersonator when entering a
 * customer org, otherwise the session's own email. Super-admin status is always
 * judged on THIS, so an operator keeps their powers while impersonating.
 */
export function actorEmail(session: SessionPayload): string {
  return (session.actorEmail ?? session.email).toLowerCase();
}

/** True when the (real) operator behind this session is a configured super-admin. */
export function isSuperAdmin(session: SessionPayload | null): boolean {
  if (!session) return false;
  const emails = superAdminEmails();
  return emails.has(actorEmail(session));
}

/** True when the current session is an operator impersonating a customer org. */
export function isImpersonating(session: SessionPayload | null): boolean {
  return Boolean(session?.actorUserId);
}

/**
 * Enter (impersonate) a customer organization. SUPER-ADMIN ONLY — the caller
 * MUST have verified isSuperAdmin first. Assumes the org's owner user identity
 * while preserving the real operator in the actor fields (so we can switch back
 * and keep super-admin powers). Returns false if the org has no user to assume.
 */
export async function enterOrganization(
  current: SessionPayload,
  organizationId: string,
): Promise<boolean> {
  const target = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, email: true, name: true, sessionEpoch: true },
      },
    },
  });
  if (!target) return false;
  // Prefer an actual owner, then a manager, then the oldest user. A string sort
  // on "role" alone wrongly picks "manager" before "owner" (alphabetical), which
  // would give the operator reduced powers inside the tenant.
  const owner =
    target.users.find((u) => u.role === "owner") ??
    target.users.find((u) => u.role === "manager") ??
    target.users[0];
  if (!owner) return false;

  // Preserve the ORIGINAL operator when hopping customer→customer.
  const actorUserId = current.actorUserId ?? current.userId;
  const actorName = current.actorName ?? current.name;
  const actor = current.actorEmail ?? current.email;

  await setSessionCookie({
    userId: owner.id,
    organizationId: target.id,
    role: owner.role as UserRole,
    email: owner.email,
    name: owner.name,
    sessionEpoch: owner.sessionEpoch,
    actorUserId,
    actorEmail: actor,
    actorName,
  });
  // Leave a trace: an operator just gained access to this customer's guest PII.
  await writeAudit({
    organizationId: target.id,
    actorUserId,
    action: "impersonate.enter",
    metadata: { operatorEmail: actor, operatorName: actorName, assumedUserId: owner.id },
  });
  return true;
}

/**
 * Leave impersonation and restore the operator's own session. Safe to call
 * always; a no-op when not impersonating. Authenticated purely by the signed
 * actorUserId already in the session (no super-admin check needed to step DOWN).
 */
export async function exitImpersonation(): Promise<boolean> {
  const current = await getSession();
  if (!current?.actorUserId) return false;
  const actor = await prisma.user.findUnique({
    where: { id: current.actorUserId },
    select: { id: true, organizationId: true, role: true, email: true, name: true, sessionEpoch: true },
  });
  if (!actor) {
    // Fail-safe: the operator's own user record is gone, so we can't restore
    // their session — but we must NOT leave them trapped inside the customer org
    // (still seeing that customer's guest PII). Clear the session so they drop to
    // the login screen and can sign back in as themselves.
    await clearSessionCookie();
    return false;
  }
  await writeAudit({
    organizationId: current.organizationId,
    actorUserId: current.actorUserId,
    action: "impersonate.exit",
    metadata: { operatorEmail: current.actorEmail ?? actor.email, restoredToOrg: actor.organizationId },
  });
  await setSessionCookie({
    userId: actor.id,
    organizationId: actor.organizationId,
    role: actor.role as UserRole,
    email: actor.email,
    name: actor.name,
    sessionEpoch: actor.sessionEpoch,
  });
  return true;
}
