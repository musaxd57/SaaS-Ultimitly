import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { sendOnChannel } from "@/lib/messaging";
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
      select: {
        id: true,
        channel: true,
        guestIdentifier: true,
        externalReservationId: true,
      },
    });
    if (!conversation) return notFound();

    const rawData = await req.json().catch(() => null);
    const parsed = conversationReplySchema.safeParse(rawData);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    // Optional: translate the reply before sending/saving.
    const translateTo: string | undefined =
      typeof rawData?.translateTo === "string" && rawData.translateTo.trim()
        ? rawData.translateTo.trim()
        : undefined;

    let replyBody = parsed.data.body;
    if (translateTo) {
      replyBody = await translateText(replyBody, translateTo);
    }

    // Deliver on the guest's channel FIRST — don't persist a reply that never
    // reached the guest (Airbnb/Booking via Hospitable, or WhatsApp).
    const outcome = await sendOnChannel(conversation, replyBody);
    if (!outcome.ok) {
      return NextResponse.json(
        { error: `Mesaj gönderilemedi: ${outcome.error ?? "bilinmeyen hata"}` },
        { status: 502 },
      );
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

    return jsonOk(message, 201);
  } catch {
    return serverError();
  }
}
