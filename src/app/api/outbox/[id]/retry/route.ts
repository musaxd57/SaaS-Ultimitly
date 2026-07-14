import { NextResponse } from "next/server";
import { withManage } from "@/lib/route-guard";
import { requeueFailedOutbox } from "@/lib/outbox/ops";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Tenant-bound MANUAL retry for ONE definitively-failed outbox row (#8 ops
// screen). Owner/manager only (withManage → staff 403); the org id comes from
// the session, never the request, and the guarded update re-checks tenant +
// `failed` status + the not-402 class atomically — so a crafted id (IDOR), a
// double click, or a race with the worker can never blind-resend a row that
// may have been delivered (`review`/`ambiguous`), hammer a paused subscription
// (`blocked` / legacy failed-402 → 409), or touch another org's queue (404).
// The audit entry carries only the outbox id — no body, no guest data.
// ---------------------------------------------------------------------------

export const POST = withManage<{ id: string }>(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  const result = await requeueFailedOutbox(session.organizationId, id);

  if (result.outcome === "not_found") {
    return NextResponse.json({ error: "Kayıt bulunamadı." }, { status: 404 });
  }
  if (result.outcome === "not_retryable") {
    return NextResponse.json(
      {
        error:
          "Bu kayıt yeniden kuyruğa alınamaz — yalnız kesin gönderilememiş (failed) kayıtlar tekrar denenebilir.",
        status: result.status,
      },
      { status: 409 },
    );
  }

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    action: "outbox.manual_retry",
    metadata: { outboxId: id },
  });
  return NextResponse.json({ ok: true, status: "pending" });
});
