import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Slim bar shown when an org's subscription is not active (trial ended /
 * canceled / past_due) while billing is enforced. The app stays fully
 * browsable — only AUTOMATIC messaging is off — so this is a nudge, not a wall.
 * Operators (grandfathered founder) never see it; their entitlement is active.
 */
export function LimitedModeBanner() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
      <Lock className="size-3.5 shrink-0" />
      <span>
        Ücretsiz deneme süreniz doldu — <strong>otomatik yanıtlar kapalı.</strong> Panelleri
        kullanmaya devam edebilirsiniz; otomatik mesajlaşmayı açmak için bir plan seçin.
      </span>
      <Link href="/settings?tab=faturalandirma" className="font-medium underline underline-offset-2">
        Planları görün
      </Link>
    </div>
  );
}
