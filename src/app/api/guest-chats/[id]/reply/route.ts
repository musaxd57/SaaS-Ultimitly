import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, canManage, forbidden, jsonOk, badRequest, notFound } from "@/lib/api";
import { claimOutboundSend } from "@/lib/outbound-claim";
import { AI_RESUME_MARKER } from "@/lib/guest-chat";

// senderName also carries handoff-marker IDENTITY on a qr-chat thread — "Lixus AI"
// is the bot, AI_RESUME_MARKER is the "AI re-enabled" marker. A host whose account
// name equals one of these must NOT be able to masquerade as a marker (which keys
// the AI pause/resume state), so a colliding name is stored as a safe label. The
// guest never sees the name anyway — they see the role-based "İşletme ekibi".
const RESERVED_MARKER_NAMES = new Set<string>(["Lixus AI", AI_RESUME_MARKER]);

// The host replies to a QR guest-chat thread from the "Misafir Sohbetleri" tab.
// The reply is stored as an OUTBOUND message with the host's name (so it's shown
// as "Ev sahibiniz" — distinct from the bot's "Lixus AI" — on the guest's chat
// page when they reopen it). Owner/manager only, strictly org-scoped, and only on
// a qr-chat ("chat") thread.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return badRequest({ body: "Bir mesaj yazın." });
  if (text.length > 2000) return badRequest({ body: "Mesaj çok uzun (en fazla 2000 karakter)." });

  const convo = await prisma.conversation.findFirst({
    where: { id, channel: "chat", property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!convo) return notFound();

  // Duplicate guard: a double-click must not put the same host reply in the
  // guest's thread twice. (Internal thread — nothing external is sent, so no
  // release path is needed; the short TTL self-heals a failed create.)
  const claimed = await claimOutboundSend(convo.id, text);
  if (claimed === "duplicate") {
    return NextResponse.json({ error: "Bu mesaj az önce gönderildi." }, { status: 409 });
  }
  if (claimed === "unavailable") {
    return NextResponse.json({ error: "Şu anda kaydedilemedi — birazdan tekrar deneyin." }, { status: 503 });
  }

  // Reserved-name guard: never let a host reply be mis-typed as a bot/resume marker.
  const senderName = RESERVED_MARKER_NAMES.has(session.name.trim()) ? "İşletme ekibi" : session.name;

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: convo.id,
        direction: "outbound",
        senderName, // human host → guest sees the role-based "İşletme ekibi" (never "Lixus AI")
        body: text,
        language: "tr",
      },
    }),
    prisma.conversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  return jsonOk(message, 201);
}
