import { ArrowLeft, Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManage } from "@/lib/api";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/empty-state";
import { TaskForm } from "@/components/tasks/task-form";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const session = await requireAuth();
  // Manager-only surface: it server-renders EVERY property + user name for the
  // assign form. Task creation is manager-only at the API too; the middleware
  // also stops staff at exact-/tasks — this is the defense-in-depth page gate.
  if (!canManage(session)) redirect("/tasks");
  const [properties, members] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader title="Yeni Görev" description="Operasyon görevini oluşturun ve atayın.">
        <LinkButton href="/tasks" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Geri
        </LinkButton>
      </PageHeader>

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Önce bir mülk ekleyin"
          description="Görev oluşturmak için en az bir mülke ihtiyacınız var."
        >
          <LinkButton href="/properties/new" size="sm">
            Mülk ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <TaskForm properties={properties} members={members} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
