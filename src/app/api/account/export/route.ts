import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { buildOrganizationDataExport } from "@/lib/data-export";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK m.11 SELF-SERVE data access — the HOST exports THEIR OWN organization's
// data (no operator needed). Scoped strictly to session.organizationId. The
// payload comes from the SINGLE-SOURCE allowlist builder shared with the
// operator route (src/lib/data-export.ts) — see there for the exact scope and
// the secrets-exclusion contract; a parity test pins the two routes together.
// ---------------------------------------------------------------------------
export const GET = withManage(async (session) => {
  // OWNER-ONLY (Codex): the export carries the org's calendar-feed URLs
  // (bearer-like credentials), invoices and consent evidence — manager-level
  // access is not enough for a full-account data handover. withManage already
  // 403s staff; this narrows the remaining manager case.
  if (session.role !== "owner") return forbidden();
  const orgId = session.organizationId;
  const payload = await buildOrganizationDataExport(orgId);
  if (!payload) return forbidden();

  await writeAudit({
    organizationId: orgId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export_self",
    metadata: { email: session.email },
  });

  const safeName = payload.organization.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-verilerim-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...payload }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a proxy/browser cache a file full of credentials + PII.
      "Cache-Control": "no-store",
    },
  });
});
