import { prisma } from "@/lib/db";
import { kbUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.knowledgeBaseItem.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!existing) return notFound();

  const data = await req.json().catch(() => null);
  const parsed = kbUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const item = await prisma.knowledgeBaseItem.update({
    where: { id },
    data: parsed.data,
  });
  return jsonOk(item);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await prisma.knowledgeBaseItem.deleteMany({
    where: { id, property: { organizationId: session.organizationId } },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
