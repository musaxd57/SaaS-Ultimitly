import { ArrowLeft, Building2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/empty-state";
import { ConversationForm } from "@/components/inbox/conversation-form";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewConversationPage() {
  const session = await requireAuth();
  const [properties, reservations] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.reservation.findMany({
      where: { property: { organizationId: session.organizationId } },
      select: { id: true, propertyId: true, guestName: true, arrivalDate: true },
      orderBy: { arrivalDate: "desc" },
      take: 100,
    }),
  ]);

  const reservationOptions = reservations.map((r) => ({
    id: r.id,
    propertyId: r.propertyId,
    label: `${r.guestName} · ${formatDate(r.arrivalDate)}`,
  }));

  return (
    <>
      <PageHeader title="Yeni Konuşma" description="Bir misafir konuşması başlatın.">
        <LinkButton href="/inbox" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Geri
        </LinkButton>
      </PageHeader>

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Önce bir mülk ekleyin"
          description="Konuşma başlatmak için en az bir mülke ihtiyacınız var."
        >
          <LinkButton href="/properties/new" size="sm">
            Mülk ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <ConversationForm properties={properties} reservations={reservationOptions} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
