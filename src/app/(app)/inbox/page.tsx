import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Plus, AlertTriangle, Search, X } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { buttonVariants } from "@/components/ui/button";
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

/**
 * Sayfalama düğmesi. Uçlarda düğme KAYBOLMAZ, devre dışı görünür: yoksa
 * "Önceki" ilk sayfada yok olup "Sonraki" sola zıplıyordu (her sayfa geçişinde
 * düğmeler yer değiştiriyordu). Devre dışı hâl bir <span>'dir — odaklanılamaz,
 * yani klavye kullanıcısı tıklanamayan bir durağa takılmaz.
 */
function LinkOrDisabled({ href, label }: { href: string | null; label: string }) {
  const base =
    "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors";
  if (!href) {
    return (
      <span aria-hidden="true" className={cn(base, "border-border/60 text-muted-foreground/40")}>
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        base,
        "border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      )}
    >
      {label}
    </Link>
  );
}

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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  /**
   * Aralık dışı sayfa → SON GEÇERLİ sayfaya clamp (görevler ekranıyla aynı
   * karar). Yoksa `?status=new&sayfa=2` gibi bir adres — filtreyi daraltıp
   * sayfada kalmak yeter — boş bir ekran ve "Henüz misafir mesajı yok"
   * mesajı gösteriyordu: mesaj VAR, o filtrede 2. sayfa yok. Kullanıcı bunu
   * "hiç kaydım kalmamış" diye okur.
   */
  if (total > 0 && page > totalPages) redirect(hrefFor({ sayfa: totalPages }));

  /**
   * Sayaç + sayfalama çubuğu. Çok sayfalı listede listenin HEM ÜSTÜNDE HEM
   * ALTINDA basılır: aksi hâlde "Sonraki"ye basmak için 50 satır aşağı inmek,
   * sonra yeni sayfanın başına dönüp tekrar inmek gerekiyordu.
   *
   * Bağlantılar `hrefFor` üzerinden üretilir → aktif FİLTRE ve ARAMA korunur
   * (yalnız `sayfa` değişir).
   *
   * Her kopya kendi `<nav>` adını taşır ("üst"/"alt"): iki özdeş "Önceki"
   * düğmesi ekran okuyucunun düğme listesinde ayırt edilemez olurdu.
   *
   * "1–4 / 4" bir makine çıktısıydı: tek sayfalık listede aralık da sayfa da
   * anlamsız → tek sayfa yalnız toplamı yazar ve sayfalama düğmeleri HİÇ
   * basılmaz (tıklanacak bir şey yokken görünmemeli).
   */
  function pagerBar(position: "üst" | "alt") {
    const summary =
      totalPages > 1
        ? `${total} konuşmadan ${from}–${to} arası · Sayfa ${page} / ${totalPages}`
        : `${total} konuşma`;
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 text-xs text-muted-foreground",
          position === "üst" ? "px-1 pb-1" : "px-4 py-3",
        )}
      >
        <span>{summary}</span>
        {totalPages > 1 ? (
          <nav aria-label={`Sayfalama (${position})`} className="flex shrink-0 gap-1.5">
            <LinkOrDisabled href={page > 1 ? hrefFor({ sayfa: page - 1 }) : null} label="Önceki" />
            <LinkOrDisabled
              href={page < totalPages ? hrefFor({ sayfa: page + 1 }) : null}
              label="Sonraki"
            />
          </nav>
        ) : null}
      </div>
    );
  }

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

      {/* Filtreler + arama TEK satır. Tüm kontroller aynı yükseklikte (h-8) ve
          aynı radius'ta (rounded-md = 6px); arama kutusu ile "Ara" düğmesi
          `flex-nowrap` ile birlikte tutulur, yani düğme alt satıra düşmez. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => {
            const active = (status ?? "") === f.value;
            return (
              <Link
                key={f.value || "all"}
                href={hrefFor({ status: f.value })}
                // Hangi filtrenin uygulandığı EskİDEN yalnız renkle söyleniyordu:
                // ekran okuyucu kullanıcısı kısa bir liste görünce bunun filtre
                // sonucu mu yoksa gerçekten az kayıt mı olduğunu ayırt edemiyordu.
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
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
        <form method="GET" role="search" className="flex flex-nowrap items-center gap-1.5">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {/* Placeholder bir AD DEĞİLDİR: arama yapıldıktan sonra kutu dolu
              geldiği için hiç görünmez ve bazı ekran okuyucular hiç okumaz
              (conversation-thread.tsx composer'ıyla aynı desen). */}
          <label htmlFor="inbox-search" className="sr-only">
            Misafir adına göre ara
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="inbox-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Misafir adına göre ara…"
              className="h-8 w-40 rounded-md border border-border bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-56"
            />
          </div>
          {/* Enter zaten formu gönderir (native submit); düğme fare kullanıcısı
              için ve `shrink-0` ile alt satıra düşmez. */}
          <button
            type="submit"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
          >
            Ara
          </button>
          {query ? (
            <Link
              href={status ? `/inbox?status=${status}` : "/inbox"}
              aria-label="Aramayı temizle"
              title="Aramayı temizle"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "shrink-0 px-2 text-muted-foreground",
              )}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </form>
      </div>

      {conversations.length === 0 ? (
        /**
         * Boş ekranın SEBEBİ ayırt edilir. Eskiden tek bir dal vardı: 900
         * konuşması olan bir host "Sorunlu" filtresine basıp o an sorunlu
         * konuşması yoksa "Henüz misafir mesajı yok — Airbnb bağlantısını
         * kurunca mesajlar akar" görüyordu. Bağlantı KURULU, mesajlar VAR;
         * metin hem yanlıştı hem de yanlış eylemi öneriyordu ("Yeni konuşma"),
         * oysa doğru eylem filtreyi kaldırmaktı.
         *
         * Taşan-sayfa clamp'iyle aynı sınıf ("kayıt var, bu pencerede yok");
         * orası kapatılmıştı, burası açık kalmıştı.
         */
        status || query ? (
          <EmptyState
            icon={Search}
            title="Bu filtreyle eşleşen konuşma yok"
            description={
              query
                ? `“${query}” ile eşleşen misafir bulunamadı. Arama yalnız misafir adında yapılır.`
                : "Seçili durumda konuşma yok. Başka bir durum seçebilir ya da filtreyi kaldırabilirsiniz."
            }
          >
            <LinkButton href="/inbox" size="sm" variant="outline">
              Filtreleri temizle
            </LinkButton>
          </EmptyState>
        ) : (
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
        )
      ) : (
        <div className="space-y-2">
          {totalPages > 1 ? pagerBar("üst") : null}
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
                    <>
                      {/* İkon TEK BAŞINA bilgi taşıyamaz: lucide <svg>'leri
                          ne <title> ne aria taşır (kod-doğrulandı), yani ekran
                          okuyucu kullanıcısı satırın ACİL olduğunu HİÇ
                          öğrenmiyordu. Listenin tek amacı önceliklendirme. */}
                      <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                      <span className="sr-only">Acil</span>
                    </>
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

            {pagerBar("alt")}
          </div>
        </div>
      )}
    </>
  );
}
