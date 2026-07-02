import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
  canManage,
  forbidden,
} from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
  });
  if (!property) return notFound();
  return jsonOk(property);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;
  try {
    const existing = await prisma.property.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true, name: true },
    });
    if (!existing) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = propertySchema.partial().safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

    // Block renaming onto another property's name in the same org — but ONLY when
    // the name actually changes, so editing other fields on a property that has a
    // pre-existing duplicate is never blocked.
    if (d.name !== undefined) {
      const newName = d.name.trim();
      if (newName.toLowerCase() !== existing.name.trim().toLowerCase()) {
        const dupe = await prisma.property.findFirst({
          where: {
            organizationId: session.organizationId,
            name: { equals: newName, mode: "insensitive" },
            id: { not: id },
          },
          select: { id: true },
        });
        if (dupe) return badRequest({ name: "Bu isimde bir mülk zaten var" });
      }
    }

    const property = await prisma.property.update({
      where: { id },
      data: {
        name: d.name?.trim(),
        address: d.address === "" ? null : d.address,
        city: d.city === "" ? null : d.city,
        country: d.country === "" ? null : d.country,
        checkInTime: d.checkInTime,
        checkOutTime: d.checkOutTime,
        cleaningBufferMinutes: d.cleaningBufferMinutes,
        notes: d.notes === "" ? null : d.notes,
      },
    });
    return jsonOk(property);
  } catch (err) {
    return serverError(undefined, err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;
  const result = await prisma.property.deleteMany({
    where: { id, organizationId: session.organizationId },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
}
