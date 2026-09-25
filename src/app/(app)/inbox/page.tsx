import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Plus, AlertTriangle, Search, X } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { orgTimezone } from "@/lib/timezone";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { ProblemTriagePanel } from "@/components/inbox/problem-triage-panel";
import { parseMissingInfo, isTriageStale } from "@/lib/ai/triage";
import { Pager } from "@/components/pager";
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
import { isDemoOrg } from "@/lib/demo-tenant/constants";
import { CLOSING_HANDLED_LABEL, isClosingHandled, notClosingHandledWhere } from "@/lib/conversation-attention";

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
    // "Yeni" sekmesi yalnız cevap bekleyenleri gösterir: kapanışa bilerek sessiz kalınmış konuşma ("cevap gerekmedi",
    // `conversation-attention.ts`) orada yok; "Tümü"nde kendi etiketiyle görünür. Sayaç ve liste AYNI koşul.
    ...(status === "new" || status === "waiting" ? { AND: [notClosingHandledWhere()] } : {}),
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
        timezone: true,
      },
    }),
    getConnectionInfo(session.organizationId),
  ]);

  // Free/expired tier: automation is suppressed server-side — render the
  // controls inert so they don't misleadingly read "Açık".
  const automationLocked = !(await premiumAllowed(session.organizationId));
  const demo = isDemoOrg(session.organizationId);

  // "x gün önce" etiketi 30 günü aşınca mutlak güne düşer — o gün host'un
  // takvim günü olmalı, sunucunun UTC'si değil.
  const TZ = orgTimezone(org?.timezone);

  // ── m48: "Açık sorunlar — triyaj" (yalnız Sorunlu sekmesinde) ─────────────
  // 🚨 MODEL ÇAĞRISI YOK: escalation ANINDA yazılmış analiz okunuyor.
  // ⚠️ Sorgu YALNIZ `status === "problem"` iken koşar — diğer sekmelerde tek
  // bir DB turu bile harcanmaz. Kolonlar konuşma "problem"den çıkarken
  // SİLİNMİYOR (tarihsel kayıt); görünürlüğü sağlayan şey tam da bu filtre.
  const triageRows =
    status === "problem"
      ? await prisma.conversation.findMany({
          where: { ...where, aiTriagedAt: { not: null } },
          select: {
            id: true,
            lastMessageAt: true,
            lastRiskType: true,
            aiActionSuggestion: true,
            aiMissingInfoJson: true,
            aiTriageSource: true,
            aiTriageTriggerMessageId: true,
            aiTriagedAt: true,
            property: { select: { name: true } },
            // Bayatlık ölçüsü: tetikleyici mesaj ile SON inbound mesaj aynı mı.
            messages: {
              where: { direction: "inbound" },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true },
            },
          },
          orderBy: [{ lastMessageAt: "asc" }], // en uzun bekleyen ÜSTTE
          take: 20,
        })
      : [];

  const filters = [{ value: "", label: "Tümü" }, ...CONVERSATION_STATUS.options];
  // Boş-durum başlığı seçili sekmenin ADIYLA konuşsun, soyut "filtre" diliyle
  // değil. ⚠️ HAM DURUM ETİKETİ SIFAT DEĞİLDİR (denetim, 08-01): etiketleri
  // doğrudan enterpole etmek "Cevaplandı mesajınız bulunmuyor" ve "Tamamlandı
  // mesajınız bulunmuyor" gibi bozuk Türkçe üretiyordu — host bunu okuyunca
  // ürünün çevirisinin bozuk olduğunu düşünür. Her durumun kendi CÜMLESİ var.
  // Bilinmeyen bir status query'si nötr cümleye düşer; ham kod ASLA görünmez.
  const EMPTY_TITLES: Record<string, string> = {
    new: "Yeni mesajınız yok",
    // ⚠️ `waiting` anahtarı KORUNDU: seçenek listesinden kalktı ama `?status=waiting`
    // URL'i hâlâ ham query olarak geçiyor (yalnız PATCH zod'lu) ve DB'de eski
    // satırlar olabilir. Anahtar silinseydi o yolda ham kod görünürdü.
    waiting: "Bekleyen mesajınız yok",
    answered: "Cevaplanmış mesajınız yok",
    problem: "Sorunlu mesajınız yok",
    closed: "Tamamlanmış mesajınız yok",
  };
  const emptyTitle = status
    ? (EMPTY_TITLES[status] ?? "Bu durumda mesajınız yok")
    : "Bekleyen mesajınız yok";

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
      <Pager
        page={page}
        totalPages={totalPages}
        summary={summary}
        hrefFor={(p) => hrefFor({ sayfa: p })}
        position={position}
      />
    );
  }

  // ⚠️ BAŞLANGIÇ == BİTİŞ, KODDA "TÜM GÜN" DEMEK (`isWithinActiveHours`), ama
  // ham saatleri basınca ekranda "00:00–00:00" çıkıyordu — yani sıfır uzunlukta
  // bir pencere gibi okunuyor. Yeni müşteri artık tüm gün açık doğduğu için
  // (NEW_ORG_AUTO_REPLY_WINDOW) bu, HER yeni hesabın gördüğü İLK ekranda doğru
  // davranışı arızalı gibi anlatıyordu: "AI hiç çalışmayacak" sanıp kapatabilir.
  const pad = (h: number) => String(h).padStart(2, "0");
  const startHour = org?.autoReplyStartHour ?? 0;
  const endHour = org?.autoReplyEndHour ?? 0;
  const allDay = startHour === endHour;
  const activeWindow = allDay ? "7/24" : `${pad(startHour)}:00–${pad(endHour)}:00`;
  const windowSentence = allDay ? "Açıkken: günün her saatinde" : `Açıkken: ${activeWindow} arası`;

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Mesajlar" description="Tüm misafir konuşmalarını tek kutudan yönetin.">
        {/* Demo (inceleme) hesabında kanal bağlantısı YOK: "Mesajları çek" her basışta "bağlı değil"
            der, önizleme de yalnız kanal konuşmalarını seçtiği için her zaman boş döner (ve günlük
            AI hakkı yakar). İkisi de orada yalnız kırık bir düğme olurdu. */}
        {demo ? null : <HospitableSyncButton />}
        {demo ? null : <AutoReplyTestButton locked={automationLocked} />}
        <AutoReplyToggle
          field="autoReplyHospitable"
          label={`Oto-yanıt (${activeWindow})`}
          enabled={org?.autoReplyHospitable ?? false}
          locked={automationLocked}
          title={`${windowSentence}, AI'ın %75+ emin olduğu BASİT sorulara (çöp günü, Wi-Fi, çevre önerisi gibi) otomatik cevap verir. Şikayet, iade, riskli ve belirsiz mesajlar HER ZAMAN size kalır.`}
        />
        <LinkButton href="/inbox/new">
          <Plus className="size-4" /> Yeni konuşma
        </LinkButton>
      </PageHeader>

      {triageRows.length > 0 ? (
        <ProblemTriagePanel
          timeZone={TZ}
          rows={triageRows.map((r) => ({
            id: r.id,
            propertyName: r.property.name,
            lastMessageAt: r.lastMessageAt,
            riskType: r.lastRiskType,
            actionSuggestion: r.aiActionSuggestion,
            // 🚨 GÜVENLİ AYRIŞTIRMA ŞART: burası bir SERVER COMPONENT, çıplak
            // `JSON.parse` bozuk tek bir satırda TÜM SAYFAYI 500'ler.
            missingInfo: parseMissingInfo(r.aiMissingInfoJson),
            source: r.aiTriageSource,
            stale: isTriageStale({
              triggerMessageId: r.aiTriageTriggerMessageId,
              latestInboundMessageId: r.messages[0]?.id ?? null,
              triagedAt: r.aiTriagedAt,
              lastMessageAt: r.lastMessageAt,
            }),
          }))}
        />
      ) : null}

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
                  "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
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
              className="h-8 w-40 rounded-md border border-border bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:ring-offset-background sm:w-56"
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
          /*
           * METİN, SEÇİLİ DURUMUN ADIYLA KONUŞUR. Önceki hâli soyut ve
           * ürün-diliydi ("Bu filtreyle eşleşen konuşma yok" + "Seçili durumda
           * konuşma yok. Başka bir durum seçebilir ya da filtreyi
           * kaldırabilirsiniz.") — host'un kafasında karşılığı olmayan bir cümle.
           * Doğru cümle, o an baktığı sekmenin adını kullanan cümledir:
           * "Beklemede mesajınız bulunmuyor." Bu bir İYİ HABER, hata değil.
           */
          <EmptyState
            icon={Search}
            title={
              query
                ? "Aramanızla eşleşen misafir yok"
                : emptyTitle
            }
            description={
              query
                ? `“${query}” ile eşleşen misafir bulunamadı. Arama yalnız misafir adında yapılır.`
                : "Bu durumda bekleyen bir konuşmanız yok. Diğer sekmelere bakabilir ya da filtreyi temizleyebilirsiniz."
            }
          >
            <LinkButton href="/inbox" size="sm" variant="outline">
              Filtreyi temizle
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
            // Highlight threads still needing attention (guest waiting / escalated). Kapanışa bilerek sessiz kalınmış
            // konuşma ("cevap gerekmedi") dikkat istemez: vurgusuz, kendi etiketiyle.
            const handled = isClosingHandled(c) && (c.status === "new" || c.status === "waiting");
            const unread = !handled && (c.status === "new" || c.status === "waiting" || c.status === "problem");
            return (
            <Link
              key={c.id}
              // 🔙 GERİ BAĞLAMI TAŞINIR (kullanıcı bildirdi): detay sayfasının
              // "Mesajlar" düğmesi SABİT `/inbox`e gidiyordu, yani panelin
              // "Sorunlu Konuşmalar" kutucuğundan gelip bir konuşmayı
              // kapatan host FİLTRESİZ gelen kutusuna düşüyor ve kalan
              // sorunluları elle bulmak zorunda kalıyordu. Artık bulunduğun
              // liste (filtre + sayfa) bağlantıda taşınıyor.
              href={`/inbox/${c.id}?from=${encodeURIComponent(hrefFor({}))}`}
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
                <Badge tone={handled ? "muted" : CONVERSATION_STATUS.tone(c.status)}>
                  {handled ? CLOSING_HANDLED_LABEL : CONVERSATION_STATUS.label(c.status)}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{fromNow(c.lastMessageAt, TZ)}</span>
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
