import { prisma } from "@/lib/db";
import { badRequest, jsonOk, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { serializeSupplyProfile } from "@/lib/supply";

// Apply one supply/linen profile to ALL of the org's properties at once — most
// apartments in a portfolio share the same linen/consumable setup, so a host with
// 20 flats fills it once and copies rather than clicking through each one. Mirrors
// bulk-times. Org-scoped (no IDOR); overwrites existing per-property profiles.
export const POST = withManage(async (session, req) => {
  const data = (await readJsonCappedOrNull(req)) as
    | { supplyProfile?: unknown; propertyIds?: unknown }
    | null;
  if (!data || typeof data !== "object" || typeof data.supplyProfile !== "object" || data.supplyProfile === null) {
    return badRequest({ _: "Geçerli bir malzeme profili gerekli." });
  }

  // serialize strips unknown keys / zeros / bad values → clean JSON or null.
  const json = serializeSupplyProfile(data.supplyProfile as Record<string, number>);

  // Optional target subset: when propertyIds is an array, apply ONLY to those
  // (empty array → none). Absent → all of the org's properties. The org-scoped
  // where clause means a foreign id can never match (no IDOR).
  const ids = Array.isArray(data.propertyIds)
    ? data.propertyIds.filter((x): x is string => typeof x === "string")
    : null;
  const where =
    ids !== null
      ? { organizationId: session.organizationId, id: { in: ids } }
      : { organizationId: session.organizationId };

  const result = await prisma.property.updateMany({ where, data: { supplyProfileJson: json } });

  return jsonOk({ ok: true, updated: result.count });
});
