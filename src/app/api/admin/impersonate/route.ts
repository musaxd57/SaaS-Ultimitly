import { type NextRequest } from "next/server";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";
import { isSuperAdmin, enterOrganization } from "@/lib/admin";

// ---------------------------------------------------------------------------
// Operator panel: "enter" (impersonate) a customer organization. SUPER-ADMIN
// ONLY — this swaps the active session into the customer's context so the
// operator can run their inbox/settings. The real operator is preserved in the
// session's (signed) actor fields so they keep super-admin powers and can exit.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  try {
    const data = await req.json().catch(() => null);
    const organizationId = typeof data?.organizationId === "string" ? data.organizationId : "";
    if (!organizationId) return badRequest({ organizationId: "organizationId gerekli" });

    const ok = await enterOrganization(session, organizationId);
    if (!ok) return badRequest({ organizationId: "Bu işletmeye ait kullanıcı bulunamadı." });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
