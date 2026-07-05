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
  // One read does double duty for every page under this layout:
  //  (a) the org name for the shell, and
  //  (b) the SESSION-EPOCH guard — a password change/reset bumps User.sessionEpoch,
  //      so a stolen page-side token whose epoch no longer matches dies right here.
  // Also the original stale-session guard: the cookie is valid but its user/org no
  // longer exists (DB reset / DATABASE_URL repointed). Either way, redirect to the
  // logout route — it clears the cookie and is EXCLUDED from the middleware matcher,
  // so it can't loop (redirecting to /login with a still-valid signature would).
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { sessionEpoch: true, organization: { select: { name: true } } },
  });
  if (!user || !user.organization || user.sessionEpoch !== session.sessionEpoch) {
    redirect("/api/auth/logout");
  }
  // Impersonation: also enforce the REAL operator's epoch, so a stolen
  // impersonation token dies when the operator resets their own password (mirrors
  // requireSession). Legacy tokens without the claim skip this (backward compat).
  if (session.actorUserId && session.actorSessionEpoch !== undefined) {
    const actor = await prisma.user.findUnique({
      where: { id: session.actorUserId },
      select: { sessionEpoch: true },
    });
    if (!actor || actor.sessionEpoch !== session.actorSessionEpoch) {
      redirect("/api/auth/logout");
    }
  }
  const org = user.organization;

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
