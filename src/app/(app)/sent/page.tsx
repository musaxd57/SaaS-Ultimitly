import Link from "next/link";
import { Send, ListOrdered } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { orgTimezone } from "@/lib/timezone";
import { canManage } from "@/lib/api";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { fromNow, truncate, cn } from "@/lib/utils";
import {
  SENT_PAGE_SIZE,
  MAX_MERGED_PAGE,
  MAX_TYPED_PAGE,
  mergeSentPage,
  clampPage,
} from "@/lib/sent-history";

export const dynamic = "force-dynamic";

type SentKind = "reply" | "welcome" | "checkin" | "checkout";
type LifecycleKind = Exclude<SentKind, "reply">;

interface SentItem {
  id: string;
  kind: SentKind;
  when: Date;
  guest: string;
  property: string;
  preview: string;
  /** true → önizleme BUGÜNKÜ şablondan üretildi, gönderilen metnin kopyası DEĞİL. */
  templatePreview: boolean;
  /** HAM veritabanı id'si — sıralamanın ikincil anahtarı. Ekrandaki önekli `id`
   *  DEĞİL: global sıra, her kaynağın SQL sırasıyla (`… DESC, "id" DESC`) birebir
   *  örtüşmek ZORUNDA (bkz. sent-history.ts). */
  sortKey: string;
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
// content (same token rules as the automatic sender).
function fillTokens(text: string, firstName: string, propertyName: string): string {
  return text
    .replace(/\{\s*(isim|ad|name)\s*\}/gi, firstName)
    .replace(/\{\s*(daire|apartment|apt)\s*\}/gi, apartmentNumberOf(propertyName));
}

// Fallback line when an apartment has no saved template for this lifecycle kind
// (e.g. the entry was deleted after the message went out). Non-redundant with
// the row's badge: it tells the reader the content isn't recoverable, not just
// that "a message was sent".
const FALLBACK_PREVIEW: Record<LifecycleKind, string> = {
  welcome: "Karşılama metni kayıtlı değil (mesaj gönderildi).",
  checkin: "Giriş bilgileri metni kayıtlı değil (mesaj gönderildi).",
  checkout: "Çıkış metni kayıtlı değil (mesaj gönderildi).",
};

const KIND_LABEL: Record<SentKind, string> = {
  reply: "Oto-yanıt",
  welcome: "Karşılama",
  checkin: "Giriş",
  checkout: "Çıkış",
};

const SENT_AT_COLUMN: Record<LifecycleKind, "welcomeSentAt" | "checkinSentAt" | "checkoutSentAt"> = {
  welcome: "welcomeSentAt",
  checkin: "checkinSentAt",
  checkout: "checkoutSentAt",
};

function hrefFor(type: string, page: number): string {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (page > 1) params.set("sayfa", String(page));
  const qs = params.toString();
  return qs ? `/sent?${qs}` : "/sent";
}

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; sayfa?: string }>;
}) {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const { type, sayfa } = await searchParams;

  const activeType: SentKind | "" =
    type === "reply" || type === "welcome" || type === "checkin" || type === "checkout" ? type : "";
  // Karma ("Tümü") görünüm sayfa başına 4 kaynaktan sayfa*boyut satır okuduğu için
  // TAVANLI; tür seçilince tek kaynak + skip/take çalışır ve derinlik sınırsızdır.
  const page = clampPage(sayfa, activeType ? MAX_TYPED_PAGE : MAX_MERGED_PAGE);

  // "x gün önce" 30 günü aşınca mutlak güne düşer — host'un takvim günü.
  const orgRow = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  const TZ = orgTimezone(orgRow?.timezone);
  const wants = (k: SentKind) => !activeType || activeType === k;

  // Sayım ve listeleme AYNI koşulu paylaşsın diye where'ler tek yerde: ikisi
  // birbirinden kayarsa sayaç yine yalan söyler (bu ekranın asıl hatasıydı).
  const replyWhere: Prisma.MessageWhereInput = {
    direction: "outbound",
    // AI auto-sends DECIDED by authorType (senderName is display/audit only);
    // senderName is the transitional fallback for legacy NULL rows. Booking
    // channels only — the QR "chat" surface has its own tab (prior semantics).
    OR: [{ authorType: "ai" }, { authorType: null, senderName: "GuestOps AI" }],
    conversation: { property: { organizationId: orgId }, channel: { not: "chat" } },
  };
  const lifecycleWhere = (kind: LifecycleKind): Prisma.ReservationWhereInput => ({
    [SENT_AT_COLUMN[kind]]: { not: null },
    property: { organizationId: orgId },
  });

  const lifecycleSelect = {
    id: true,
    propertyId: true,
    guestName: true,
    welcomeSentAt: true,
    checkinSentAt: true,
    checkoutSentAt: true,
    property: { select: { name: true } },
  } as const;

  // Tür seçiliyse tek kaynaktan tam sayfa (skip/take, kesin). "Tümü" ise her
  // kaynaktan sayfa*boyut satır: birleşim global pencerenin TAMAMINI içerir
  // (kanıt: src/lib/sent-history.ts), sonra kesilir.
  const perSourceTake = activeType ? SENT_PAGE_SIZE : page * SENT_PAGE_SIZE;
  const perSourceSkip = activeType ? (page - 1) * SENT_PAGE_SIZE : 0;
  const emptyLifecycle: Prisma.ReservationGetPayload<{ select: typeof lifecycleSelect }>[] = [];

  const [
    replies,
    welcomes,
    checkins,
    checkouts,
    replyCount,
    welcomeCount,
    checkinCount,
    checkoutCount,
    connection,
  ] = await Promise.all([
    wants("reply")
      ? prisma.message.findMany({
          where: replyWhere,
          include: {
            conversation: {
              select: { guestIdentifier: true, property: { select: { name: true } } },
            },
          },
          // TAM SIRA: eşit damgalı satırlarda sayfa sınırı kaymasın diye ikincil
          // anahtar zorunlu — yoksa aynı satır iki sayfada çıkar ya da hiç çıkmaz.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: perSourceSkip,
          take: perSourceTake,
        })
      : Promise.resolve([]),
    wants("welcome")
      ? prisma.reservation.findMany({
          where: lifecycleWhere("welcome"),
          select: lifecycleSelect,
          orderBy: [{ welcomeSentAt: "desc" }, { id: "desc" }],
          skip: perSourceSkip,
          take: perSourceTake,
        })
      : Promise.resolve(emptyLifecycle),
    wants("checkin")
      ? prisma.reservation.findMany({
          where: lifecycleWhere("checkin"),
          select: lifecycleSelect,
          orderBy: [{ checkinSentAt: "desc" }, { id: "desc" }],
          skip: perSourceSkip,
          take: perSourceTake,
        })
      : Promise.resolve(emptyLifecycle),
    wants("checkout")
      ? prisma.reservation.findMany({
          where: lifecycleWhere("checkout"),
          select: lifecycleSelect,
          orderBy: [{ checkoutSentAt: "desc" }, { id: "desc" }],
          skip: perSourceSkip,
          take: perSourceTake,
        })
      : Promise.resolve(emptyLifecycle),
    // GERÇEK toplamlar — filtre çipleri artık sayfadaki satırları değil, kayıtlı
    // tüm geçmişi sayar.
    prisma.message.count({ where: replyWhere }),
    prisma.reservation.count({ where: lifecycleWhere("welcome") }),
    prisma.reservation.count({ where: lifecycleWhere("checkin") }),
    prisma.reservation.count({ where: lifecycleWhere("checkout") }),
    getConnectionInfo(orgId),
  ]);

  const totals: Record<SentKind, number> = {
    reply: replyCount,
    welcome: welcomeCount,
    checkin: checkinCount,
    checkout: checkoutCount,
  };
  const totalAll = replyCount + welcomeCount + checkinCount + checkoutCount;
  const activeTotal = activeType ? totals[activeType] : totalAll;

  const toItem = (
    r: (typeof emptyLifecycle)[number],
    kind: LifecycleKind,
    when: Date,
  ): SentItem => ({
    id: `${kind}-${r.id}`,
    kind,
    when,
    guest: r.guestName,
    property: r.property.name,
    preview: "", // aşağıda KB araması sonrası doldurulur
    templatePreview: true,
    sortKey: r.id,
  });

  const merged = mergeSentPage<SentItem>(
    [
      replies.map((m) => ({
        id: `r-${m.id}`,
        kind: "reply" as const,
        when: m.createdAt,
        guest: m.conversation.guestIdentifier,
        property: m.conversation.property.name,
        preview: truncate(m.body, 120),
        templatePreview: false,
        sortKey: m.id,
      })),
      welcomes.map((w) => toItem(w, "welcome", w.welcomeSentAt as Date)),
      checkins.map((c) => toItem(c, "checkin", c.checkinSentAt as Date)),
      checkouts.map((c) => toItem(c, "checkout", c.checkoutSentAt as Date)),
    ],
    // Tür seçiliyken satırlar zaten doğru pencereden geldi (skip/take yaptı),
    // karma görünümde ise pencere burada kesilir.
    activeType ? 1 : page,
    SENT_PAGE_SIZE,
    (it) => it.when,
    (it) => it.sortKey,
  );

  // Lifecycle message bodies aren't persisted — only the sent-at flag is. To show
  // SOMETHING about the content we look up each property's Knowledge Base entry for
  // the matching category. This is TODAY'S template, not the delivered text: if the
  // host edited it since, the two differ — the row is labelled accordingly, and the
  // real fix (persisting the delivered body) is a schema change, tracked separately.
  // Only the rows ON THIS PAGE are looked up. One grouped, org-scoped query (no N+1).
  const lifecycleRows = merged.filter((it) => it.templatePreview);
  const rowPropertyIds = new Map<string, string>(); // item id → propertyId
  for (const w of welcomes) rowPropertyIds.set(`welcome-${w.id}`, w.propertyId);
  for (const c of checkins) rowPropertyIds.set(`checkin-${c.id}`, c.propertyId);
  for (const c of checkouts) rowPropertyIds.set(`checkout-${c.id}`, c.propertyId);
  const pagePropertyIds = Array.from(
    new Set(lifecycleRows.map((it) => rowPropertyIds.get(it.id)).filter((v): v is string => Boolean(v))),
  );
  const kbItems = pagePropertyIds.length
    ? await prisma.knowledgeBaseItem.findMany({
        where: {
          propertyId: { in: pagePropertyIds },
          category: { in: ["welcome", "checkin", "checkout"] },
          isActive: true,
          property: { organizationId: orgId }, // tenant isolation
        },
        select: { propertyId: true, category: true, content: true },
        orderBy: { updatedAt: "desc" }, // newest active entry wins — same as the sender
      })
    : [];
  const kbByKey = new Map<string, string>();
  for (const k of kbItems) {
    const key = `${k.propertyId}:${k.category}`;
    if (!kbByKey.has(key)) kbByKey.set(key, k.content); // newest active entry wins (sorted desc)
  }
  for (const it of lifecycleRows) {
    const propertyId = rowPropertyIds.get(it.id);
    const content = propertyId ? kbByKey.get(`${propertyId}:${it.kind}`) : undefined;
    if (!content) {
      it.preview = FALLBACK_PREVIEW[it.kind as LifecycleKind];
      it.templatePreview = false; // "kayıtlı değil" bir şablon önizlemesi değil
      continue;
    }
    const resolved = fillTokens(content.trim(), firstNameOf(it.guest), it.property);
    it.preview = truncate(resolved.replace(/\s+/g, " "), 120);
  }

  const filters: { value: string; label: string; count: number }[] = [
    { value: "", label: "Tümü", count: totalAll },
    { value: "reply", label: "Oto-yanıtlar", count: totals.reply },
    { value: "welcome", label: "Karşılama", count: totals.welcome },
    { value: "checkin", label: "Giriş", count: totals.checkin },
    { value: "checkout", label: "Çıkış", count: totals.checkout },
  ];

  const from = merged.length === 0 ? 0 : (page - 1) * SENT_PAGE_SIZE + 1;
  // (Boş sayfada footer zaten render edilmiyor; yine de 0 satırda "0–100" gibi
  // saçma bir aralık üretmesin.)
  const to = merged.length === 0 ? 0 : (page - 1) * SENT_PAGE_SIZE + merged.length;
  const hasPrev = page > 1;
  const moreExist = to < activeTotal;
  // Karma görünümde tavana gelindiyse "Sonraki" yok — bunun yerine tür seçmeye
  // yönlendiren dürüst bir not gösterilir.
  const cappedOut = !activeType && page >= MAX_MERGED_PAGE && moreExist;
  const hasNext = moreExist && !cappedOut;
  const showsTemplatePreview = merged.some((it) => it.templatePreview);

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

      {totalAll > 0 ? (
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const active = activeType === f.value;
            return (
              <Link
                key={f.value || "all"}
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
          icon={Send}
          title="Henüz otomatik mesaj gönderilmedi"
          description={
            connection.connected
              ? "Oto-yanıt veya otomatik karşılama açıldığında, gönderilen her mesaj burada listelenir."
              : "Airbnb / Booking bağlantısını kurup oto-yanıt veya otomatik karşılamayı açtığınızda, gönderilen her mesaj burada listelenir."
          }
        />
      ) : merged.length === 0 ? (
        <EmptyState
          icon={Send}
          title={activeTotal === 0 ? "Bu türde mesaj yok" : "Bu sayfada kayıt yok"}
          description={
            activeTotal === 0
              ? "Seçtiğiniz türde gönderilmiş mesaj bulunmuyor."
              : "Sayfa numarası listenin sonunu aşmış görünüyor — ilk sayfaya dönebilirsiniz."
          }
        />
      ) : (
        // Compact divided list (inbox pattern) — one Card+shadow per row read
        // heavy, and the icon tile duplicated what the type badge already says.
        <div className="space-y-3">
          {showsTemplatePreview ? (
            <p className="text-xs text-muted-foreground">
              Karşılama / giriş / çıkış satırlarında gönderilen metnin kendisi saklanmıyor; aşağıda o
              mülkün <strong>bugünkü şablonunun</strong> önizlemesi gösterilir. Şablonu sonradan
              değiştirdiyseniz gönderilen mesaj bundan farklı olabilir.
            </p>
          ) : null}

          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {merged.map((it) => (
              <div key={it.id} className="px-4 py-3">
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
                    {KIND_LABEL[it.kind]}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{fromNow(it.when, TZ)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {it.templatePreview ? (
                    <span className="mr-1.5 rounded border border-border px-1 py-0.5 align-middle text-[10px] uppercase tracking-wide">
                      Güncel şablon
                    </span>
                  ) : null}
                  {it.preview}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
            <span>
              {from}–{to} / {activeTotal}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  href={hrefFor(activeType, page - 1)}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Önceki
                </Link>
              ) : null}
              {hasNext ? (
                <Link
                  href={hrefFor(activeType, page + 1)}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Sonraki
                </Link>
              ) : null}
            </div>
          </div>

          {cappedOut ? (
            <p className="text-xs text-muted-foreground">
              Karma listede en fazla {MAX_MERGED_PAGE * SENT_PAGE_SIZE} kayıt gezilebilir. Daha
              eskisi için yukarıdan bir tür seçin — orada geçmişin tamamı sayfalanır.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
