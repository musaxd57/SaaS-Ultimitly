import Link from "next/link";
import { MessageSquare, Plus, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";
import { HospitableTestButton } from "@/components/inbox/hospitable-test-button";
import { HospitableSyncButton } from "@/components/inbox/hospitable-sync-button";
import { CONVERSATION_STATUS } from "@/lib/constants";
import { fromNow, truncate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireAuth();
  const { status } = await searchParams;

  const [conversations, org] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        property: { organizationId: session.organizationId },
        ...(status ? { status } : {}),
      },
      include: {
        property: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
    }),
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { autoReplyWhatsapp: true },
    }),
  ]);

  const filters = [{ value: "", label: "Tümü" }, ...CONVERSATION_STATUS.options];

  return (
    <>
      <PageHeader title="Mesajlar" description="Tüm misafir konuşmalarını tek kutudan yönetin.">
        <HospitableSyncButton />
        <HospitableTestButton />
        <AutoReplyToggle enabled={org?.autoReplyWhatsapp ?? false} />
        <LinkButton href="/inbox/new">
          <Plus className="size-4" /> Yeni konuşma
        </LinkButton>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value || "all"}
              href={f.value ? `/inbox?status=${f.value}` : "/inbox"}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Konuşma yok"
          description="Yeni bir konuşma başlatın veya misafir mesajı ekleyin."
        >
          <LinkButton href="/inbox/new" size="sm">
            <Plus className="size-4" /> Yeni konuşma
          </LinkButton>
        </EmptyState>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/inbox/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{c.guestIdentifier}</p>
                  {c.priority === "urgent" ? (
                    <AlertTriangle className="size-3.5 text-destructive" />
                  ) : null}
                  <span className="text-xs text-muted-foreground">· {c.property.name}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.messages[0] ? truncate(c.messages[0].body, 90) : "—"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={CONVERSATION_STATUS.tone(c.status)}>
                  {CONVERSATION_STATUS.label(c.status)}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{fromNow(c.lastMessageAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
