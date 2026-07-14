import Link from "next/link";
import { Send, Bot, Sparkles, ListOrdered } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { canManage } from "@/lib/api";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
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

// The guest's first name, used to resolve {isim}/{ad}/{name} tokens in the
// preview exactly as the automation does when it actually sends the message.
function firstNameOf(guestName: string): string {
  return guestName.trim().split(/\s+/)[0] || guestName.trim();
}

// The guest-facing apartment number: the last number in the property name
// ("nuve 3" → "3"). Mirrors automation.ts so the {daire} token preview matches.
function apartmentNumberOf(propertyName: string): string {
  const nums = propertyName.match(/\d+/g);
  return nums ? nums[nums.length - 1] : propertyName;
}

// Resolve the host's template tokens to live values for a preview of the message
// content (same token rules as the automatic sender). It's the content basis of
// what was sent, trimmed for the list — not a byte-exact copy.
function fillTokens(text: string, firstName: string, propertyName: string): string {
  return text
    .replace(/\{\s*(isim|ad|name)\s*\}/gi, firstName)
    .replace(/\{\s*(daire|apartment|apt)\s*\}/gi, apartmentNumberOf(propertyName));
}

// Fallback line when an apartment has no saved template for this lifecycle kind
// (e.g. the entry was deleted after the message went out). Non-redundant with
// the row's badge: it tells the reader the content isn't recoverable, not just
// that "a message was sent".
const FALLBACK_PREVIEW: Record<Exclude<SentKind, "reply">, string> = {
  welcome: "Karşılama metni kayıtlı değil (mesaj gönderildi).",
  checkin: "Giriş bilgileri metni kayıtlı değil (mesaj gönderildi).",
  checkout: "Çıkış metni kayıtlı değil (mesaj gönderildi).",
};

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const { type } = await searchParams;

  const [replies, welcomes, checkins, checkouts, connection] = await Promise.all([
    // AI auto-replies that were actually sent (stored as outbound AI msgs).
    prisma.message.findMany({
      where: {
        direction: "outbound",
        // AI auto-sends DECIDED by authorType (senderName is display/audit only);
        // senderName is the transitional fallback for legacy NULL rows. Booking
        // channels only — the QR "chat" surface has its own tab (prior semantics).
        OR: [{ authorType: "ai" }, { authorType: null, senderName: "GuestOps AI" }],
        conversation: { property: { organizationId: orgId }, channel: { not: "chat" } },
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
        propertyId: true,
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
        propertyId: true,
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
        propertyId: true,
        guestName: true,
        checkoutSentAt: true,
        property: { select: { name: true } },
      },
      orderBy: { checkoutSentAt: "desc" },
      take: 100,
    }),
    getConnectionInfo(orgId),
  ]);

  // Lifecycle message bodies aren't persisted — only the sent-at flag is. To show
  // a real preview of WHAT was sent (not a generic restatement of the badge), look
  // up each property's Knowledge Base entry for the matching lifecycle category and
  // use a trimmed, token-resolved snippet. One grouped, org-scoped query for every
  // involved property/category — then mapped in memory (no N+1).
  const lifecyclePropertyIds = Array.from(
    new Set(
      [...welcomes, ...checkins, ...checkouts].map((r) => r.propertyId),
    ),
  );
  const kbItems = lifecyclePropertyIds.length
    ? await prisma.knowledgeBaseItem.findMany({
        where: {
          propertyId: { in: lifecyclePropertyIds },
          category: { in: ["welcome", "checkin", "checkout"] },
          isActive: true,
          property: { organizationId: orgId }, // tenant isolation
        },
        select: { propertyId: true, category: true, content: true },
        orderBy: { updatedAt: "desc" }, // newest active entry wins — same as the sender
      })
    : [];
  // Lookup keyed by `${propertyId}:${category}` → template content.
  const kbByKey = new Map<string, string>();
  for (const k of kbItems) {
    const key = `${k.propertyId}:${k.category}`;
    if (!kbByKey.has(key)) kbByKey.set(key, k.content); // newest active entry wins (sorted desc)
  }
  function lifecyclePreview(
    kind: Exclude<SentKind, "reply">,
    propertyId: string,
    propertyName: string,
    guestName: string,
  ): string {
    const content = kbByKey.get(`${propertyId}:${kind}`);
    if (!content) return FALLBACK_PREVIEW[kind];
    const resolved = fillTokens(content.trim(), firstNameOf(guestName), propertyName);
    return truncate(resolved.replace(/\s+/g, " "), 120);
  }

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
      preview: lifecyclePreview("welcome", w.propertyId, w.property.name, w.guestName),
    })),
    ...checkins.map((c) => ({
      id: `ci-${c.id}`,
      kind: "checkin" as const,
      when: c.checkinSentAt as Date,
      guest: c.guestName,
      property: c.property.name,
      preview: lifecyclePreview("checkin", c.propertyId, c.property.name, c.guestName),
    })),
    ...checkouts.map((c) => ({
      id: `c-${c.id}`,
      kind: "checkout" as const,
      when: c.checkoutSentAt as Date,
      guest: c.guestName,
      property: c.property.name,
      preview: lifecyclePreview("checkout", c.propertyId, c.property.name, c.guestName),
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
        title="Otomatik Gönderilenler"
        description="Sistemin sizin yerinize otomatik gönderdiği mesajlar — oto-yanıtlar, karşılama, giriş ve çıkış. Elle yazdığınız cevaplar burada görünmez (onlar konuşma ekranındadır)."
      >
        {/* Ops view of the durable outbox — owner/manager only (staff never sees it). */}
        {canManage(session) ? (
          <Link
            href="/sent/queue"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ListOrdered className="size-3.5" /> Gönderim kuyruğu durumu
          </Link>
        ) : null}
      </PageHeader>

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
          description={
            connection.connected
              ? "Oto-yanıt veya otomatik karşılama açıldığında, gönderilen her mesaj burada listelenir."
              : "Airbnb / Booking bağlantısını kurup oto-yanıt veya otomatik karşılamayı açtığınızda, gönderilen her mesaj burada listelenir."
          }
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
