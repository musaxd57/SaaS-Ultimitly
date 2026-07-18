import { prisma } from "@/lib/db";
import { z } from "zod";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { zodFieldErrors } from "@/lib/validators";

// Bounds mirror templateCreateSchema (templates/route.ts) so an update can't
// store an unbounded payload the create path would have rejected.
const templateUpdateSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  body: z.string().min(2).max(20000).optional(),
  category: z.string().max(80).optional(),
  language: z.string().max(10).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.messageTemplate.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = templateUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const template = await prisma.messageTemplate.update({
    where: { id },
    data: parsed.data,
  });
  return jsonOk(template);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await prisma.messageTemplate.deleteMany({
    where: { id, organizationId: session.organizationId },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
