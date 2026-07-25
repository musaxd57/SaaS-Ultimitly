import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, QrCode, Building2, MessageSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { guestChatAiPausedFromMessages } from "@/lib/guest-chat";
import { clampPage, MAX_LIST_PAGE } from "@/lib/pagination";
import { formatDate, fromNow, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
/** "İnsan desteğinde" rozeti için taranan son mesaj sayısı — aşağıdaki nota bak. */
const HANDOFF_WINDOW = 50;

/**
 * "Misafir Sohbetleri" — the QR concierge transcripts, kept SEPARATE from the
 * Airbnb inbox. One thread per guest stay. Owner/manager only.
 *
 * LİSTE-DETAY (Codex): bu ekran eskiden 200 thread'in HER BİRİNİN son 100
 * mesajını tek sayfada basıyordu — teorik olarak 20.000 mesaj baloncuğu, 200
 * client bileşeni ve sessizce kesilmiş bir geçmiş. Artık burası yalnız sayfalı
 * bir LİSTE; tam yazışma ve yanıt kutusu /guest-chats/[id] içinde.
 */
export default async function GuestChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ sayfa?: string }>;
}) {
  const session = await requireAuth();
  if (session.role !== "owner" && session.role !== "manager") redirect("/dashboard");
  const { sayfa } = await searchParams;
  const page = clampPage(sayfa, MAX_LIST_PAGE);

  const where = {
    property: { organizationId: session.organizationId },
    channel: "chat",
  };

  const [total, rows] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      select: {
        id: true,
        guestIdentifier: true,
        priority: true,
        lastMessageAt: true,
        property: { select: { name: true } },
        reservation: { select: { guestName: true, arrivalDate: true, departureDate: true } },
        _count: { select: { messages: true } },
        // İki iş için son mesajlar: (a) listedeki tek satırlık önizleme,
        // (b) "İnsan desteğinde" rozetinin türetimi. GÖVDE yalnız en yenisinde
        // lazım ama Prisma alan-başına farklı take veremiyor; yine de burada
        // okunan mesaj sayısı eski ekranın 1/2'si ve satır başına DOM'a hiç
        // basılmıyor. Rozet, devir işaretini son HANDOFF_WINDOW mesaj içinde
        // arar; daha eskide kalmış bir devir (üstüne yalnız misafir mesajı
        // gelmişse) listede rozetsiz görünebilir — DETAY sayfası tam pencereyi
        // okuduğu için orası yetkili kaynaktır.
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: HANDOFF_WINDOW,
          select: {
            id: true,
            body: true,
            direction: true,
            senderName: true,
            authorType: true,
            systemEventType: true,
            createdAt: true,
          },
        },
      },
      // TAM SIRA: eşit lastMessageAt'te sayfa sınırı kaymasın (aynı ders,
      // Gönderilenler ekranındaki gibi).
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const threads = rows.map((c) => {
    const chronological = c.messages.slice().reverse();
    return {
      id: c.id,
      title: `${c.property.name} · ${c.reservation?.guestName ?? c.guestIdentifier}`,
      stay: c.reservation,
      urgent: c.priority === "urgent",
      aiPaused: guestChatAiPausedFromMessages(chronological),
      messageCount: c._count.messages,
      last: c.messages[0] ?? null, // en yenisi (desc sıradan)
      lastMessageAt: c.lastMessageAt,
    };
  });

  const from = threads.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = threads.length === 0 ? 0 : (page - 1) * PAGE_SIZE + threads.length;
  const hasPrev = page > 1;
  const hasNext = to < total;
  const hrefFor = (p: number) => (p > 1 ? `/guest-chats?sayfa=${p}` : "/guest-chats");

  return (
    <>
      <PageHeader
        title="Misafir Sohbetleri"
        description="Daireye asılan QR'dan gelen sohbetler — misafirin sorusu, AI'ın yanıtı ve sizin yanıtlarınız. Mesajlar (Airbnb) sekmesinden ayrı tutulur. Bir sohbeti açıp misafire siz de yazabilirsiniz."
      />

      {total === 0 ? (
        <Card>
          <CardContent className="space-y-6 px-6 py-10">
            <div className="flex flex-col items-center text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <QrCode className="size-7" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">Daireniz için 7/24 misafir asistanı</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Daireye astığınız bir QR&apos;ı okutan misafir; Wi-Fi, çevredeki yerler, ulaşım gibi
                <strong> genel sorularını</strong> yapay zekâya sorar. AI bilgi tabanınızdan yanıtlar;
                çözemediği bir konu olursa <strong>size iletir</strong> ve buradan siz yanıtlarsınız.
                Güvenlik için kapı kodu/Wi-Fi şifresi QR&apos;da paylaşılmaz.
              </p>
            </div>

            <div className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <p className="mt-2 text-xs text-muted-foreground">
                  <strong className="text-foreground">Mülkler</strong>&apos;den bir daireyi açıp{" "}
                  <strong className="text-foreground">&quot;Misafir sohbetini aç&quot;</strong>a basın.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  2
                </span>
                <p className="mt-2 text-xs text-muted-foreground">
                  Çıkan <strong className="text-foreground">QR&apos;ı indirip yazdırın</strong>, daireye asın.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </span>
                <p className="mt-2 text-xs text-muted-foreground">
                  Misafir okuttukça sohbetler <strong className="text-foreground">burada</strong> görünür.
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <LinkButton href="/properties">
                <Building2 className="size-4" /> Mülklere git
              </LinkButton>
            </div>
          </CardContent>
        </Card>
      ) : threads.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            Bu sayfada sohbet yok — sayfa numarası listenin sonunu aşmış görünüyor.{" "}
            <Link href="/guest-chats" className="text-primary hover:underline">
              İlk sayfaya dön
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {threads.map((t) => (
              <Link
                key={t.id}
                href={`/guest-chats/${t.id}`}
                className="block px-4 py-3 transition-colors hover:bg-accent"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t.title}</span>
                  {t.urgent ? (
                    <Badge tone="warning">
                      <AlertTriangle className="mr-1 size-3" /> Ev sahibine iletildi
                    </Badge>
                  ) : null}
                  {t.aiPaused ? <Badge tone="default">🙋 İnsan desteğinde</Badge> : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t.lastMessageAt ? fromNow(t.lastMessageAt) : "—"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.last ? truncate(t.last.body.replace(/\s+/g, " "), 140) : "Henüz mesaj yok."}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-3" /> {t.messageCount} mesaj
                  </span>
                  {t.stay ? (
                    <span>
                      {formatDate(t.stay.arrivalDate)} – {formatDate(t.stay.departureDate)}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
            <span>
              {from}–{to} / {total}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  href={hrefFor(page - 1)}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Önceki
                </Link>
              ) : null}
              {hasNext ? (
                <Link
                  href={hrefFor(page + 1)}
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
