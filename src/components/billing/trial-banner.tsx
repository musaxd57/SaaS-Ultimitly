import Link from "next/link";

/**
 * Slim top bar shown while an org is inside its free reverse-trial. Informational
 * + a nudge to the plans; never blocks. Hidden once the org subscribes (status
 * leaves "trialing") or for grandfathered/existing orgs.
 */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const label =
    daysLeft <= 0
      ? "Ücretsiz deneme süreniz bugün doluyor."
      : `Pro ücretsiz deneme: ${daysLeft} gün kaldı.`;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
      <span>{label}</span>
      <Link href="/settings" className="font-medium underline underline-offset-2">
        Planları görün
      </Link>
    </div>
  );
}
