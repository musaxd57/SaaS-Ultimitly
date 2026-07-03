import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, forbidden } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";
import { generateCalendarToken } from "@/lib/export/ics";
import { canAddProperty } from "@/lib/billing/subscription";

export const GET = withAuth(async (session) => {
  const properties = await prisma.property.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(properties);
});

export const POST = withManage(async (session, req) => {
  const data = await req.json().catch(() => null);
  const parsed = propertySchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const name = d.name.trim();

  // One property per name within the org — prevents confusing duplicate-named
  // listings. App-level (no DB constraint) so existing rows are never touched —
  // adding a DB unique to a populated table is forbidden here (see schema
  // header). Sync (linkProperty) adopts same-named properties separately.
  const dupe = await prisma.property.findFirst({
    where: { organizationId: session.organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (dupe) return badRequest({ name: "Bu isimde bir mülk zaten var" });

  // Plan limit (Faz 2). NON-BLOCKING while billing is dormant: canAddProperty
  // returns { allowed: true } unless BILLING_ENFORCED=true, so this changes
  // nothing today and only gates once the paywall is switched on.
  const gate = await canAddProperty(session.organizationId);
  if (!gate.allowed) {
    const message =
      gate.reason === "property_limit"
        ? `Planınız en fazla ${gate.limit} daireye izin veriyor. Daha fazla daire için planınızı yükseltin.`
        : "Aboneliğiniz aktif değil. Daire eklemek için bir plan seçin.";
    return forbidden(message);
  }

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
});
