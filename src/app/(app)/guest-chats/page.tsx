import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GuestChatReply } from "@/components/guest-chats/reply-box";
import { formatDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * "Misafir Sohbetleri" — the QR concierge transcripts (guest question + AI reply),
 * kept SEPARATE from the Airbnb inbox. One thread per guest stay. Read-only (the
 * guest is an anonymous web visitor with no return channel). Owner/manager only.
 */
export default async function GuestChatsPage() {
  const session = await requireAuth();
  if (session.role !== "owner" && session.role !== "manager") redirect("/dashboard");

  const conversations = await prisma.conversation.findMany({
    where: { property: { organizationId: session.organizationId }, channel: "chat" },
    include: {
      property: { select: { name: true } },
      reservation: { select: { guestName: true, arrivalDate: true, departureDate: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Misafir Sohbetleri"
        description="Daireye asılan QR'dan gelen sohbetler — misafirin sorusu, AI'ın yanıtı ve sizin yanıtlarınız. Mesajlar (Airbnb) sekmesinden ayrı tutulur. Buradan misafire siz de yazabilirsiniz."
      />

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Henüz misafir sohbeti yok. Bir dairede QR&apos;ı açtığında ve o dairede aktif bir konaklama
            varken misafir yazdıkça sohbetler burada görünür.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {conversations.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">
                  {c.property.name} · {c.reservation?.guestName ?? c.guestIdentifier}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {c.reservation ? (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(c.reservation.arrivalDate)} – {formatDate(c.reservation.departureDate)}
                    </span>
                  ) : null}
                  {c.priority === "urgent" ? (
                    <Badge tone="warning">
                      <AlertTriangle className="mr-1 size-3" /> Ev sahibine iletildi
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {c.messages.map((m) => {
                  // Three distinct senders: the guest, the bot ("Lixus AI"), and
                  // the human host (any other outbound senderName → "Siz").
                  const role =
                    m.direction === "inbound" ? "guest" : m.senderName === "Lixus AI" ? "ai" : "host";
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
                <GuestChatReply conversationId={c.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
