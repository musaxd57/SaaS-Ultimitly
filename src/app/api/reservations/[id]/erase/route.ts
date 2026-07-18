import { jsonOk, notFound, serverError } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import {
  guestErasureEnabled,
  previewReservationErasure,
  eraseReservationData,
} from "@/lib/erasure";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// KVKK guest-level EXPLICIT erasure (m40) — host management surface.
//   GET  → scope preview (what would be scrubbed) — no writes.
//   POST → execute: tombstones + irreversible scrub (same mechanic as the
//          retention sweep) in one transaction. See src/lib/erasure.ts.
//
// OWNER/MANAGER only (withManage) and strictly org-scoped: the erasure lib
// itself re-binds the reservation to the caller's org (cross-org id → null →
// generic 404, fail closed). Dormant unless GUEST_ERASURE_ENABLED=1 (the
// ingress GUARDS are always on; only this request surface is gated).
// The audit records counts ONLY — never the guest's identifiers.
// ---------------------------------------------------------------------------

export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!guestErasureEnabled()) return notFound(); // feature dormant → invisible
  const { id } = await params;
  const scope = await previewReservationErasure(session.organizationId, id);
  if (!scope) return notFound();
  return jsonOk({ ok: true, scope });
});

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!guestErasureEnabled()) return notFound();
  const { id } = await params;
  try {
    const scope = await eraseReservationData(session.organizationId, id);
    if (!scope) return notFound();

    // Legal requirement (Deletion Regulation art. 7: destruction operations are
    // logged and kept ≥3 years) — counts only, no personal data.
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "kvkk.guest_erasure",
      metadata: {
        reservationId: scope.reservationId,
        conversations: scope.conversations,
        inboundMessages: scope.inboundMessages,
        outboundMessages: scope.outboundMessages,
        tombstoneKeys: scope.tombstoneKeys,
      },
    }).catch(() => {});

    return jsonOk({ ok: true, scope });
  } catch (err) {
    return serverError(undefined, err);
  }
});
