import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, unauthorized, badRequest, jsonOk, notFound, serverError, canManage, forbidden } from "@/lib/api";
import { zodFieldErrors } from "@/lib/validators";

type Params = { params: Promise<{ id: string }> };

// Bounds mirror templateCreateSchema (templates/route.ts) so an update can't
// store an unbounded payload the create path would have rejected.
const templateUpdateSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  body: z.string().min(2).max(20000).optional(),
  category: z.string().max(80).optional(),
  language: z.string().max(10).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;

  try {
    const existing = await prisma.messageTemplate.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = templateUpdateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const template = await prisma.messageTemplate.update({
      where: { id },
      data: parsed.data,
    });
    return jsonOk(template);
  } catch {
    return serverError();
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;

  const result = await prisma.messageTemplate.deleteMany({
    where: { id, organizationId: session.organizationId },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
}
