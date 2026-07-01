import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveGuestChat } from "@/lib/guest-chat";
import { GuestChat } from "@/components/guest-chat/guest-chat";

export const dynamic = "force-dynamic";

// Public guest concierge page — never indexed.
export const metadata: Metadata = {
  title: "Misafir Yardım",
  robots: { index: false, follow: false },
};

/**
 * The public page a guest reaches by scanning the in-apartment QR. Mirrors the
 * API's two switches: the global GUEST_CHAT_ENABLED kill-switch and the
 * per-apartment chatEnabled flag (via resolveGuestChat). When either is off, or
 * the token is unknown, it renders a plain 404 — the surface is invisible until
 * an operator turns it on.
 */
export default async function GuestChatPage({ params }: { params: Promise<{ token: string }> }) {
  if (process.env.GUEST_CHAT_ENABLED !== "1") notFound();
  const { token } = await params;
  const ctx = await resolveGuestChat(token);
  if (!ctx) notFound();

  // Closed outside an active stay (vacant / before check-in / after checkout).
  if (!ctx.open) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-semibold">{ctx.property.name}</p>
        <p className="text-sm text-muted-foreground">
          Şu an aktif bir konaklama görünmüyor; sohbet kapalı. Bir konaklamanız
          varsa giriş gününüzde bu sayfadan tekrar ulaşabilirsiniz.
        </p>
      </div>
    );
  }

  return <GuestChat token={token} propertyName={ctx.property.name} />;
}
