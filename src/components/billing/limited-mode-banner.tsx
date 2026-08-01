import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Slim bar shown when an org's subscription is not active (trial ended /
 * canceled / past_due) while billing is enforced. The app stays fully
 * browsable — only AUTOMATIC messaging is off — so this is a nudge, not a wall.
 * Operators (grandfathered founder) never see it; their entitlement is active.
 *
 * ⚠️ METİN DURUMA GÖRE DEĞİŞİR (denetim, 08-01 — beşinci tur, ajan bulgusu).
 * Eskiden koşulsuz "Ücretsiz deneme süreniz doldu" yazıyordu; oysa banner
 * `past_due` (kartı reddedilen) ve `canceled` (iptal etmiş) ÖDEYEN müşterilere de
 * çıkıyor. Aylardır ödeyen birine "denemeniz doldu" demek hem yanlış hem de asıl
 * sorunu (kart güncelleme) gizliyordu — CTA da yanlış yeri gösteriyordu.
 */
export function LimitedModeBanner({ status }: { status?: string }) {
  const pastDue = status === "past_due";
  const canceled = status === "canceled";
  const message = pastDue
    ? "Son ödemeniz alınamadı — otomatik yanıtlar kapalı. Kart bilgilerinizi güncelleyerek hemen yeniden açabilirsiniz."
    : canceled
      ? "Aboneliğiniz iptal edildi — otomatik yanıtlar kapalı. Panelleri kullanmaya devam edebilirsiniz; yeniden başlatmak için bir plan seçin."
      : "Ücretsiz deneme süreniz doldu — otomatik yanıtlar kapalı. Panelleri kullanmaya devam edebilirsiniz; otomatik mesajlaşmayı açmak için bir plan seçin.";
  const cta = pastDue ? "Aboneliği yönet" : "Planları görün";

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
      <Lock className="size-3.5 shrink-0" />
      <span>{message}</span>
      <Link href="/settings?tab=faturalandirma" className="font-medium underline underline-offset-2">
        {cta}
      </Link>
    </div>
  );
}
