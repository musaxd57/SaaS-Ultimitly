import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GuestChatReply } from "@/components/guest-chats/reply-box";
import { GuestChatResumeAi } from "@/components/guest-chats/resume-ai-button";
import { guestChatAiPausedFromMessages } from "@/lib/guest-chat";
import { guestChatDisplayRole } from "@/lib/message-author";
import { formatDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Varsayılan pencere: bir QR konaklaması bunu neredeyse hiç aşmaz. */
const RECENT_WINDOW = 200;
/** "Tümünü göster" tavanı — tek sayfayı yine de sınırlı tutar. */
const FULL_WINDOW = 2000;

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
  searchParams: Promise<{ hepsi?: string }>;
}) {
  const session = await requireAuth();
  if (session.role !== "owner" && session.role !== "manager") redirect("/dashboard");
  const { id } = await params;
  const { hepsi } = await searchParams;
  const showAll = hepsi === "1";
  const window = showAll ? FULL_WINDOW : RECENT_WINDOW;

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
        take: window,
      },
    },
  });
  if (!convo) notFound();

  const messages = convo.messages.slice().reverse(); // kronolojik
  const hidden = convo._count.messages - messages.length;
  const aiPaused = guestChatAiPausedFromMessages(messages);
  const guestLabel = convo.reservation?.guestName ?? convo.guestIdentifier;

  return (
    <>
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
            {aiPaused ? <Badge tone="default">🙋 İnsan desteğinde</Badge> : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {convo._count.messages} mesaj
            </span>
          </div>

          {/* Kesme artık SESSİZ DEĞİL: kaç mesajın gizlendiği yazılı ve açma yolu var. */}
          {hidden > 0 ? (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              En yeni {messages.length} mesaj gösteriliyor; {hidden} eski mesaj gizli.{" "}
              {showAll ? (
                <>Bu sohbet görüntüleme tavanını ({FULL_WINDOW}) aşıyor.</>
              ) : (
                <Link href={`/guest-chats/${convo.id}?hepsi=1`} className="text-primary hover:underline">
                  Tümünü göster
                </Link>
              )}
            </p>
          ) : null}

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
                  🤖 Lixus AI yeniden etkinleştirildi
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
                        ? "max-w-[85%] rounded-2xl rounded-br-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                        : "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={
                      guest
                        ? "mt-0.5 text-[10px] text-muted-foreground"
                        : host
                          ? "mt-0.5 text-[10px] text-emerald-700"
                          : "mt-0.5 text-[10px] text-primary-foreground/70"
                    }
                  >
                    {guest ? "👤 Misafir" : host ? "🙋 Siz" : "🤖 Lixus AI"} ·{" "}
                    {formatDateTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}

          {aiPaused ? (
            <div className="border-t border-border pt-3">
              <GuestChatResumeAi conversationId={convo.id} />
            </div>
          ) : null}
          <GuestChatReply conversationId={convo.id} />
        </CardContent>
      </Card>
    </>
  );
}
