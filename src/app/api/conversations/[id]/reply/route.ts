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

type Params = { params: Promise<{ id: string }> };

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

    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: id,
          direction: "outbound",
          senderName: parsed.data.senderName || session.name,
          body: parsed.data.body,
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
