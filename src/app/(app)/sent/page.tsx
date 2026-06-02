import { Send, Bot, Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { fromNow, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SentItem {
  id: string;
  kind: "reply" | "welcome";
  when: Date;
  guest: string;
  property: string;
  preview: string;
}

export default async function SentPage() {
  const session = await requireAuth();
  const orgId = session.organizationId;

  const [replies, welcomes] = await Promise.all([
    // AI auto-replies that were actually sent (stored as outbound GuestOps AI msgs).
    prisma.message.findMany({
      where: {
        direction: "outbound",
        senderName: "GuestOps AI",
        conversation: { property: { organizationId: orgId } },
      },
      include: {
        conversation: {
          select: { guestIdentifier: true, property: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    // Welcome messages (tracked on the reservation).
    prisma.reservation.findMany({
      where: { welcomeSentAt: { not: null }, property: { organizationId: orgId } },
      select: {
        id: true,
        guestName: true,
        welcomeSentAt: true,
        property: { select: { name: true } },
      },
      orderBy: { welcomeSentAt: "desc" },
      take: 100,
    }),
  ]);

  const items: SentItem[] = [
    ...replies.map((m) => ({
      id: `r-${m.id}`,
      kind: "reply" as const,
      when: m.createdAt,
      guest: m.conversation.guestIdentifier,
      property: m.conversation.property.name,
      preview: truncate(m.body, 120),
    })),
    ...welcomes.map((w) => ({
      id: `w-${w.id}`,
      kind: "welcome" as const,
      when: w.welcomeSentAt as Date,
      guest: w.guestName,
      property: w.property.name,
      preview: "Karşılama mesajı gönderildi.",
    })),
  ].sort((a, b) => b.when.getTime() - a.when.getTime());

  return (
    <>
      <PageHeader
        title="Gönderilenler"
        description="Sistemin otomatik gönderdiği mesajlar — oto-yanıtlar ve karşılama mesajları."
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Henüz otomatik mesaj gönderilmedi"
          description="Oto-yanıt veya otomatik karşılama açıldığında, gönderilen her mesaj burada listelenir."
        />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {it.kind === "welcome" ? (
                    <Sparkles className="size-4" />
                  ) : (
                    <Bot className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{it.guest}</span>
                    <Badge tone="muted">{it.property}</Badge>
                    <Badge tone={it.kind === "welcome" ? "success" : "secondary"}>
                      {it.kind === "welcome" ? "Karşılama" : "Oto-yanıt"}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{fromNow(it.when)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{it.preview}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
