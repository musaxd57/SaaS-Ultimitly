// ---------------------------------------------------------------------------
// Operatör belge uçlarının ORTAK ön kapısı (oturum + süper-admin satırları her uçta AYRICA yazılıdır — rol kapısı pini onları arar).
// Sıra: bürünmede yazma yok → site dışı yazma yok → JSON zorunlu → anahtar kapalıysa uç yok → operatör başına saatlik kota.
// ---------------------------------------------------------------------------

import "server-only";
import type { NextRequest } from "next/server";
import { forbidden, hasJsonContentType, notFound, tooManyRequests, unsupportedMediaType } from "@/lib/api";
import { crossSiteWrite } from "@/lib/route-guard";
import { isImpersonating, OPERATOR_SUPPORT_VIEW_MESSAGE } from "@/lib/auth/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { licensesEnabled } from "./secret";

export const operatorUserId = (session: { userId: string; actorUserId?: string }) => session.actorUserId ?? session.userId;

export async function operatorWritePreamble(req: NextRequest, session: { userId: string; actorUserId?: string }): Promise<Response | null> {
  if (isImpersonating(session)) return forbidden(OPERATOR_SUPPORT_VIEW_MESSAGE);
  if (crossSiteWrite(req)) return forbidden();
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  if (!licensesEnabled()) return notFound();
  const limited = await rateLimit(`admin-license:${operatorUserId(session)}`, 300, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  return null;
}

/** Operatöre giden hata metinleri (iç ekran; kısa). */
export const OPERATOR_ERROR_TEXT: Record<string, string> = {
  not_found: "Belge bulunamadı.",
  not_open: "Bu belge bu işlem için uygun durumda değil.",
  invalid: "Girdiyi kontrol edin.",
  conflict: "Belge bu arada değişti. Sayfayı yenileyip yeniden deneyin.",
  not_ready: "Onay için eksik kanıt var.",
  lock_conflict: "Bu belge ya da şirket başka bir hesapta doğrulanmış. Başvuru incelemeye alındı.",
};
