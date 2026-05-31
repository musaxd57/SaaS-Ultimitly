import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { aiSuggestSchema } from "@/lib/validators";
import { suggestReply } from "@/lib/ai";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
} from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      include: {
        property: true,
        reservation: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversation) return notFound();

    const parsed = aiSuggestSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    const tone = parsed.success ? parsed.data.tone : "warm";

    const lastInbound = [...conversation.messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    if (!lastInbound) {
      return badRequest({ _: "Öneri üretmek için bir misafir mesajı gerekli" });
    }

    const kb = await prisma.knowledgeBaseItem.findMany({
      where: { propertyId: conversation.propertyId, isActive: true },
      select: { category: true, title: true, content: true },
    });

    const result = await suggestReply({
      guestMessage: lastInbound.body,
      property: {
        name: conversation.property.name,
        checkInTime: conversation.property.checkInTime,
        checkOutTime: conversation.property.checkOutTime,
        address: conversation.property.address,
        city: conversation.property.city,
      },
      reservation: conversation.reservation
        ? {
            guestName: conversation.reservation.guestName,
            arrivalDate: conversation.reservation.arrivalDate,
            departureDate: conversation.reservation.departureDate,
            status: conversation.reservation.status,
          }
        : null,
      knowledgeBase: kb,
      history: conversation.messages.map((m) => ({
        direction: m.direction as "inbound" | "outbound",
        body: m.body,
      })),
      tone,
      language: lastInbound.language || "tr",
    });

    await prisma.message.update({
      where: { id: lastInbound.id },
      data: {
        aiSuggestedReply: result.reply,
        aiConfidence: result.confidence,
        aiIntent: result.intent,
      },
    });

    return jsonOk(result);
  } catch {
    return serverError();
  }
}
