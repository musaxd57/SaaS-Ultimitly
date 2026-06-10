import Link from "next/link";
import { Send, Bot, Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { fromNow, truncate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SentKind = "reply" | "welcome" | "checkin" | "checkout";

interface SentItem {
  id: string;
  kind: SentKind;
  when: Date;
  guest: string;
  property: string;
  preview: string;
}

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const { type } = await searchParams;

  const [replies, welcomes, checkins, checkouts] = await Promise.all([
    // AI auto-replies that were actually sent (stored as outbound AI msgs).
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
    // Check-in info messages (tracked on the reservation).
    prisma.reservation.findMany({
      where: { checkinSentAt: { not: null }, property: { organizationId: orgId } },
      select: {
        id: true,
        guestName: true,
        checkinSentAt: true,
        property: { select: { name: true } },
      },
      orderBy: { checkinSentAt: "desc" },
      take: 100,
    }),
    // Check-out messages (tracked on the reservation).
    prisma.reservation.findMany({
      where: { checkoutSentAt: { not: null }, property: { organizationId: orgId } },
      select: {
        id: true,
        guestName: true,
        checkoutSentAt: true,
        property: { select: { name: true } },
      },
      orderBy: { checkoutSentAt: "desc" },
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
    ...checkins.map((c) => ({
      id: `ci-${c.id}`,
      kind: "checkin" as const,
      when: c.checkinSentAt as Date,
      guest: c.guestName,
      property: c.property.name,
      preview: "Giriş bilgileri mesajı gönderildi.",
    })),
    ...checkouts.map((c) => ({
      id: `c-${c.id}`,
      kind: "checkout" as const,
      when: c.checkoutSentAt as Date,
      guest: c.guestName,
      property: c.property.name,
      preview: "Çıkış mesajı gönderildi.",
    })),
  ].sort((a, b) => b.when.getTime() - a.when.getTime());

  // Filter pills (by kind) with live counts, mirroring the inbox status filter.
  const counts: Record<SentKind, number> = { reply: 0, welcome: 0, checkin: 0, checkout: 0 };
  for (const it of items) counts[it.kind]++;
  const filters: { value: string; label: string; count: number }[] = [
    { value: "", label: "Tümü", count: items.length },
    { value: "reply", label: "Oto-yanıtlar", count: counts.reply },
    { value: "welcome", label: "Karşılama", count: counts.welcome },
    { value: "checkin", label: "Giriş", count: counts.checkin },
    { value: "checkout", label: "Çıkış", count: counts.checkout },
  ];
  const activeType = type && type in counts ? type : "";
  const visibleItems = activeType ? items.filter((it) => it.kind === activeType) : items;

  return (
    <>
      <PageHeader
        title="Gönderilenler"
        description="Sistemin otomatik gönderdiği mesajlar — oto-yanıtlar, karşılama, giriş ve çıkış mesajları."
      />

      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const active = activeType === f.value;
            return (
              <Link
                key={f.value || "all"}
                href={f.value ? `/sent?type=${f.value}` : "/sent"}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {f.label} <span className="opacity-70">({f.count})</span>
              </Link>
            );
          })}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Henüz otomatik mesaj gönderilmedi"
          description="Oto-yanıt veya otomatik karşılama açıldığında, gönderilen her mesaj burada listelenir."
        />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Bu türde mesaj yok"
          description="Seçtiğiniz türde gönderilmiş mesaj bulunmuyor."
        />
      ) : (
        <div className="space-y-2">
          {visibleItems.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {it.kind === "reply" ? <Bot className="size-4" /> : <Sparkles className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{it.guest}</span>
                    <Badge tone="muted">{it.property}</Badge>
                    <Badge
                      tone={
                        it.kind === "welcome"
                          ? "success"
                          : it.kind === "checkin"
                            ? "default"
                            : it.kind === "checkout"
                              ? "muted"
                              : "secondary"
                      }
                    >
                      {it.kind === "welcome"
                        ? "Karşılama"
                        : it.kind === "checkin"
                          ? "Giriş"
                          : it.kind === "checkout"
                            ? "Çıkış"
                            : "Oto-yanıt"}
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
