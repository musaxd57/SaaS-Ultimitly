import { jsonOk, notFound, forbidden, serverError } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import {
  guestErasureEnabled,
  previewReservationErasure,
  eraseReservationData,
} from "@/lib/erasure";

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
    // The MANDATORY audit (Deletion Regulation art. 7: destruction is LOGGED) is
    // now written INSIDE the erasure transaction (see eraseReservationData) so the
    // scrub + tombstones + legal record commit atomically — we never destroy
    // without a log. If the audit can't be written the whole erasure rolls back and
    // this throws → 500 below, and the owner retries. The audit records COUNTS ONLY,
    // never guest identifiers.
    const scope = await eraseReservationData(session.organizationId, id, {
      actorUserId: session.userId,
    });
    if (!scope) return notFound();
    return jsonOk({ ok: true, scope });
  } catch (err) {
    return serverError(undefined, err);
  }
});
