import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const properties = await prisma.property.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(properties);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    const data = await req.json().catch(() => null);
    const parsed = propertySchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;
    const property = await prisma.property.create({
      data: {
        organizationId: session.organizationId,
        name: d.name,
        address: d.address || null,
        city: d.city || null,
        country: d.country || null,
        checkInTime: d.checkInTime,
        checkOutTime: d.checkOutTime,
        cleaningBufferMinutes: d.cleaningBufferMinutes,
        notes: d.notes || null,
      },
    });
    return jsonOk(property, 201);
  } catch {
    return serverError();
  }
}
