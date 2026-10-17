import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull, forbidden } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { endTrialByOperator, restoreOperatorEndedTrial, exemptTrialCardGate } from "@/lib/billing/trial-operator";
import { isDemoOrg } from "@/lib/demo-tenant/constants";
import { isFounderOrg } from "@/lib/billing/subscription";

// ---------------------------------------------------------------------------
// Operatör paneli: DENEMEYİ BİTİR / GERİ VER (kurucu Q4, 10-17) + KART ŞARTINI KALDIR (kartla deneme kapısı istisnası). Gövde: işletme
// kimliği + işlem ("end" | "restore" | "card_exempt"). Kurallar
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
  const action = data?.action === "end" || data?.action === "restore" || data?.action === "card_exempt" ? data.action : null;
  if (!action) return badRequest({ action: "İşlemi seçin." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) return notFound();
  // Demo (inceleme) hesabı ve kurucu org bu yoldan değişmez (Haiku 10-17: arayüz listesi ayırıyordu, API ayırmıyordu).
  if (isDemoOrg(organizationId) || isFounderOrg(organizationId)) {
    return Response.json({ error: "Bu hesapta deneme işlemi yapılamaz.", code: "protected_org" }, { status: 409 });
  }

  const actor = session.actorUserId ?? session.userId;
  const r =
    action === "end"
      ? await endTrialByOperator(organizationId, actor)
      : action === "restore"
        ? await restoreOperatorEndedTrial(organizationId, actor)
        : await exemptTrialCardGate(organizationId, actor);
  if (!r.ok) {
    const error =
      r.reason === "not_running" ? "Bu işletmenin süren bir denemesi yok." : r.reason === "not_operator_ended" ? "Geri verilecek bir deneme yok." : "Kart şartı zaten yok.";
    return Response.json({ error, code: r.reason }, { status: 409 });
  }
  return jsonOk({ ok: true });
}
