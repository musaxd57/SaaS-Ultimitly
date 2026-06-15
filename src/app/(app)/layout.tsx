import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin";
import { AppShell } from "@/components/shell/app-shell";
import { getEntitlement, billingEnforced } from "@/lib/billing/subscription";
import { BillingLockedScreen } from "@/components/billing/billing-locked-screen";
import { TrialBanner } from "@/components/billing/trial-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true },
  });

  // Stale session guard: the cookie is valid but its organization no longer
  // exists in the current database (e.g. the DB was reset or DATABASE_URL was
  // pointed at a fresh file). Writing anything under this org would fail with a
  // foreign-key error, so clear the session and send the user to log in /
  // register against the current database instead.
  if (!org) {
    redirect("/api/auth/logout");
  }

  // Billing gate (Faz 2). DORMANT unless BILLING_ENFORCED=true. When enforced, an
  // org whose reverse-trial ended / subscription lapsed sees the paywall instead
  // of the app. Operators (impersonating or super-admin) always pass through so
  // support is never blocked.
  const entitlement = await getEntitlement(session.organizationId);
  const isOperator = Boolean(session.actorUserId) || isSuperAdmin(session);
  if (billingEnforced() && !entitlement.active && !isOperator) {
    return (
      <BillingLockedScreen
        entitlement={entitlement}
        email={session.email}
        organizationId={session.organizationId}
      />
    );
  }

  return (
    <AppShell
      user={{
        name: session.name,
        email: session.email,
        role: session.role,
        orgName: org.name,
      }}
      superAdmin={isSuperAdmin(session)}
      impersonating={
        session.actorUserId
          ? { actorName: session.actorName ?? session.actorEmail ?? "Operatör", orgName: org.name }
          : null
      }
    >
      {entitlement.trialing && entitlement.trialDaysLeft != null ? (
        <TrialBanner daysLeft={entitlement.trialDaysLeft} />
      ) : null}
      {children}
    </AppShell>
  );
}
