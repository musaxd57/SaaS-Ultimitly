import { Building2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/empty-state";
import { KbManager, type KbItem } from "@/components/knowledge/kb-manager";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const session = await requireAuth();
  const [properties, items] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { property: { organizationId: session.organizationId } },
      include: { property: { select: { name: true } } },
      orderBy: [{ propertyId: "asc" }, { category: "asc" }],
    }),
  ]);

  const kbItems: KbItem[] = items.map((i) => ({
    id: i.id,
    propertyId: i.propertyId,
    propertyName: i.property.name,
    category: i.category,
    title: i.title,
    content: i.content,
    language: i.language,
    isActive: i.isActive,
  }));

  return (
    <>
      <PageHeader
        title="Bilgi Tabanı"
        description="Buraya girdiğiniz mülke özel bilgiler, AI'ın misafir sorularına verdiği yanıtları ve otomatik karşılama/giriş/çıkış mesajlarını besler. Wi-Fi, giriş yöntemi, ev kuralları, çevre önerileri…"
      />

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Önce bir mülk ekleyin"
          description="Bilgi tabanı her mülke bağlıdır. En az bir mülk gerekli."
        >
          <LinkButton href="/properties/new" size="sm">
            Mülk ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <KbManager properties={properties} items={kbItems} />
      )}
    </>
  );
}
