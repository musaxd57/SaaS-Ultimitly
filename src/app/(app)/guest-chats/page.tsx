import { redirect } from "next/navigation";
import { AlertTriangle, QrCode, Building2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { GuestChatReply } from "@/components/guest-chats/reply-box";
import { GuestChatResumeAi } from "@/components/guest-chats/resume-ai-button";
import { guestChatAiPausedFromMessages } from "@/lib/guest-chat";
import { guestChatDisplayRole } from "@/lib/message-author";
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

  const rows = await prisma.conversation.findMany({
    where: { property: { organizationId: session.organizationId }, channel: "chat" },
    include: {
      property: { select: { name: true } },
      reservation: { select: { guestName: true, arrivalDate: true, departureDate: true } },
      // Bounded per thread (07-20 perf audit): messages-per-thread is otherwise
      // unbounded, so 200 threads × a chatty stay ballooned both the query payload
      // and the rendered DOM. Take the LAST 100 (desc) and flip back to
      // chronological below — a QR stay virtually never exceeds that.
      messages: { orderBy: { createdAt: "desc" }, take: 100 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });
  const conversations = rows.map((c) => ({ ...c, messages: c.messages.slice().reverse() }));

  return (
    <>
      <PageHeader
        title="Misafir Sohbetleri"
        description="Daireye asılan QR'dan gelen sohbetler — misafirin sorusu, AI'ın yanıtı ve sizin yanıtlarınız. Mesajlar (Airbnb) sekmesinden ayrı tutulur. Buradan misafire siz de yazabilirsiniz."
      />

      {conversations.length === 0 ? (
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
      ) : (
        <div className="space-y-4">
          {conversations.map((c) => {
            // Handoff state (migration-free): paused once a host replies, until they
            // explicitly re-enable the AI (a resume marker). Derived from the thread.
            const aiPaused = guestChatAiPausedFromMessages(c.messages);
            return (
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
                  {aiPaused ? <Badge tone="default">🙋 İnsan desteğinde</Badge> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {c.messages.map((m) => {
                  // Reliable, typed role (authorType) — never the message text/senderName.
                  const role = guestChatDisplayRole(m);
                  // The AI re-enable event is a system separator line, not a chat bubble.
                  if (role === "resume") {
                    return (
                      <div key={m.id} className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
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
                    <GuestChatResumeAi conversationId={c.id} />
                  </div>
                ) : null}
                <GuestChatReply conversationId={c.id} />
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
