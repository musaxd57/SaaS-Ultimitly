"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Paddle.js is loaded from Paddle's CDN at runtime (no npm dependency, matching
// the rest of the dependency-free billing code). Minimal typings for the bits we
// use so we avoid `any`.
interface PaddleCheckoutOpenOptions {
  items: { priceId: string; quantity: number }[];
  customer?: { email?: string };
  customData?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}
interface PaddleGlobal {
  Environment: { set: (env: string) => void };
  Initialize: (opts: { token: string; eventCallback?: (ev: { name?: string }) => void }) => void;
  Checkout: { open: (opts: PaddleCheckoutOpenOptions) => void };
}
declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

function loadPaddle(): Promise<PaddleGlobal | null> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.Paddle) return resolve(window.Paddle);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PADDLE_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Paddle ?? null));
      existing.addEventListener("error", () => reject(new Error("paddle load error")));
      return;
    }
    const s = document.createElement("script");
    s.src = PADDLE_SRC;
    s.async = true;
    s.onload = () => resolve(window.Paddle ?? null);
    s.onerror = () => reject(new Error("paddle load error"));
    document.head.appendChild(s);
  });
}

export interface PlanOption {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  propertyLimit: number | null;
  priceId: string; // empty when not configured in env
}

/**
 * Plan/checkout card. Loads Paddle.js, then opens Paddle's overlay checkout for
 * the chosen plan, stamping the org id into custom_data so the webhook can link
 * the resulting subscription back to this organization. Purely additive: the
 * server only renders this when Paddle is configured (client token + price ids),
 * and the paywall (BILLING_ENFORCED) stays off — this is opt-in upgrade UI.
 */
export function PaddlePlans({
  clientToken,
  environment,
  email,
  organizationId,
  currentPlanCode,
  currentPlanName,
  grandfathered,
  trialDaysLeft = null,
  plans,
}: {
  clientToken: string;
  environment: "sandbox" | "production";
  email: string;
  organizationId: string;
  currentPlanCode: string;
  currentPlanName: string;
  grandfathered: boolean;
  trialDaysLeft?: number | null;
  plans: PlanOption[];
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPaddle()
      .then((Paddle) => {
        if (cancelled || !Paddle) return;
        try {
          Paddle.Environment.set(environment);
          Paddle.Initialize({
            token: clientToken,
            eventCallback: (ev) => {
              // The server webhook records the subscription; give it a moment,
              // then refresh so the new plan shows.
              if (ev?.name === "checkout.completed") setTimeout(() => router.refresh(), 4000);
            },
          });
          setReady(true);
        } catch {
          setError("Ödeme servisi başlatılamadı.");
        }
      })
      .catch(() => setError("Ödeme servisi yüklenemedi. Bağlantınızı kontrol edin."));
    return () => {
      cancelled = true;
    };
  }, [clientToken, environment, router]);

  const openCheckout = useCallback(
    (priceId: string) => {
      if (!window.Paddle || !priceId) return;
      setError(null);
      try {
        window.Paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customer: { email },
          customData: { organizationId },
          settings: { displayMode: "overlay", theme: "light", locale: "tr" },
        });
      } catch {
        setError("Ödeme ekranı açılamadı. Lütfen tekrar deneyin.");
      }
    },
    [email, organizationId],
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Şu anki planınız:{" "}
        <strong className="text-foreground">
          {grandfathered ? "Mevcut müşteri (sınırsız)" : currentPlanName}
        </strong>
        {trialDaysLeft != null ? (
          <>
            {" "}
            —{" "}
            <strong className="text-foreground">
              {trialDaysLeft > 0
                ? `ücretsiz deneme, ${trialDaysLeft} gün kaldı`
                : "ücretsiz deneme bugün doluyor"}
            </strong>
          </>
        ) : null}
        .
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.code === currentPlanCode;
          const price = (p.priceMinor / 100).toLocaleString("tr-TR");
          const limit = p.propertyLimit == null ? "Sınırsız daire" : `${p.propertyLimit} daireye kadar`;
          return (
            <div
              key={p.code}
              className={
                isCurrent
                  ? "rounded-lg border-2 border-primary bg-accent/40 p-3"
                  : "rounded-lg border border-border bg-card p-3"
              }
            >
              <p className="text-sm font-semibold">{p.name}</p>
              <p className="mt-0.5 text-lg font-bold">
                {price} <span className="text-xs font-normal text-muted-foreground">₺/ay</span>
              </p>
              <p className="mb-2 text-xs text-muted-foreground">{limit}</p>
              <button
                type="button"
                disabled={!ready || isCurrent || !p.priceId}
                onClick={() => openCheckout(p.priceId)}
                className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isCurrent ? "Mevcut plan" : ready ? "Bu plana geç" : "Yükleniyor…"}
              </button>
            </div>
          );
        })}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-[11px] text-muted-foreground">
        Ödeme, satıcı olarak Paddle (Merchant of Record) üzerinden güvenli şekilde alınır; fatura ve
        KDV Paddle tarafından yönetilir. İstediğiniz zaman iptal edebilirsiniz.
      </p>
    </div>
  );
}
