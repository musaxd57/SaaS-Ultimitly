import Link from "next/link";
import { Lock } from "lucide-react";
import { PaddlePlans } from "@/components/settings/paddle-plans";
import { DEFAULT_PLANS } from "@/lib/billing/plans";
import type { Entitlement } from "@/lib/billing/subscription";

/**
 * Full-page paywall shown ONLY when billing is enforced (BILLING_ENFORCED=true)
 * and the org's reverse-trial has ended / subscription lapsed. It replaces the
 * app — the only ways out are to upgrade (Paddle overlay, in place) or log out.
 * Operators (impersonating / super-admin) bypass this in the layout, never here.
 */
export function BillingLockedScreen({
  entitlement,
  email,
  organizationId,
}: {
  entitlement: Entitlement;
  email: string;
  organizationId: string;
}) {
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() || "";
  const environment =
    process.env.NEXT_PUBLIC_PADDLE_ENV?.trim() === "production" ? "production" : "sandbox";
  const priceByCode: Record<string, string> = {
    free: process.env.PADDLE_PRICE_BASLANGIC?.trim() || "",
    pro: process.env.PADDLE_PRICE_PRO?.trim() || "",
    business: process.env.PADDLE_PRICE_ISLETME?.trim() || "",
  };
  const paddleReady =
    Boolean(clientToken) && Object.values(priceByCode).some((id) => id.length > 0);

  const title = entitlement.trialExpired
    ? "Ücretsiz deneme süreniz doldu"
    : "Aboneliğiniz aktif değil";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">
              Devam etmek için bir plan seçin. Verileriniz ve ayarlarınız olduğu gibi duruyor.
            </p>
          </div>
        </div>

        {paddleReady ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <PaddlePlans
              clientToken={clientToken}
              environment={environment}
              email={email}
              organizationId={organizationId}
              currentPlanCode={entitlement.planCode}
              currentPlanName={entitlement.planName}
              grandfathered={entitlement.grandfathered}
              trialDaysLeft={entitlement.trialDaysLeft}
              plans={DEFAULT_PLANS.map((p) => ({
                code: p.code,
                name: p.name,
                priceMinor: p.priceMinor,
                currency: p.currency,
                propertyLimit: p.propertyLimit,
                priceId: priceByCode[p.code] ?? "",
              }))}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Aboneliğinizi açmak için bizimle iletişime geçin.
          </div>
        )}

        <div className="text-center">
          <Link href="/api/auth/logout" className="text-sm text-muted-foreground hover:text-foreground">
            Çıkış yap
          </Link>
        </div>
      </div>
    </div>
  );
}
