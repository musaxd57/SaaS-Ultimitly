import { prisma } from "@/lib/db";
import { badRequest, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { serializeSupplyProfile } from "@/lib/supply";

// Update the org's on-hand supply stock { itemKey: qty }. Subtracted from the prep
// plan so /hazirlik shows the NET shortfall. Org-scoped (session), owner/manager only.
export const PATCH = withManage(async (session, req) => {
  const data = (await req.json().catch(() => null)) as { stock?: unknown } | null;
  if (!data || typeof data !== "object" || typeof data.stock !== "object" || data.stock === null) {
    return badRequest({ _: "Geçerli bir stok gövdesi gerekli." });
  }
  const json = serializeSupplyProfile(data.stock as Record<string, number>);
  await prisma.organization.update({
    where: { id: session.organizationId },
    data: { supplyStockJson: json },
  });
  return jsonOk({ ok: true });
});
