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
        description="Misafir iletişimi için hazır mesaj şablonları. Özel şablonlar ekleyin veya varsayılanları kullanın."
      />

      <TemplateManager
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
