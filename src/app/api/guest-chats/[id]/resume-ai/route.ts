import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, canManage, forbidden, jsonOk, notFound } from "@/lib/api";
import { AI_RESUME_MARKER, guestChatAiPausedFromMessages } from "@/lib/guest-chat";
import { SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED } from "@/lib/message-author";

// Owner/manager RE-ENABLES the QR AI for a thread it had handed off to the team.
// The AI never auto-resumes on a timer (the host may have stepped into a sensitive
// matter the AI would misread later) — only this explicit action flips it back on.
//
// It records a resume MARKER (an outbound message with the AI_RESUME_MARKER
// senderName) as the newest handoff event, so the guest route treats the AI as
// active again and the guest sees a "Lixus AI yeniden etkinleştirildi" separator.
// Owner/manager only, strictly org-scoped, only on a qr-chat ("chat") thread.
// Idempotent: a no-op (200) when the AI is already active.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();

  const { id } = await params;
  const convo = await prisma.conversation.findFirst({
    where: { id, channel: "chat", property: { organizationId: session.organizationId } },
    select: {
      id: true,
      // Reliable handoff state = authorType timeline (legacy senderName fallback inside).
      messages: {
        orderBy: { createdAt: "asc" },
        select: { direction: true, senderName: true, authorType: true, systemEventType: true },
      },
    },
  });
  if (!convo) return notFound();

  const paused = guestChatAiPausedFromMessages(convo.messages);
  if (!paused) return jsonOk({ ok: true, alreadyActive: true }); // idempotent no-op

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: convo.id,
        direction: "outbound",
        // The resume EVENT — authorType/systemEventType are the reliable signal; the
        // senderName is a display/audit label only (never read for state).
        authorType: "system",
        systemEventType: SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED,
        senderName: AI_RESUME_MARKER,
        body: "Lixus AI yeniden etkinleştirildi",
        language: "tr",
      },
    }),
    prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } }),
  ]);
  return jsonOk({ ok: true }, 201);
}
