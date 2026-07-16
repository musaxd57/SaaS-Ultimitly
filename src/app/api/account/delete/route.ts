import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { clearSessionCookie } from "@/lib/auth";
import {
  requireSession,
  unauthorized,
  badRequest,
  forbidden,
  jsonOk,
  serverError,
  tooManyRequests,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { deleteAccountData } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// PERMANENT account + data erasure (KVKK right-to-erasure / "hesabımı sil").
// The signed-in OWNER deletes their whole organization and everything under it.
// Guarded: owner-only, re-authenticated with the account password, rate-limited,
// and BLOCKED while an operator is impersonating (no nuking a customer's org
// through an impersonation session). Irreversible.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (session.actorUserId) return forbidden("İşletme hesabındayken (impersonation) silme yapılamaz.");
  if (session.role !== "owner") return forbidden("Hesabı yalnızca sahip rolü silebilir.");

  const limited = await rateLimit(`account-delete:${session.userId}`, 5, 15 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await req.json().catch(() => null);
    const password = typeof data?.password === "string" ? data.password : "";
    if (!password) return badRequest({ password: "Onaylamak için şifrenizi girin." });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!ok) return badRequest({ password: "Şifre hatalı." });

    await deleteAccountData(session.organizationId);
    await clearSessionCookie(); // the account is gone — drop the session too
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
