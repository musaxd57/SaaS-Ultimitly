import { prisma } from "@/lib/db";
import { jsonOk, forbidden } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Reset the per-stay QR chat DEVICE binding for one apartment. The concierge binds
// the chat to the first device that opens it each stay, so a guest who loses that
// device's cookie (cleared cookies, switched phone) is locked out until checkout.
// This clears the binding for the apartment's stays → the next device to open the
// chat re-claims it. Owner/manager only (withManage), strictly org-scoped. No PII
// touched (only a hash + timestamp are cleared).
export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;

  // Org scope: a manager can only ever touch their OWN organization's apartment.
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!property) return forbidden();

  // Clear the binding on any still-bound reservation for this apartment. A departed
  // stay's binding is already irrelevant (its chat is closed), so clearing all
  // bound rows is harmless and keeps this simple; the active stay re-binds on the
  // next open.
  const { count } = await prisma.reservation.updateMany({
    where: { propertyId: property.id, chatBoundHash: { not: null } },
    data: { chatBoundHash: null, chatBoundAt: null },
  });

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "guest_chat.reset_binding",
    metadata: { propertyId: property.id, cleared: count },
  }).catch(() => {});

  return jsonOk({ reset: count });
});
