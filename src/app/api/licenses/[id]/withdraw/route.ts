import { forbidden, hasJsonContentType, jsonOk, notFound, unsupportedMediaType } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { licensesEnabled } from "@/lib/licenses/secret";
import { withdrawLicense } from "@/lib/licenses/write";
import { LICENSE_TEXT } from "@/lib/licenses/messages";

// Belgeyi geri çekme (Faz 1a): yalnız sahip + iki aşamalı doğrulamalı oturum. Başka işletmenin belgesi "bulunamadı" (kimlik yoklanamaz).
export const POST = withOwner<{ id: string }>(async (session, req, ctx) => {
  if (!licensesEnabled()) return notFound();
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  if (session.mfa !== true) return forbidden(LICENSE_TEXT.twoFactorRequired);
  const { id } = await ctx.params;
  if (typeof id !== "string" || !id || id.length > 64) return notFound();
  const res = await withdrawLicense({ organizationId: session.organizationId, userId: session.userId, licenseId: id });
  if (res.ok) return jsonOk({ ok: true, message: LICENSE_TEXT.withdrawn });
  if (res.reason === "not_found") return notFound();
  return jsonOk({ error: "Bu belge şu an geri çekilemiyor. Sayfayı yenileyip yeniden deneyin." }, 409);
});
