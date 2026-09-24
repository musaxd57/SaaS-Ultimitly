"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { trialBannerDismissible, trialBannerSnoozeCookie } from "@/lib/billing/trial-banner";

/**
 * Slim top bar shown while an org is inside its free reverse-trial. Informational
 * + a nudge to the plans; never blocks. Hidden once the org subscribes (status
 * leaves "trialing") or for grandfathered/existing orgs.
 *
 * Kapatılabilir (09-24, kurucu önerisi): "Kapat" bandı 4 saat gizler (çerez; ↓`lib/billing/trial-banner.ts`),
 * süre dolunca kendiliğinden geri gelir. Deneme süresi DOLMUŞSA kapatılamaz.
 */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const label =
    daysLeft <= 0
      ? "Ücretsiz deneme süreniz doldu — devam için bir plan seçin."
      : `Pro ücretsiz deneme: ${daysLeft} gün kaldı.`;
  const dismissible = trialBannerDismissible(daysLeft);

  function snooze() {
    try {
      document.cookie = trialBannerSnoozeCookie(window.location.protocol === "https:");
    } catch {
      // Çerez yazılamasa da bant bu sayfa ömrü boyunca kapanır.
    }
    setHidden(true);
  }

  return (
    <div className="relative flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-9 py-2 text-center text-sm text-amber-900 dark:text-amber-200">
      <span>{label}</span>
      <Link href="/settings?tab=faturalandirma" className="font-medium underline underline-offset-2">
        Planları görün
      </Link>
      {dismissible ? (
        <button
          type="button"
          onClick={snooze}
          aria-label="Kapat"
          title="Kapat"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-200/70 dark:hover:bg-amber-500/20 dark:hover:text-amber-200"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
