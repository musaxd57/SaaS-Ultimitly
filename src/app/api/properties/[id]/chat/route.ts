import { prisma } from "@/lib/db";
import { jsonOk, badRequest, forbidden, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { generateChatToken } from "@/lib/guest-chat";
import { writeAudit } from "@/lib/audit";

// Enable/disable the public guest QR concierge for ONE apartment. Owner/manager
// only (withManage), strictly org-scoped. Enabling lazily mints an unguessable
// token; the token is kept on disable so re-enabling reuses the same (already-
// printed) QR.
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const body = (await readJsonCappedOrNull(req)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return badRequest({ enabled: "enabled alanı boolean olmalı." });
  }

  // Org scope: a manager can only ever touch their OWN organization's apartment.
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, chatToken: true },
  });
  if (!property) return forbidden();

  const data: { chatEnabled: boolean; chatToken?: string } = { chatEnabled: body.enabled };
  if (body.enabled && !property.chatToken) data.chatToken = generateChatToken();

  const updated = await prisma.property.update({
    where: { id: property.id },
    data,
    select: { chatEnabled: true, chatToken: true },
  });

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: body.enabled ? "guest_chat.enable" : "guest_chat.disable",
    metadata: { propertyId: property.id },
  }).catch(() => {});

  return jsonOk(updated);
});
