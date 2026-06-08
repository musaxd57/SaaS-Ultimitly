import { requireSession, unauthorized, jsonOk, serverError } from "@/lib/api";
import { exitImpersonation } from "@/lib/admin";

// Leave impersonation and restore the operator's own session. Authenticated by
// the signed actorUserId already in the session — no super-admin check needed to
// step DOWN out of a customer org.
export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    await exitImpersonation();
    return jsonOk({ ok: true });
  } catch {
    return serverError();
  }
}
