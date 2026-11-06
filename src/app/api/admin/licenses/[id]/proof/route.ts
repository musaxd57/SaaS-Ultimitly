import { type NextRequest } from "next/server";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, requireSession, unauthorized } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { recordOwnershipProof } from "@/lib/licenses/write";
import { OPERATOR_ERROR_TEXT, operatorUserId, operatorWritePreamble } from "@/lib/licenses/operator-route";

// Operatör: HAK SAHİPLİĞİ KANITI (K3, Faz 1a). Belge dosyası Lixus'a GELMEZ / saklanmaz; operatör kanıtı dışarıda inceler (e-imzalı beyan,
// belge seti…) ve yöntem + kısa başvuru kaydı + belgede gördüğü vergi numarasını yazar. Numara başvurudakiyle ÖZETİ üzerinden karşılaştırılır,
// SAKLANMAZ; yalnız sonuç kalır (tasarım §3.3, §11.3; Opus 11-06 P1-2). İstek gövdesi günlüğe yazılmaz.
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
  const res = await recordOwnershipProof({ licenseId: id, operatorUserId: operatorUserId(session), proof: body });
  if (res.ok) return jsonOk({ ok: true, taxIdMatched: res.taxIdMatched });
  if (res.reason === "not_found") return notFound(OPERATOR_ERROR_TEXT.not_found);
  if (res.reason === "invalid") return badRequest({ [res.field ?? "body"]: OPERATOR_ERROR_TEXT.invalid });
  return jsonOk({ error: OPERATOR_ERROR_TEXT[res.reason] ?? OPERATOR_ERROR_TEXT.invalid }, 409);
}
