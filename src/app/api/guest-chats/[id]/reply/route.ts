import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, canManage, forbidden, jsonOk, badRequest, notFound, readJsonCappedOrNull, impersonationReadOnly } from "@/lib/api";
import { claimOutboundSend, releaseOutboundSend } from "@/lib/outbound-claim";
import { acquireGuestChatThreadLock } from "@/lib/guest-chat";

// The host replies to a QR guest-chat thread from the "Misafir Sohbetleri" tab.
// The reply is stored as an OUTBOUND message with the host's name (so it's shown
// as "Ev sahibiniz" — distinct from the bot's "Lixus AI" — on the guest's chat
// page when they reopen it). Owner/manager only, strictly org-scoped, and only on
// a qr-chat ("chat") thread.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  // K8 (kurucu kararı 09-28): bürünmüşken müşteri hesabında yazma yok.
  const readOnly = session ? impersonationReadOnly(session, req.method) : null;
  if (readOnly) return readOnly;
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
  // guest's thread twice. Internal thread — nothing external is sent, so a FAILED
  // write releases the claim at once (Claude 2. dalga #4): otherwise the host's
  // retry within the 120 s TTL got a false "already sent" 409 and the reply was lost.
  const claimed = await claimOutboundSend(convo.id, text);
  if (claimed === "duplicate") {
    return NextResponse.json({ error: "Bu mesaj az önce gönderildi — tekrar gönderilmedi." }, { status: 409 });
  }
  if (claimed === "unavailable") {
    return NextResponse.json({ error: "Mesaj şu anda kaydedilemedi. Lütfen kısa bir süre sonra tekrar deneyin." }, { status: 503 });
  }

  // Per-thread advisory lock (Codex 07-24 #4): serializes this insert against
  // the guest route's paused-recheck+insert transaction, so an AI reply already
  // past its recheck can't slip in AFTER this host reply — and our commit is
  // guaranteed visible to any recheck that runs after us. See guest-chat.ts.
  let message;
  try {
    message = await prisma.$transaction(async (tx) => {
      await acquireGuestChatThreadLock(tx, convo.id);
      const created = await tx.message.create({
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
      });
      await tx.conversation.update({
        where: { id: convo.id },
        data: { lastMessageAt: new Date() },
      });
      return created;
    });
  } catch (err) {
    await releaseOutboundSend(convo.id, text);
    throw err;
  }

  return jsonOk(message, 201);
}
