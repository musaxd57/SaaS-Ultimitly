import { forbidden, jsonOk, notFound, requireSession, unauthorized } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { licensesEnabled } from "@/lib/licenses/secret";
import { operatorLicenseQueue } from "@/lib/licenses/read";

// ---------------------------------------------------------------------------
// Operatör: İŞLETME BELGESİ KUYRUĞU (Faz 1a). Açık başvurular + yeniden okunması gereken doğrulanmış belgeler. Yalnız süper-admin
// (allowlist + 2FA); destek görünümünde (bürünme) kapalı. Vergi numarası yalnız maskeli; "başka hesapta doğrulanmış" bilgisi YALNIZ burada.
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);
  if (!licensesEnabled()) return notFound();
  return jsonOk(await operatorLicenseQueue());
}
