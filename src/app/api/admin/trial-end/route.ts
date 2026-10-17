import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull, forbidden } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { endTrialByOperator, restoreOperatorEndedTrial } from "@/lib/billing/trial-operator";

// ---------------------------------------------------------------------------
// Operatör paneli: DENEMEYİ BİTİR / GERİ VER (kurucu Q4, 10-17). Gövde: işletme kimliği + işlem ("end" | "restore"). Kurallar
// `lib/billing/trial-operator.ts`te. Yalnız süper-admin (allowlist + 2FA); destek görünümünde (bürünme) yazma YOK; her işlem denetimde.
// Süren deneme yoksa / geri verilecek (operatörün bitirdiği) deneme yoksa 409.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);

  const limited = await rateLimit(`admin-trial-end:${session.actorUserId ?? session.userId}`, 30, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = (await readJsonCappedOrNull(req)) as { organizationId?: unknown; action?: unknown } | null;
  const organizationId = typeof data?.organizationId === "string" ? data.organizationId.trim() : "";
  if (!organizationId || organizationId.length > 64) return badRequest({ organizationId: "İşletme kimliği gerekli." });
  const action = data?.action === "end" ? "end" : data?.action === "restore" ? "restore" : null;
  if (!action) return badRequest({ action: "İşlemi seçin." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return notFound();

  const actor = session.actorUserId ?? session.userId;
  const r = action === "end" ? await endTrialByOperator(organizationId, actor) : await restoreOperatorEndedTrial(organizationId, actor);
  if (!r.ok) {
    return Response.json(
      { error: r.reason === "not_running" ? "Bu işletmenin süren bir denemesi yok." : "Geri verilecek bir deneme yok.", code: r.reason },
      { status: 409 },
    );
  }
  return jsonOk({ ok: true });
}
