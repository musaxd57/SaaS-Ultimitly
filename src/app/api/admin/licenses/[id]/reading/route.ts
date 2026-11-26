import { type NextRequest } from "next/server";
import { badRequest, forbidden, jsonOk, notFound, readJsonCappedOrNull, requireSession, unauthorized } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { recordRegistryReading } from "@/lib/licenses/write";
import { OPERATOR_ERROR_TEXT, operatorUserId, operatorWritePreamble } from "@/lib/licenses/operator-route";

// Operatör: RESMÎ KAYIT OKUMASI (K2, Faz 1a). Yeniden üretilebilir sorgu kaydı: kaynak (kapalı küme) + sorgulanan değer + kayıttan
// KOPYALANAN alanlar (kayıtta görünen belge numarası dahil — eşleşme onunla). Doğrulanmış belgede kayıt AÇIKÇA iptal diyorsa (numara bu
// belgeninse) belge hemen askıya alınır; geçerli ama uyuşmayan kayıt işareti kaldırır; "bulunamadı" / "okunamadı" hüküm vermez.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();
  // Bürünmede yazma yok (K8 — salt-okunur destek görünümü); ön kapı da denetler, bu satır bürünme pininin aradığı açık kontroldür.
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);
  const blocked = await operatorWritePreamble(req, session);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  if (!id || id.length > 64) return notFound();
  const body = (await readJsonCappedOrNull(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest({ body: OPERATOR_ERROR_TEXT.invalid });
  const res = await recordRegistryReading({ licenseId: id, operatorUserId: operatorUserId(session), reading: body });
  if (res.ok) return jsonOk(res);
  if (res.reason === "not_found") return notFound(OPERATOR_ERROR_TEXT.not_found);
  if (res.reason === "invalid") return badRequest({ [res.field ?? "body"]: OPERATOR_ERROR_TEXT.invalid });
  return jsonOk({ error: OPERATOR_ERROR_TEXT[res.reason] ?? OPERATOR_ERROR_TEXT.invalid }, 409);
}
