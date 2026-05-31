import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { waSendText } from "@/lib/whatsapp";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
} from "@/lib/api";
import { translateText } from "@/lib/ai/translate";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true, channel: true, guestIdentifier: true },
    });
    if (!conversation) return notFound();

    const rawData = await req.json().catch(() => null);
    const parsed = conversationReplySchema.safeParse(rawData);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    // Optional: translate the reply before saving
    const translateTo: string | undefined =
      typeof rawData?.translateTo === "string" && rawData.translateTo.trim()
        ? rawData.translateTo.trim()
        : undefined;

    let replyBody = parsed.data.body;
    if (translateTo) {
      replyBody = await translateText(replyBody, translateTo);
    }

    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: id,
          direction: "outbound",
          senderName: parsed.data.senderName || session.name,
          body: replyBody,
        },
      }),
      prisma.conversation.update({
        where: { id },
        data: { status: "answered", lastMessageAt: now },
      }),
    ]);

    // If this is a WhatsApp conversation, attempt to deliver via the Cloud API.
    // guestIdentifier is the guest's E.164 phone number for WA channels.
    if (conversation.channel === "whatsapp" && conversation.guestIdentifier) {
      void waSendText(conversation.guestIdentifier, parsed.data.body);
    }

    return jsonOk(message, 201);
  } catch {
    return serverError();
  }
}
