import { type NextRequest } from "next/server";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, requireSession, unauthorized } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { decideLicense, type DecisionInput } from "@/lib/licenses/write";
import { OPERATOR_ERROR_TEXT, operatorUserId, operatorWritePreamble } from "@/lib/licenses/operator-route";

// Operatör: KARAR (Faz 1a) — onay (K2 + K3 şartlı), ret, askı, askıdan dönüş, incelemeye alma. Şartlar ve geçişler tek kaynakta
// (`lib/licenses/evidence.ts`, `state.ts`); bu uç yalnız iletir.
const ACTIONS: ReadonlySet<DecisionInput["action"]> = new Set(["approve", "reject", "suspend", "reinstate", "review"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  const blocked = await operatorWritePreamble(req, session);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  if (!id || id.length > 64) return notFound();
  const body = (await readJsonCappedOrNull(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest({ body: OPERATOR_ERROR_TEXT.invalid });
  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.has(action as DecisionInput["action"])) return badRequest({ action: OPERATOR_ERROR_TEXT.invalid });
  const res = await decideLicense({
    licenseId: id,
    operatorUserId: operatorUserId(session),
    action: action as DecisionInput["action"],
    reason: body.reason,
    nameOverride: body.nameOverride,
    note: body.note,
  });
  if (res.ok) return jsonOk(res);
  if (res.reason === "not_found") return notFound(OPERATOR_ERROR_TEXT.not_found);
  if (res.reason === "invalid") return badRequest({ body: OPERATOR_ERROR_TEXT.invalid });
  return jsonOk({ error: OPERATOR_ERROR_TEXT[res.reason] ?? OPERATOR_ERROR_TEXT.invalid, missing: res.missing ?? [] }, 409);
}
