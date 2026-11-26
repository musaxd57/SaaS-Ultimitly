import "server-only";

import { auditActor, writeAudit } from "@/lib/audit";
import type { SessionPayload } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Kalite konsolu — reddedilen denemenin kaydı (iki rota ortak). Yetki kararı ROTADA kalır (yapısal pin: her admin rotası
// `if (!isSuperAdmin(session)) return unauthorized()` satırını taşır); burası yalnız reddi kaydeder — yetkisiz oturumda oturumun KENDİ
// org'una, operatörün başka kiracıya ait iz denemesinde istenen org'a (gerekçe kapalı küme kod; IP / e-posta yok — kayıt o org'un KVKK
// ihracına girer). Oturumsuz istek kaydedilmez (kimse yok).
// ---------------------------------------------------------------------------

export type AiQualityDenyReason = "not_operator" | "impersonating" | "cross_site" | "generation_not_in_org";

/** Uç kayıt yazar (görüntüleme / etiket): SameSite=Lax çerez üst düzey yönlendirmeyle taşınır → yalnız aynı site ya da elle girilen adres. */
export function aiQualityCrossSite(fetchSite: string | null): boolean {
  return Boolean(fetchSite && fetchSite !== "same-origin" && fetchSite !== "none");
}

/**
 * Ret kaydı kullanıcı başına SAATTE en çok bu kadar satır (derin ajan turu 2, D-2): eskiden sınırsızdı — herhangi bir oturum döngüyle dakikada
 * binlerce `ai_quality.denied` satırı yazıp operatör panelinin "son 50 denetim kaydı" listesinden gerçek güvenlik olaylarını itebiliyor ve
 * tabloyu sınırsız büyütebiliyordu. Sınırdan sonra ret YİNE döner (401 / 403 aynı), yalnız yeni satır yazılmaz; ilk 10 satır denemenin
 * izini zaten taşır. Sayaç veritabanında (`rateLimit`); veritabanı düşerse süreç içi kovaya düşer.
 */
export const AI_QUALITY_DENIED_AUDIT_PER_HOUR = 10;

export async function recordAiQualityDenied(session: SessionPayload, reason: AiQualityDenyReason, op: "view" | "label"): Promise<void> {
  const budget = await rateLimit(`ai-quality-denied:${session.userId}`, AI_QUALITY_DENIED_AUDIT_PER_HOUR, 60 * 60_000);
  if (!budget.ok) return;
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "ai_quality.denied",
    metadata: { reason, op },
  });
}
