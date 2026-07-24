import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, forbidden, serverError, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { generateCalendarToken } from "@/lib/export/ics";
import { canAddProperty } from "@/lib/billing/subscription";

export const GET = withManage(async (session) => {
  const properties = await prisma.property.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(properties);
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
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

  // Codex #17: the gate above is count-then-create — two concurrent requests at
  // limit-1 could BOTH pass and overshoot the plan. Deterministic post-create
  // reconciliation: order every row by (createdAt, id); if OUR fresh row falls
  // outside the limit, delete it and return the same limit error. The earlier-
  // created racer always survives, so a legitimate single create is never lost.
  // No-op while billing is dormant or the plan is unlimited (gate.limit unset).
  if (gate.limit != null) {
    const rows = await prisma.property.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (rows.findIndex((r) => r.id === property.id) >= gate.limit) {
      try {
        await prisma.property.delete({ where: { id: property.id } });
      } catch (err) {
        // The rollback itself failed: the fresh row is still in the DB, so the
        // org may now sit OVER its plan limit. Never pretend a definitive 403
        // (the row exists) — surface a real 500 and alert ops (serverError →
        // reportError), instead of swallowing the inconsistency silently.
        return serverError("Daire oluşturma doğrulanamadı — lütfen tekrar deneyin.", err);
      }
      return forbidden(
        `Planınız en fazla ${gate.limit} daireye izin veriyor. Daha fazla daire için planınızı yükseltin.`,
      );
    }
  }
  return jsonOk(property, 201);
});
