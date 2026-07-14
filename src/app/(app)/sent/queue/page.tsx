import Link from "next/link";
import { redirect } from "next/navigation";
import { ListOrdered, ArrowLeft, ExternalLink } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { canManage } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { OutboxRetryButton } from "@/components/outbox/retry-button";
import { listOutboxDeliveries } from "@/lib/outbox/ops";
import { OUTBOX_STATUSES, type OutboxStatus } from "@/lib/outbox/state";
import { fromNow, cn } from "@/lib/utils";
import type { BadgeTone } from "@/lib/constants";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Gönderim Kuyruğu — the durable outbox OPS view (#8 görünürlük). Owner/manager
// only (staff is already bounced to /tasks by the middleware; the extra check
// below is belt-and-braces). PII-free by construction: the lib never selects
// the message body or any guest field — this screen shows delivery STATE, the
// thread link opens content behind its own auth. Read-only except the ONE
// narrow action: a tenant-bound retry on definitively-failed rows.
// ---------------------------------------------------------------------------

const STATUS_META: Record<OutboxStatus, { label: string; tone: BadgeTone; note?: string }> = {
  pending: { label: "Sırada", tone: "warning" },
  sending: { label: "Gönderiliyor", tone: "default" },
  sent: { label: "İletildi", tone: "success" },
  ambiguous: {
    label: "Doğrulanamadı",
    tone: "warning",
    note: "Sağlayıcıdan doğrulanamadı — misafire ulaşmış olabilir; kopya riski nedeniyle otomatik yeniden gönderilmez.",
  },
  reconciling: { label: "Doğrulanıyor", tone: "warning" },
  review: {
    label: "İnceleme bekliyor",
    tone: "warning",
    note: "Sağlayıcıdan doğrulanamadı — misafire ulaşmış olabilir; konuşmayı kontrol etmeden yeniden göndermeyin.",
  },
  failed: { label: "Gönderilemedi", tone: "destructive" },
  canceled: { label: "İptal edildi", tone: "muted" },
  blocked: {
    label: "Abonelik pasif",
    tone: "warning",
    note: "Hospitable aboneliği pasif — bağlantı yeniden kurulunca otomatik olarak bir kez denenecek.",
  },
};

const TYPE_LABELS: Record<string, string> = {
  manual: "Manuel yanıt",
  ai: "Oto-yanıt",
  holding_ack: "Bekletme yanıtı",
  welcome: "Karşılama",
  checkin: "Giriş",
  checkout: "Çıkış",
};

function hrefFor(status: string | null, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/sent/queue?${qs}` : "/sent/queue";
}

export default async function OutboxQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireAuth();
  if (!canManage(session)) redirect("/tasks"); // staff: same boundary as the middleware

  const sp = await searchParams;
  const activeStatus = sp.status && (OUTBOX_STATUSES as readonly string[]).includes(sp.status) ? sp.status : null;
  const pageParam = Number.parseInt(sp.page ?? "1", 10);

  const list = await listOutboxDeliveries(session.organizationId, {
    status: activeStatus,
    page: Number.isFinite(pageParam) ? pageParam : 1,
  });

  const totalAll = OUTBOX_STATUSES.reduce((sum, s) => sum + list.counts[s], 0);
  const pills: { value: string | null; label: string; count: number }[] = [
    { value: null, label: "Tümü", count: totalAll },
    ...OUTBOX_STATUSES.filter((s) => list.counts[s] > 0 || s === activeStatus).map((s) => ({
      value: s as string,
      label: STATUS_META[s].label,
      count: list.counts[s],
    })),
  ];

  const from = list.total === 0 ? 0 : (list.page - 1) * list.take + 1;
  const to = Math.min(list.total, list.page * list.take);
  const hasPrev = list.page > 1;
  const hasNext = to < list.total;

  return (
    <>
      <PageHeader
        title="Gönderim Kuyruğu"
        description="Kalıcı gönderim kuyruğunun (outbox) durum görünümü. Mesaj içerikleri ve misafir bilgileri bu ekranda gösterilmez; içerik için konuşma ekranını açın."
      >
        <Link
          href="/sent"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Gönderilenler
        </Link>
      </PageHeader>

      {totalAll > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pills.map((f) => {
            const active = activeStatus === f.value;
            return (
              <Link
                key={f.value ?? "all"}
                href={hrefFor(f.value, 1)}
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

      {totalAll === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="Kuyrukta kayıt yok"
          description="Kalıcı gönderim kuyruğu kullanılmaya başlandığında her gönderim denemesi burada durumuyla listelenir. Kuyruk kapalıyken geçmiş kayıtlar yine görüntülenebilir."
        />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="Bu durumda kayıt yok"
          description="Seçtiğiniz durumda gönderim kaydı bulunmuyor."
        />
      ) : (
        <div className="space-y-2">
          {list.rows.map((row) => {
            const meta = STATUS_META[row.status as OutboxStatus] ?? {
              label: row.status,
              tone: "muted" as BadgeTone,
            };
            return (
              <Card key={row.id}>
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <Badge tone="secondary">{TYPE_LABELS[row.messageType ?? ""] ?? "Yanıt"}</Badge>
                      <Badge tone="muted">{row.channel}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {row.attemptCount > 0 ? `${row.attemptCount} deneme` : "henüz denenmedi"}
                        {row.lastErrorCode ? ` · son hata: ${row.lastErrorCode}` : ""}
                      </span>
                    </div>
                    {meta.note ? <p className="text-xs text-muted-foreground">{meta.note}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      Oluşturuldu {fromNow(row.createdAt)}
                      {row.sentAt ? ` · iletildi ${fromNow(row.sentAt)}` : ""}
                    </p>
                    {row.conversationId ? (
                      <Link
                        href={`/inbox/${row.conversationId}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Konuşmayı aç <ExternalLink className="size-3" />
                      </Link>
                    ) : null}
                  </div>
                  {row.retryable ? <OutboxRetryButton outboxId={row.id} /> : null}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
            <span>
              {from}–{to} / {list.total}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link href={hrefFor(activeStatus, list.page - 1)} className="rounded-md border border-border px-3 py-1 hover:bg-accent">
                  Önceki
                </Link>
              ) : null}
              {hasNext ? (
                <Link href={hrefFor(activeStatus, list.page + 1)} className="rounded-md border border-border px-3 py-1 hover:bg-accent">
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
