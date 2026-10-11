import { type NextRequest } from "next/server";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, readJsonCappedOrNull, tooManyRequests, forbidden } from "@/lib/api";
import { isSuperAdmin, enterOrganization } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { rateLimit } from "@/lib/rate-limit";

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
  // Destek görünümünde operatör yazması YOK — önce çıkış (kurucu kararı 10-11; `OPERATOR_SUPPORT_VIEW_MESSAGE`).
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);
  // Operatör kimliğine bağlı tavan (10-10 gece, Haiku operatör incelemesi): her başarılı çağrı müşteri hesabına giren bir oturum
  // üretir. Sınır otomatik döngüyü / toplu taramayı yavaşlatır; az sayıda işletmeyi gezmeyi DURDURMAZ (bugün ~9 işletme < 30) — asıl
  // tespit her girişin denetim kaydı (`enterOrganization`). Başarısız denemeler de sayılır; meşru destek kullanımında ulaşılmaz.
  const limited = await rateLimit(`admin-impersonate:${session.actorUserId ?? session.userId}`, 30, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  try {
    const data = await readJsonCappedOrNull(req);
    const organizationId = typeof data?.organizationId === "string" ? data.organizationId : "";
    if (!organizationId) return badRequest({ organizationId: "organizationId gerekli" });

    const ok = await enterOrganization(session, organizationId);
    if (!ok) return badRequest({ organizationId: "Bu işletmeye ait kullanıcı bulunamadı." });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
