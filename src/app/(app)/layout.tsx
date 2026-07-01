import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin";
import { AppShell } from "@/components/shell/app-shell";
import { getEntitlement, billingEnforced } from "@/lib/billing/subscription";
import { TrialBanner } from "@/components/billing/trial-banner";
import { LimitedModeBanner } from "@/components/billing/limited-mode-banner";

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

  // Billing (Faz 2). DORMANT unless BILLING_ENFORCED=true. We do NOT hard-lock
  // the app: a lapsed org (trial ended / canceled) keeps full browsing + manual
  // work — only AUTOMATIC guest messaging is suppressed (enforced in the sync
  // pass + the AI routes). Here we just surface a nudge banner. Operators
  // (impersonating / super-admin) and grandfathered/active orgs stay active.
  const entitlement = await getEntitlement(session.organizationId);
  const isOperator = Boolean(session.actorUserId) || isSuperAdmin(session);
  const limited = billingEnforced() && !entitlement.active && !isOperator;

  return (
    <AppShell
      user={{
        name: session.name,
        email: session.email,
        role: session.role,
        orgName: org.name,
      }}
      superAdmin={isSuperAdmin(session)}
      guestChatEnabled={process.env.GUEST_CHAT_ENABLED === "1"}
      impersonating={
        session.actorUserId
          ? { actorName: session.actorName ?? session.actorEmail ?? "Operatör", orgName: org.name }
          : null
      }
    >
      {limited ? (
        <LimitedModeBanner />
      ) : entitlement.trialing && entitlement.trialDaysLeft != null ? (
        <TrialBanner daysLeft={entitlement.trialDaysLeft} />
      ) : null}
      {children}
    </AppShell>
  );
}
