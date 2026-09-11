import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, User, UserRound } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { orgTimezone } from "@/lib/timezone";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { BrandMark } from "@/components/brand";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { GuestChatReply } from "@/components/guest-chats/reply-box";
import { GuestChatResumeAi } from "@/components/guest-chats/resume-ai-button";
import { ScrollToLatest } from "@/components/guest-chats/scroll-to-latest";
import { guestChatPausedByConversation } from "@/lib/guest-chat";
import { guestChatDisplayRole } from "@/lib/message-author";
import { formatDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Mesaj kaydırma kabının DOM kimliği — `ScrollToLatest` bunu arar (server
 *  component'ten istemciye ref geçirilemez). */
const MESSAGE_BOX_ID = "guest-chat-messages";

/** Varsayılan pencere: bir QR konaklaması bunu neredeyse hiç aşmaz. */
const RECENT_WINDOW = 200;
/** Her "önceki 200" tıklamasında pencerenin büyüme miktarı. */
const WINDOW_STEP = 200;
/**
 * SERT TAVAN. Tek seferde "tümünü göster" demek eski sorunu geri getirirdi:
 * 10.000 mesajlık bir thread yine dev DOM üretirdi. Bunun yerine pencere
 * KADEMELİ büyür (200'er) ve burada durur; tavana gelindiğinde ekran bunu
 * söyler ve bunun bir görüntüleme sınırı olduğunu (veri kaybı değil) belirtir.
 */
const MAX_WINDOW = 1000;

/**
 * Tek QR sohbetinin tam yazışması + yanıt kutusu.
 *
 * Liste ekranından ayrıldı (Codex): 200 thread'in her birinin son 100 mesajını
 * TEK sayfada basmak teorik olarak 20.000 baloncuk demekti. Burada tek thread var
 * ve pencere aşılırsa ekran bunu SÖYLÜYOR — eskiden kesme sessizdi.
 */
export default async function GuestChatDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mesaj?: string }>;
}) {
  const session = await requireAuth();
  if (session.role !== "owner" && session.role !== "manager") redirect("/dashboard");
  const { id } = await params;
  const { mesaj } = await searchParams;
  // Kademeli pencere: 200 → 400 → … → MAX_WINDOW. Çöp/taşkın girdi kelepçelenir.
  const requested = Number.parseInt(Array.isArray(mesaj) ? mesaj[0] : mesaj ?? "", 10);
  const windowSize = Number.isFinite(requested)
    ? Math.min(MAX_WINDOW, Math.max(RECENT_WINDOW, Math.ceil(requested / WINDOW_STEP) * WINDOW_STEP))
    : RECENT_WINDOW;

  // Org-scoped WHERE: başka kiracının thread'i notFound() ile aynı cevabı alır.
  const convo = await prisma.conversation.findFirst({
    where: {
      id,
      channel: "chat",
      property: { organizationId: session.organizationId },
    },
    select: {
      id: true,
      guestIdentifier: true,
      priority: true,
      property: { select: { name: true } },
      reservation: { select: { guestName: true, arrivalDate: true, departureDate: true } },
      _count: { select: { messages: true } },
      messages: {
        // TAM SIRA (eşit damgada sayfa/pencere sınırı kaymasın).
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: windowSize,
      },
    },
  });
  if (!convo) notFound();

  // Sohbet baloncuklarının damgası gerçek an → host'un duvar saati. Aşağıdaki
  // rezervasyon giriş/çıkış TARİHLERİ date-only, formatDate ile UTC'de kalır.
  const orgRow = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { timezone: true },
  });
  const TZ = orgTimezone(orgRow?.timezone);

  const messages = convo.messages.slice().reverse(); // kronolojik
  const hidden = convo._count.messages - messages.length;
  // ⚠️ DEVİR DURUMU KESİLMİŞ PENCEREDEN HESAPLANAMAZ (denetim, 08-01).
  //
  // Eskiden `guestChatAiPausedFromMessages(messages)` çağrılıyordu — yani yalnız
  // EKRANDAKİ pencereye bakıyordu. Devirden sonra AI susar ve `record(null, …)`
  // yalnız misafirin satırını yazar; host'un devri tetikleyen mesajı pencerenin
  // dışına düşerse ("son host mesajından sonra 200+ ardışık misafir mesajı")
  // sayfa "İnsan desteğinde" rozetini ve "AI'yı yeniden başlat" düğmesini
  // GÖSTERMEZ — host thread'i geri alamaz hâle gelir.
  //
  // Sunucu tarafı duraklatma DOĞRU kalıyordu (o yol tüm mesajları okur), yani
  // AI sızıp cevap vermiyordu; arıza yalnız GÖRÜNÜRLÜKTEYDİ. Yine de düğmenin
  // kaybolması host'un elindeki tek geri-alma yolunu gizliyordu.
  //
  // Artık liste ekranıyla AYNI otoriter kaynak kullanılıyor (tüm thread'i okuyan
  // DISTINCT ON sorgusu) — iki ekran birbirinden ayrışamaz.
  const aiPaused = (await guestChatPausedByConversation([convo.id])).get(convo.id) ?? false;
  const guestLabel = convo.reservation?.guestName ?? convo.guestIdentifier;

  // 🚨 "Yeni mesaj geldi mi" imzası: sayı + son mesajın kimliği. Yalnız sayıya
  // bakmak, aynı anda bir mesaj silinip biri eklenirse kaydırmayı kaçırırdı.
  const latestSignature = `${convo._count.messages}:${messages[messages.length - 1]?.id ?? ""}`;

  return (
    <>
      {/* 🚨 QR sohbetleri ekranı KENDİNİ YENİLEMİYORDU (kurucu, 09-11: "gelsin işte
          mesajlar hemen"). Misafir tarafı 5 sn'de bir poll ederken host F5'e
          basmak zorundaydı; Mesajlar ekranında bu bileşen 08'den beri var, QR
          ekranları atlanmıştı. Görünürlük kapısı ve temizlik bileşenin içinde. */}
      <AutoRefresh seconds={30} />
      <PageHeader
        title={`${convo.property.name} · ${guestLabel}`}
        description="QR üzerinden gelen misafir sohbeti. Buradan misafire siz de yazabilirsiniz."
      >
        <Link
          href="/guest-chats"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Tüm sohbetler
        </Link>
      </PageHeader>

      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {convo.reservation ? (
              <span className="text-xs text-muted-foreground">
                {formatDate(convo.reservation.arrivalDate)} –{" "}
                {formatDate(convo.reservation.departureDate)}
              </span>
            ) : null}
            {convo.priority === "urgent" ? (
              <Badge tone="warning">
                <AlertTriangle className="mr-1 size-3" /> Ev sahibine iletildi
              </Badge>
            ) : null}
            {aiPaused ? (
              <Badge tone="default">
                <UserRound className="mr-1 size-3" /> İnsan desteğinde
              </Badge>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {convo._count.messages} mesaj
            </span>
          </div>

          {/* Kesme artık SESSİZ DEĞİL: kaç mesajın gizlendiği yazılı ve açma yolu var. */}
          {hidden > 0 ? (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              En yeni {messages.length} mesaj gösteriliyor; {hidden} eski mesaj gizli.{" "}
              {windowSize >= MAX_WINDOW ? (
                <>
                  Tek sayfada en fazla {MAX_WINDOW} mesaj gösterilir (tarayıcıyı kilitlememek
                  için). Daha eskisi silinmedi, yalnız burada görüntülenmiyor.
                </>
              ) : (
                <Link
                  href={`/guest-chats/${convo.id}?mesaj=${windowSize + WINDOW_STEP}`}
                  className="text-primary hover:underline"
                >
                  Önceki {Math.min(WINDOW_STEP, hidden)} mesajı yükle
                </Link>
              )}
            </p>
          ) : null}

          {/* 🚨 MESAJLAR KENDİ KAYDIRMA KABINDA (09-11). Eskiden tüm pencere (200,
              "önceki"lerle 1000'e kadar) düz basılıyordu: yazma kutusu balonların
              ALTINDA kalıyor, host sayfayı açtığında EN ESKİ mesajda duruyordu ve
              30 sn'lik tazeleme yeni bir balon eklediğinde yazma kutusu aşağı
              kayıyordu. Gelen kutusundaki desenin (`conversation-thread.tsx`)
              aynısı: kap kaydırılır, composer kabın DIŞINDA sabit kalır. */}
          <div
            id={MESSAGE_BOX_ID}
            tabIndex={0}
            role="group"
            aria-label="Misafir sohbeti"
            className="scrollbar-thin max-h-[52vh] space-y-2 overflow-y-auto overscroll-contain scroll-smooth rounded-lg bg-muted/20 p-2"
          >
            {messages.map((m) => {
              // Reliable, typed role (authorType) — never the message text/senderName.
              const role = guestChatDisplayRole(m);
              // The AI re-enable event is a system separator line, not a chat bubble.
              if (role === "resume") {
                return (
                  <div
                    key={m.id}
                    className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground"
                  >
                    <span className="h-px flex-1 bg-border" />
                    <BrandMark className="size-3.5" />
                    Lixus AI yeniden etkinleştirildi
                    <span className="h-px flex-1 bg-border" />
                  </div>
                );
              }
              const guest = role === "guest";
              const host = role === "host";
              return (
                <div key={m.id} className={guest ? "flex justify-start" : "flex justify-end"}>
                  <div
                    className={
                      guest
                        ? "max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm"
                        : host
                          ? "max-w-[85%] rounded-2xl rounded-br-sm border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-200"
                          : "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                    }
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {/* 🚨 EMOJİ YERİNE GERÇEK İKON (kurucu, 09-11: "ordaki insan figuru
                        daha güzel olabilir … AI logosunda adam gibi bir logo olsun
                        robot niye koydun"). 🤖/👤/🙋 sistem yazı tipine bağlıydı —
                        Android/iOS/Windows'ta farklı çiziliyor, tema rengini almıyor.
                        AI'ın yüzü artık ÜRÜNÜN KENDİ LOGOSU (`BrandMark`, currentColor
                        SVG) — robot değil, marka. */}
                    <p
                      className={
                        guest
                          ? "mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"
                          : host
                            ? "mt-0.5 flex items-center justify-end gap-1 text-[10px] text-emerald-700 dark:text-emerald-400"
                            : "mt-0.5 flex items-center justify-end gap-1 text-[10px] text-primary-foreground/70"
                      }
                    >
                      {guest ? (
                        <>
                          <User className="size-3" /> Misafir
                        </>
                      ) : host ? (
                        <>
                          <UserRound className="size-3" /> Siz
                        </>
                      ) : (
                        <>
                          <BrandMark className="size-3" /> Lixus AI
                        </>
                      )}
                      <span aria-hidden="true">·</span> {formatDateTime(m.createdAt, TZ)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <ScrollToLatest targetId={MESSAGE_BOX_ID} signature={latestSignature} />

          {aiPaused ? (
            <div className="border-t border-border pt-3">
              <GuestChatResumeAi conversationId={convo.id} />
            </div>
          ) : null}
          <GuestChatReply conversationId={convo.id} aiPaused={aiPaused} />
        </CardContent>
      </Card>
    </>
  );
}
