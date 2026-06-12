import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
        description="Daireye asılan QR'dan gelen sohbetler — misafirin sorusu ve AI'ın yanıtı. Mesajlar (Airbnb) sekmesinden ayrı tutulur. Buradan bilgi tabanınızı güçlendirebilirsiniz."
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
                  const fromGuest = m.direction === "inbound";
                  return (
                    <div key={m.id} className={fromGuest ? "flex justify-start" : "flex justify-end"}>
                      <div
                        className={
                          fromGuest
                            ? "max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm"
                            : "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p
                          className={
                            fromGuest
                              ? "mt-0.5 text-[10px] text-muted-foreground"
                              : "mt-0.5 text-[10px] text-primary-foreground/70"
                          }
                        >
                          {fromGuest ? "Misafir" : "Lixus AI"} · {formatDateTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
