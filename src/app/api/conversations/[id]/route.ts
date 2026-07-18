import { prisma } from "@/lib/db";
import { conversationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

// Guest conversations are owner/manager-only (staff must not read guest messages or
// re-triage threads): both PATCH (status/priority) and DELETE are withManage.
export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!existing) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = conversationUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const conversation = await prisma.conversation.update({
    where: { id },
    data: parsed.data,
  });
  return jsonOk(conversation);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const existing = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!existing) return notFound();

  // Remove the messages first, then the conversation (no DB-level cascade).
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: id } }),
    prisma.conversation.delete({ where: { id } }),
  ]);
  return jsonOk({ deleted: true });
});
