import { prisma } from "@/lib/db";
import { badRequest, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { serializeSupplyProfile } from "@/lib/supply";

// Apply one supply/linen profile to ALL of the org's properties at once — most
// apartments in a portfolio share the same linen/consumable setup, so a host with
// 20 flats fills it once and copies rather than clicking through each one. Mirrors
// bulk-times. Org-scoped (no IDOR); overwrites existing per-property profiles.
export const POST = withManage(async (session, req) => {
  const data = (await req.json().catch(() => null)) as { supplyProfile?: unknown } | null;
  if (!data || typeof data !== "object" || typeof data.supplyProfile !== "object" || data.supplyProfile === null) {
    return badRequest({ _: "Geçerli bir malzeme profili gerekli." });
  }

  // serialize strips unknown keys / zeros / bad values → clean JSON or null.
  const json = serializeSupplyProfile(data.supplyProfile as Record<string, number>);

  const result = await prisma.property.updateMany({
    where: { organizationId: session.organizationId },
    data: { supplyProfileJson: json },
  });

  return jsonOk({ ok: true, updated: result.count });
});
