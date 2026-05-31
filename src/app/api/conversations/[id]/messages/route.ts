import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
} from "@/lib/api";
import { applyInboundMessageRules } from "@/lib/automation";

type Params = { params: Promise<{ id: string }> };

// Append an INBOUND (guest) message. Represents ingesting a new guest message
// (and is used in the UI to simulate one for testing the AI assistant).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!conversation) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = conversationReplySchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: "inbound",
        senderName: parsed.data.senderName || "Misafir",
        body: parsed.data.body,
      },
    });
    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    });

    const ruled = await applyInboundMessageRules(id, parsed.data.body);
    return jsonOk({ message, ...ruled }, 201);
  } catch {
    return serverError();
  }
}
