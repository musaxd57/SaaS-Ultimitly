import { jsonOk, notFound, forbidden, serverError } from "@/lib/api";
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
// OWNER ONLY (Codex hardening): the action is irreversible and legally loaded,
// so it is stricter than withManage's owner+manager — a manager gets 403.
// Strictly org-scoped: the erasure lib itself re-binds the reservation to the
// caller's org (cross-org id → null → generic 404, fail closed). Dormant unless
// GUEST_ERASURE_ENABLED=1 (the ingress GUARDS are always on; only this request
// surface is gated). The audit records counts ONLY — never guest identifiers.
// ---------------------------------------------------------------------------

export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!guestErasureEnabled()) return notFound(); // feature dormant → invisible
  if (session.role !== "owner") return forbidden();
  const { id } = await params;
  const scope = await previewReservationErasure(session.organizationId, id);
  if (!scope) return notFound();
  return jsonOk({ ok: true, scope });
});

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!guestErasureEnabled()) return notFound();
  if (session.role !== "owner") return forbidden();
  const { id } = await params;
  try {
    const scope = await eraseReservationData(session.organizationId, id);
    if (!scope) return notFound();

    // Legal requirement (Deletion Regulation art. 7: destruction operations are
    // LOGGED and kept ≥3 years). Metadata = the opaque reservationId + counts;
    // NO guest identifiers (name/contact/body). This audit is MANDATORY, so a
    // write failure must be surfaced (reportError), not silently swallowed — the
    // erasure itself already committed, so we don't fail the response, but ops
    // must see the missing legal record and can re-record it.
    try {
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "kvkk.guest_erasure",
        metadata: {
          reservationId: scope.reservationId, // opaque row id — not personal data
          conversations: scope.conversations,
          inboundMessages: scope.inboundMessages,
          outboundMessages: scope.outboundMessages,
          tombstoneKeys: scope.tombstoneKeys,
        },
      });
    } catch (auditErr) {
      const { reportError } = await import("@/lib/report-error");
      void reportError(`kvkk.guest_erasure audit FAILED res:${scope.reservationId}`, auditErr).catch(() => {});
    }

    return jsonOk({ ok: true, scope });
  } catch (err) {
    return serverError(undefined, err);
  }
});
