import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, canManage, forbidden, jsonOk, badRequest, notFound, readJsonCappedOrNull } from "@/lib/api";
import { claimOutboundSend } from "@/lib/outbound-claim";

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
  const body = (await readJsonCappedOrNull(req)) as { body?: unknown } | null;
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

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: convo.id,
        direction: "outbound",
        // authorType is the RELIABLE handoff classifier; senderName keeps the host's
        // REAL name for display/audit (the guest only ever sees the role-based
        // "İşletme ekibi"), so a colliding name can't masquerade as a bot/resume marker.
        authorType: "host",
        senderName: session.name,
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
