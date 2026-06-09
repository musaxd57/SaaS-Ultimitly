import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, canManage, forbidden } from "@/lib/api";
import { generateCalendarToken } from "@/lib/export/ics";

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
  if (!canManage(session)) return forbidden();
  try {
    const data = await req.json().catch(() => null);
    const parsed = propertySchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;
    const name = d.name.trim();

    // One property per name within the org — prevents confusing duplicate-named
    // listings. App-level (no DB constraint), so existing data is never touched
    // and the deploy's `prisma db push` can't fail. Sync (linkProperty) is
    // separate and already adopts same-named properties, so it's unaffected.
    const dupe = await prisma.property.findFirst({
      where: { organizationId: session.organizationId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (dupe) return badRequest({ name: "Bu isimde bir mülk zaten var" });

    const property = await prisma.property.create({
      data: {
        organizationId: session.organizationId,
        name,
        address: d.address || null,
        city: d.city || null,
        country: d.country || null,
        checkInTime: d.checkInTime,
        checkOutTime: d.checkOutTime,
        cleaningBufferMinutes: d.cleaningBufferMinutes,
        notes: d.notes || null,
        icalToken: generateCalendarToken(),
      },
    });
    return jsonOk(property, 201);
  } catch {
    return serverError();
  }
}
