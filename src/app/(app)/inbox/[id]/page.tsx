import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, BookOpen, Clock, ArrowLeftRight, CheckSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { canManage } from "@/lib/api";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import {
  ConversationThread,
  type ThreadMessage,
} from "@/components/inbox/conversation-thread";
import { DeleteConversationButton } from "@/components/inbox/delete-conversation-button";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { KB_CATEGORY, RESERVATION_STATUS, TASK_STATUS, TASK_TYPE } from "@/lib/constants";
import { formatDate, formatDateTime, formatCurrency, daysUntilDate } from "@/lib/utils";
import { channelLabel } from "@/lib/ui-labels";
import { getReturningGuestInfo } from "@/lib/returning-guest";
import { getAdjacency } from "@/lib/turnover";

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

  // Returning-guest context — matched only by the reliable Hospitable guest id
  // (never name/email), so there are no false "welcome back" positives.
  const returning = conversation.reservation
    ? await getReturningGuestInfo(session.organizationId, {
        id: conversation.reservation.id,
        guestExternalId: conversation.reservation.guestExternalId,
      })
    : null;

  const [kb, adjacency, tasks] = await Promise.all([
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId: conversation.propertyId, isActive: true },
      orderBy: { category: "asc" },
    }),
    // Same adjacency data the AI prompt uses for early-checkin/late-checkout
    // reasoning — surfaced here so the host sees the turnover context too,
    // not just the model. Read-only; confirmed/completed bookings only.
    conversation.reservation
      ? getAdjacency(
          conversation.propertyId,
          conversation.reservation.arrivalDate,
          conversation.reservation.departureDate,
        )
      : null,
    conversation.reservation
      ? prisma.task.findMany({
          where: { reservationId: conversation.reservation.id },
          orderBy: [{ status: "asc" }, { dueAt: "asc" }],
          select: { id: true, type: true, title: true, status: true, dueAt: true },
        })
      : [],
  ]);

  // Turnover day = the adjacent booking's checkout/checkin falls on the SAME
  // Istanbul calendar day as this stay's arrival/departure (daysUntilDate diffs
  // any two dates, not just "today" — reused rather than a new same-day helper).
  const turnoverIn =
    adjacency?.previousDeparture && conversation.reservation
      ? daysUntilDate(adjacency.previousDeparture, conversation.reservation.arrivalDate) === 0
      : false;
  const turnoverOut =
    adjacency?.nextArrival && conversation.reservation
      ? daysUntilDate(adjacency.nextArrival, conversation.reservation.departureDate) === 0
      : false;

  const messages: ThreadMessage[] = conversation.messages.map((m) => ({
    id: m.id,
    direction: m.direction as "inbound" | "outbound",
    senderName: m.senderName,
    body: m.body,
    createdAtLabel: formatDateTime(m.createdAt),
  }));

  // Values for substituting {{placeholders}} in message templates.
  const wifiItem = kb.find((k) => k.category === "wifi");
  const templateVars: Record<string, string> = {
    guestName: conversation.reservation?.guestName ?? conversation.guestIdentifier,
    propertyName: conversation.property.name,
    checkInTime: conversation.property.checkInTime,
    checkOutTime: conversation.property.checkOutTime,
    wifiInfo: wifiItem ? wifiItem.content : "",
  };

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title={conversation.guestIdentifier}
        description={`${conversation.property.name} · ${channelLabel(conversation.channel)}`}
      >
        <LinkButton href="/inbox" variant="outline" size="sm">
          <ArrowLeft className="size-4" /> Mesajlar
        </LinkButton>
        <DeleteConversationButton conversationId={conversation.id} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ConversationThread
            conversationId={conversation.id}
            messages={messages}
            status={conversation.status}
            priority={conversation.priority}
            propertyId={conversation.propertyId}
            templateVars={templateVars}
            canReply={canManage(session)}
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
              {/* Property name already shown in the page header above — avoid
                  repeating it here, just the details the header doesn't have. */}
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
                  {returning ? (
                    <div className="mt-2 space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2">
                      <Badge tone="warning">🔁 {returning.stayCount}. konaklama</Badge>
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {returning.pastStays.slice(0, 5).map((s) => (
                          <li key={s.id}>
                            {s.propertyName} · {formatDate(s.arrivalDate)}–{formatDate(s.departureDate)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {turnoverIn || turnoverOut ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning-foreground">
                      <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {turnoverIn
                          ? `Giriş günü aynı günde önceki misafir saat ${conversation.property.checkOutTime}'te çıkıyor — devir günü.`
                          : `Çıkış günü aynı günde yeni misafir saat ${conversation.property.checkInTime}'te giriyor — devir günü.`}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">Bağlı rezervasyon yok.</p>
              )}
            </CardContent>
          </Card>

          {conversation.reservation ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckSquare className="size-4 text-muted-foreground" /> Görevler
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Bu konaklama için görev yok.</p>
                ) : (
                  tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{t.title}</p>
                        <Badge tone={TASK_TYPE.tone(t.type)}>{TASK_TYPE.label(t.type)}</Badge>
                      </div>
                      <Badge tone={TASK_STATUS.tone(t.status)}>{TASK_STATUS.label(t.status)}</Badge>
                    </div>
                  ))
                )}
                <LinkButton
                  href={`/tasks?propertyId=${conversation.propertyId}`}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Tüm görevleri gör
                </LinkButton>
              </CardContent>
            </Card>
          ) : null}

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
