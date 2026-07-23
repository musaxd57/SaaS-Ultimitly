import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, badRequest } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { writeAudit } from "@/lib/audit";
import { buildOrganizationDataExport } from "@/lib/data-export";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK / GDPR data export — SUPER-ADMIN ONLY. Returns a downloadable JSON dump
// of ONE organization's data so the operator can satisfy a host's data-access
// request. Read-only. The payload is the SAME single-source allowlist builder
// as the owner's self-serve /api/account/export (src/lib/data-export.ts): the
// operator answer to a data-access request must never be NARROWER than the
// self-serve one (it used to omit billing/consents/audit/risk/delivery). A
// parity test pins both routes to identical structures; secrets are excluded
// by the builder's allowlists. The export itself is audit-logged.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
  if (!orgId) return badRequest({ orgId: "orgId gerekli" });

  const payload = await buildOrganizationDataExport(orgId);
  if (!payload) return badRequest({ orgId: "İşletme bulunamadı." });

  await writeAudit({
    organizationId: orgId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export",
    metadata: { operatorEmail: session.actorEmail ?? session.email },
  });

  const safeName = payload.organization.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-export-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...payload }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a proxy/browser cache a file full of guest PII (parity with the
      // self-service account/export route).
      "Cache-Control": "no-store",
    },
  });
}
