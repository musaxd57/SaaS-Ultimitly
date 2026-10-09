import "server-only";

import { auditActor, writeAudit } from "@/lib/audit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Kalite konsolu — reddedilen denemenin kaydı (iki rota ortak). Yetki kararı ROTADA kalır (yapısal pin: her admin rotası
// `if (!isSuperAdmin(session)) return unauthorized()` satırını taşır); burası yalnız reddi oturumun KENDİ org'una yazar
// (gerekçe kapalı küme kod; IP / e-posta yok — kayıt o org'un KVKK ihracına girer). Oturumsuz istek kaydedilmez (kimse yok).
// ---------------------------------------------------------------------------

export type AiQualityDenyReason = "not_operator" | "impersonating" | "cross_site";

/** Uç kayıt yazar (görüntüleme / etiket): SameSite=Lax çerez üst düzey yönlendirmeyle taşınır → yalnız aynı site ya da elle girilen adres. */
export function aiQualityCrossSite(fetchSite: string | null): boolean {
  return Boolean(fetchSite && fetchSite !== "same-origin" && fetchSite !== "none");
}

export async function recordAiQualityDenied(session: SessionPayload, reason: AiQualityDenyReason, op: "view" | "label"): Promise<void> {
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "ai_quality.denied",
    metadata: { reason, op },
  });
}
