import { prisma } from "@/lib/db";
import { jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { qrPinEnabled, setReservationPin, clearReservationPin } from "@/lib/guest-chat-pin";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Per-reservation QR concierge PIN — HOST management (Faz 5, #14).
//   POST   → generate/regenerate the PIN, return the plaintext ONCE.
//   DELETE → remove the PIN (the stay falls back to no-PIN behavior).
//
// OWNER/MANAGER only (withManage — staff never see the credential) and strictly
// org-scoped (a manager can only ever touch their OWN organization's stay;
// a cross-org id fails closed with a generic 404). The audit trail records the
// action but NEVER the PIN. Dormant unless the global QR_PIN_ENABLED switch is on.
// ---------------------------------------------------------------------------

/** The reservation must belong to the caller's org (fail-closed tenant bind). */
async function findScoped(id: string, orgId: string): Promise<{ id: string } | null> {
  return prisma.reservation.findFirst({
    where: { id, property: { organizationId: orgId } },
    select: { id: true },
  });
}

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!qrPinEnabled()) return notFound(); // feature dormant → invisible
  const { id } = await params;
  if (!(await findScoped(id, session.organizationId))) return notFound();

  const pin = await setReservationPin(id);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "guest_chat.pin_set",
    // NEVER the PIN — only that it was (re)generated for this reservation.
    metadata: { reservationId: id },
  }).catch(() => {});

  // The plaintext PIN leaves the server exactly here (shown once to the host).
  return jsonOk({ ok: true, pin, chatPinSetAt: new Date().toISOString() });
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!qrPinEnabled()) return notFound();
  const { id } = await params;
  if (!(await findScoped(id, session.organizationId))) return notFound();

  await clearReservationPin(id);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "guest_chat.pin_clear",
    metadata: { reservationId: id },
  }).catch(() => {});

  return jsonOk({ ok: true });
});
