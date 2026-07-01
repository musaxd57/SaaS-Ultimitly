import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, canManage, forbidden, jsonOk, badRequest, notFound } from "@/lib/api";

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

  const message = await prisma.message.create({
    data: {
      conversationId: convo.id,
      direction: "outbound",
      senderName: session.name, // human host → shown as "Ev sahibiniz" (not "Lixus AI")
      body: text,
      language: "tr",
    },
  });
  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastMessageAt: new Date() },
  });

  return jsonOk(message, 201);
}
