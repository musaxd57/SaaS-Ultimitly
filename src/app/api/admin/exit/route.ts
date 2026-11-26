import { type NextRequest } from "next/server";
import { requireSession, unauthorized, forbidden, jsonOk, serverError } from "@/lib/api";
import { exitImpersonation } from "@/lib/admin";
import { crossSiteWrite } from "@/lib/route-guard";

// Leave impersonation and restore the operator's own session. Authenticated by
// the signed actorUserId already in the session — no super-admin check needed to
// step DOWN out of a customer org.
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  // Gövdesiz yazma: başka siteden gelen istek operatörü destek görünümünden çıkaramaz (`withAuth` ile aynı kural).
  if (crossSiteWrite(req)) return forbidden();
  try {
    await exitImpersonation();
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
