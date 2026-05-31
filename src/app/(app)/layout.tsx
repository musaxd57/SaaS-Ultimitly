import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true },
  });

  return (
    <AppShell
      user={{
        name: session.name,
        email: session.email,
        role: session.role,
        orgName: org?.name ?? "İşletme",
      }}
    >
      {children}
    </AppShell>
  );
}
