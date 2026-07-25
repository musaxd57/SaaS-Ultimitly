import Link from "next/link";
import { MessageSquare, Plus, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";
import { AutoReplyTestButton } from "@/components/inbox/auto-reply-test-button";
import { HospitableSyncButton } from "@/components/inbox/hospitable-sync-button";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { CONVERSATION_STATUS } from "@/lib/constants";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { premiumAllowed } from "@/lib/billing/subscription";
import { fromNow, truncate, cn } from "@/lib/utils";
import { clampPage, MAX_LIST_PAGE } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/** Sayfa başına konuşma. Ekran eskiden org'un TÜM konuşmalarını çekiyordu —
 *  müşteri büyüdükçe SSR, hydration ve DOM maliyeti sınırsız artıyordu. */
const PAGE_SIZE = 50;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sayfa?: string }>;
}) {
  const session = await requireAuth();
  const sp = await searchParams;
  // Next 15 hands a repeated query param (?status=a&status=b) as string[] at
  // runtime despite the string typing — take the first so a bare array never
  // reaches Prisma (would throw on a scalar field) or .trim() (would crash).
  const status = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";

  const page = clampPage(Array.isArray(sp.sayfa) ? sp.sayfa[0] : sp.sayfa, MAX_LIST_PAGE);
  // Sayım ve listeleme AYNI koşulu paylaşır — ayrışırsa sayaç yalan söyler.
  const where = {
    property: { organizationId: session.organizationId },
    channel: { not: "chat" }, // QR guest chats live in their own "Misafir Sohbetleri" tab
    ...(status ? { status } : {}),
    ...(query ? { guestIdentifier: { contains: query, mode: "insensitive" as const } } : {}),
  };

  const [total, conversations, org, connection] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      include: {
        property: { select: { name: true } },
        messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
      },
      // TAM SIRA: eşit lastMessageAt'te sayfa sınırı kaymasın (tekrar/kayıp).
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        autoReplyHospitable: true,
        autoReplyStartHour: true,
        autoReplyEndHour: true,
      },
    }),
    getConnectionInfo(session.organizationId),
  ]);

  // Free/expired tier: automation is suppressed server-side — render the
  // controls inert so they don't misleadingly read "Açık".
  const automationLocked = !(await premiumAllowed(session.organizationId));

  const filters = [{ value: "", label: "Tümü" }, ...CONVERSATION_STATUS.options];

  /** Filtre + aramayı koruyan bağlantı. Durum/arama değişince sayfa 1'e döner:
   *  7. sayfadayken filtre değiştirip boş ekran görmek "kayıt yok" sanılır. */
  function hrefFor(next: { status?: string; sayfa?: number }): string {
    const st = next.status === undefined ? (status ?? "") : next.status;
    const pg = next.status !== undefined ? 1 : (next.sayfa ?? page);
    const q = new URLSearchParams();
    if (st) q.set("status", st);
    if (query) q.set("q", query);
    if (pg > 1) q.set("sayfa", String(pg));
    const qs = q.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  const from = conversations.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = conversations.length === 0 ? 0 : (page - 1) * PAGE_SIZE + conversations.length;

  const pad = (h: number) => String(h).padStart(2, "0");
  const activeWindow = `${pad(org?.autoReplyStartHour ?? 0)}:00–${pad(org?.autoReplyEndHour ?? 9)}:00`;

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Mesajlar" description="Tüm misafir konuşmalarını tek kutudan yönetin.">
        <HospitableSyncButton />
        <AutoReplyTestButton locked={automationLocked} />
        <AutoReplyToggle
          field="autoReplyHospitable"
          label={`Oto-yanıt (${activeWindow})`}
          enabled={org?.autoReplyHospitable ?? false}
          locked={automationLocked}
          title={`Açıkken: ${activeWindow} arası, AI'ın %75+ emin olduğu BASİT sorulara (çöp günü, Wi-Fi, çevre önerisi gibi) otomatik cevap verir. Şikayet, iade, riskli ve belirsiz mesajlar HER ZAMAN size kalır. "Mesajları çek" sırasında çalışır.`}
        />
        <LinkButton href="/inbox/new">
          <Plus className="size-4" /> Yeni konuşma
        </LinkButton>
      </PageHeader>

      {/* Filters + search share ONE row (two stacked full-width rows wasted a
          vertical band before the list). Wraps naturally on narrow screens. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const active = (status ?? "") === f.value;
            return (
              <Link
                key={f.value || "all"}
                href={hrefFor({ status: f.value })}
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
        <form method="GET" className="flex flex-wrap items-center gap-2">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input
          name="q"
          defaultValue={query}
          placeholder="Misafir adına göre ara…"
          className="w-full max-w-xs rounded-lg border border-border bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button type="submit" className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent">
          Ara
        </button>
        {query ? (
          <Link
            href={status ? `/inbox?status=${status}` : "/inbox"}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Aramayı temizle
          </Link>
        ) : null}
        </form>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={connection.connected ? "Konuşma yok" : "Henüz misafir mesajı yok"}
          description={
            connection.connected
              ? "Misafir mesajları geldikçe burada listelenir. Dilerseniz elle de konuşma başlatabilirsiniz."
              : "Airbnb / Booking bağlantısını kurunca misafir mesajları otomatik buraya akar. Dilerseniz şimdi elle konuşma başlatabilirsiniz."
          }
        >
          <LinkButton href="/inbox/new" size="sm">
            <Plus className="size-4" /> Yeni konuşma
          </LinkButton>
        </EmptyState>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {conversations.map((c) => {
            // Highlight threads still needing attention (guest waiting / escalated).
            const unread = c.status === "new" || c.status === "waiting" || c.status === "problem";
            return (
            <Link
              key={c.id}
              href={`/inbox/${c.id}`}
              className={cn(
                "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40",
                unread && "border-l-2 border-l-primary bg-accent/20",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
                    {c.guestIdentifier}
                  </p>
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
            );
          })}

          <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
            <span>
              {from}–{to} / {total}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={hrefFor({ sayfa: page - 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Önceki
                </Link>
              ) : null}
              {to < total ? (
                <Link
                  href={hrefFor({ sayfa: page + 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Sonraki
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
