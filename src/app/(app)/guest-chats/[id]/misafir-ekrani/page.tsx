import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { GUEST_CHAT_MESSAGE_WINDOW, resolveGuestChat } from "@/lib/guest-chat";
import { INTERNAL_THREAD_PREFIX } from "@/lib/channels/outbound";
import { guestChatDisplayRole } from "@/lib/message-author";
import {
  GUEST_ASSISTANT_TITLE,
  GUEST_CHAT_CLOSED,
  GUEST_CHAT_DISCLOSURE,
  GUEST_CHAT_FOOTER,
  GUEST_CHAT_INTRO,
  GuestChatThread,
  type GuestChatMessage,
} from "@/components/guest-chat/guest-chat-thread";

export const dynamic = "force-dynamic";

/** Misafirin şu anki ekran durumu (misafir sayfasının kendi kuralıyla, salt okuma). */
type GuestScreenState = "open" | "closed" | "unavailable";

const STATE_LINE: Record<GuestScreenState, string> = {
  open: "Konaklama sürüyor: misafir bu sohbeti görüyor ve yazabiliyor.",
  closed: "Konaklama sürmüyor: misafirin ekranında sohbet kapalı görünür, yeni mesaj yazamaz.",
  unavailable: "Karekod sohbeti şu an kapalı: misafir “Bu sohbet şu anda kullanılamıyor” ekranını görür.",
};

/**
 * "MİSAFİRİN GÖRDÜĞÜ EKRAN" ÖNİZLEMESİ — K14 (kurucu kararı 09-30). YALNIZ GÖRÜNTÜLEME:
 *  · misafirin sayfası (`/c/[token]`) ve uçları (`/api/chat/…`) HİÇ çağrılmaz → cihaz bağlama, PIN, okundu işareti YOK
 *    (destek görünümünde de güvenli: misafirin sohbeti bu cihaza kilitlenmez);
 *  · yazma kutusu çizilmez — yerine not; bu sayfa hiçbir satır yazmaz (test ile pinli);
 *  · mesaj penceresi ve rol eşlemesi misafirin GET ucuyla AYNI (`GUEST_CHAT_MESSAGE_WINDOW`, tam sıra, `guestChatDisplayRole`),
 *    balonlar misafir ekranının AYNI bileşeninden (`GuestChatThread`) — önizleme misafirin gördüğünden ayrışamaz.
 * Erişim konuşma sayfasıyla aynı: sahip / yönetici; başka işletmenin konuşması 404.
 */
export default async function GuestScreenPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerSession();
  if (session.role !== "owner" && session.role !== "manager") redirect("/dashboard");
  const { id } = await params;

  const convo = await prisma.conversation.findFirst({
    where: { id, channel: "chat", property: { organizationId: session.organizationId } },
    select: {
      id: true,
      externalReservationId: true,
      property: { select: { id: true, name: true, chatToken: true } },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: GUEST_CHAT_MESSAGE_WINDOW,
        select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
      },
    },
  });
  if (!convo) notFound();

  const messages: GuestChatMessage[] = convo.messages
    .slice()
    .reverse()
    .map((m) => ({ id: m.id, role: guestChatDisplayRole(m), text: m.body }));

  // Misafirin ŞU ANKİ durumu — misafir sayfasıyla aynı çözücü (okuma; bilgi tabanı çekilmez). Bu konuşma yalnız o anki
  // konaklamanın sohbetiyse "açık" (misafirin GET ucunun kullandığı işaretin birebir aynısı).
  const ctx =
    process.env.GUEST_CHAT_ENABLED === "1" && convo.property.chatToken
      ? await resolveGuestChat(convo.property.chatToken, undefined, { knowledgeBase: false })
      : null;
  const state: GuestScreenState = !ctx
    ? "unavailable"
    : ctx.open &&
        ctx.activeReservation &&
        convo.externalReservationId === `${INTERNAL_THREAD_PREFIX}${convo.property.id}:${ctx.activeReservation.id}`
      ? "open"
      : "closed";

  return (
    <>
      <PageHeader
        title="Misafirin gördüğü ekran"
        description="Yalnız görüntüleme: buradan mesaj gönderilmez; misafirin cihaz bağlantısı ve okundu bilgisi değişmez."
      >
        <Link href={`/guest-chats/${convo.id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-3.5" /> Sohbete dön
        </Link>
      </PageHeader>

      <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Eye className="mt-0.5 size-4 shrink-0" />
        <span>{STATE_LINE[state]}</span>
      </p>

      {/* Telefon çerçevesi: misafirin ekranıyla aynı başlık / akış / altbilgi. */}
      <div className="mx-auto flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <header className="border-b border-border bg-card px-4 py-3">
          <p className="text-sm font-semibold">{GUEST_ASSISTANT_TITLE}</p>
          <p className="text-xs text-muted-foreground">{GUEST_CHAT_DISCLOSURE}</p>
        </header>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && state !== "closed" ? (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{GUEST_CHAT_INTRO}</div>
          ) : null}
          {state === "closed" ? (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{GUEST_CHAT_CLOSED}</div>
          ) : null}
          <GuestChatThread messages={messages} />
        </div>
        {state === "open" ? (
          // Yazma kutusunun YERİ — form / düğme yok (önizlemeden hiçbir şey gönderilemez).
          <div className="border-t border-border bg-card p-3 text-center text-xs text-muted-foreground">
            Misafir bu alana yazar. Önizlemeden mesaj gönderilmez.
          </div>
        ) : null}
        <footer className="bg-card px-4 pb-4 pt-2 text-center text-[11px] text-muted-foreground">{GUEST_CHAT_FOOTER}</footer>
      </div>
    </>
  );
}
