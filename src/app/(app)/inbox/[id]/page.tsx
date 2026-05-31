import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, BookOpen, Clock } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import {
  ConversationThread,
  type ThreadMessage,
} from "@/components/inbox/conversation-thread";
import { KB_CATEGORY, RESERVATION_STATUS } from "@/lib/constants";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    include: {
      property: true,
      reservation: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) notFound();

  const kb = await prisma.knowledgeBaseItem.findMany({
    where: { propertyId: conversation.propertyId, isActive: true },
    orderBy: { category: "asc" },
  });

  const messages: ThreadMessage[] = conversation.messages.map((m) => ({
    id: m.id,
    direction: m.direction as "inbound" | "outbound",
    senderName: m.senderName,
    body: m.body,
    createdAtLabel: formatDateTime(m.createdAt),
  }));

  return (
    <>
      <PageHeader
        title={conversation.guestIdentifier}
        description={`${conversation.property.name} · ${conversation.channel}`}
      >
        <LinkButton href="/inbox" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Mesajlar
        </LinkButton>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ConversationThread
            conversationId={conversation.id}
            messages={messages}
            status={conversation.status}
            priority={conversation.priority}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4 text-muted-foreground" /> Mülk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{conversation.property.name}</p>
              {conversation.property.address ? (
                <p className="text-muted-foreground">
                  {[conversation.property.address, conversation.property.city]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
              <p className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5" />
                {conversation.property.checkInTime} → {conversation.property.checkOutTime}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4 text-muted-foreground" /> Rezervasyon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {conversation.reservation ? (
                <>
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{conversation.reservation.guestName}</p>
                    <Badge tone={RESERVATION_STATUS.tone(conversation.reservation.status)}>
                      {RESERVATION_STATUS.label(conversation.reservation.status)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {formatDate(conversation.reservation.arrivalDate)} –{" "}
                    {formatDate(conversation.reservation.departureDate)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatCurrency(
                      conversation.reservation.totalAmount,
                      conversation.reservation.currency,
                    )}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Bağlı rezervasyon yok.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4 text-muted-foreground" /> Bilgi Tabanı
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {kb.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bu mülk için bilgi yok.</p>
              ) : (
                kb.map((k) => (
                  <div key={k.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{k.title}</span>
                    <Badge tone={KB_CATEGORY.tone(k.category)}>{KB_CATEGORY.label(k.category)}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
