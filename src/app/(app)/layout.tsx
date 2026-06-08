import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin";
import { AppShell } from "@/components/shell/app-shell";

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
      {children}
    </AppShell>
  );
}
