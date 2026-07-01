import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { DEFAULT_TEMPLATES } from "@/lib/templates";
import { TemplateManager } from "@/components/templates/template-manager";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await requireAuth();

  const [properties, customTemplates] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { organizationId: session.organizationId },
      include: { property: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Şablonlar"
        description="Elle eklediğiniz hazır mesaj şablonları — bir konuşma ekranındaki “Şablonlar” düğmesiyle mesaja eklenir. (AI'ın misafir sorularını otomatik yanıtlarken kullandığı bilgiler için Bilgi Tabanı bölümünü kullanın.)"
      />

      <TemplateManager
        canManage={session.role === "owner" || session.role === "manager"}
        properties={properties}
        customTemplates={customTemplates.map((t) => ({
          id: t.id,
          title: t.title,
          body: t.body,
          category: t.category,
          language: t.language,
          isActive: t.isActive,
          propertyName: t.property?.name ?? null,
          propertyId: t.propertyId ?? null,
        }))}
        defaultTemplates={DEFAULT_TEMPLATES}
      />
    </>
  );
}
