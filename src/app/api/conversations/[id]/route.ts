import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { conversationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
} from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const existing = await prisma.conversation.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = conversationUpdateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const conversation = await prisma.conversation.update({
      where: { id },
      data: parsed.data,
    });
    return jsonOk(conversation);
  } catch {
    return serverError();
  }
}
