"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LEGAL_VERSION } from "@/lib/legal-entity";

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

/**
 * A plan card is the locked "current" one ONLY when the org has a real, ACTIVE
 * paid subscription of that exact plan. During a trial (no plan owned yet) or
 * after a lapse (canceled / past_due → the user must be able to re-subscribe) NO
 * card is locked, so paying is always reachable. Grandfathered orgs carry
 * currentPlanCode "grandfathered" which matches no plan → never locked either.
 * Extracted + exported so the state matrix is unit-tested without rendering.
 */
export function isLockedCurrentPlan(o: {
  active: boolean;
  trialing: boolean;
  planCode: string;
  currentPlanCode: string;
}): boolean {
  return o.active && !o.trialing && o.planCode === o.currentPlanCode;
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
  active = true,
  trialDaysLeft = null,
  manageable = false,
  planChangeEnabled = false,
  plans,
}: {
  clientToken: string;
  environment: "sandbox" | "production";
  email: string;
  organizationId: string;
  currentPlanCode: string;
  currentPlanName: string;
  grandfathered: boolean;
  /** Whether the org currently has access. When false (lapsed/locked), NO plan
   *  is "owned" so every card stays payable — the user can re-subscribe. */
  active?: boolean;
  trialDaysLeft?: number | null;
  /** True when the org has a live Paddle subscription that can be managed via the
   *  hosted customer portal. Locks NEW checkout (so an active subscriber can't
   *  start a second subscription) and surfaces the "manage subscription" button. */
  manageable?: boolean;
  /** True when in-app plan change (PADDLE_PLAN_CHANGE_ENABLED) is on AND the org has
   *  a Paddle sub. Turns the locked cards into real upgrade/downgrade buttons that
   *  preview the prorated charge, then apply via PATCH /subscriptions. */
  planChangeEnabled?: boolean;
  plans: PlanOption[];
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In-app plan change: the previewed change awaiting the user's confirmation.
  const [pending, setPending] = useState<{
    planCode: string;
    name: string;
    mode: "upgrade" | "downgrade";
    targetMonthly: number;
    immediateTotal: string | null;
    recurringTotal: string | null;
    previewToken: string;
  } | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  // Distance-selling consent: the buyer must accept the Ön Bilgilendirme Formu +
  // Mesafeli Satış Sözleşmesi BEFORE a paid checkout opens. Gates every plan button.
  const [accepted, setAccepted] = useState(false);
  // In-flight guard: while the consent record is being written (and checkout
  // opened) the plan buttons are disabled, so a double-click can't fire twice.
  const [busy, setBusy] = useState(false);

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

  // A plan only counts as the locked "current" one when the org has a real,
  // ACTIVE paid subscription of it. During a trial (no plan owned yet) OR when
  // access has lapsed (canceled/past_due — the user needs to re-subscribe),
  // every card stays selectable. Prevents locking someone out of paying.
  const trialing = trialDaysLeft != null;
  const lapsed = !active && !trialing && !grandfathered;

  const openCheckout = useCallback(
    async (planCode: string, priceId: string) => {
      if (!window.Paddle || !priceId || busy) return;
      // Defense-in-depth: even if the button somehow fires, never open a paid
      // checkout without the pre-contract acceptance.
      if (!accepted) {
        setError("Devam etmek için Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi’ni onaylayın.");
        return;
      }
      setError(null);
      setBusy(true);
      try {
        // FAIL-CLOSED: the consent record is the pre-payment legal evidence. If it
        // can't be persisted, do NOT open checkout — the whole point is "no payment
        // without a committed acceptance record". The endpoint returns 2xx ONLY
        // after the row is committed, so res.ok ⇒ the evidence exists. On any
        // failure (non-2xx or network) we stop and let the user retry.
        let consentId: string | undefined;
        try {
          const res = await fetch("/api/billing/consent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ planCode, priceId }),
          });
          if (res.ok) {
            const cj = (await res.json().catch(() => ({}))) as { consentId?: string };
            consentId = cj.consentId;
          }
        } catch {
          /* network error → consentId stays undefined */
        }
        if (!consentId) {
          setError("Onayınız kaydedilemedi, ödeme başlatılamadı. Lütfen tekrar deneyin.");
          return;
        }
        window.Paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customer: { email },
          // consentId is a server-trusted nonce → the webhook resolves the org from
          // the session-derived consent row, not the client-sent organizationId.
          // legalVersion travels with the transaction for cross-reference.
          customData: { organizationId, consentId, legalVersion: LEGAL_VERSION },
          // Auto-return to the app after payment instead of leaving the guest on
          // Paddle's success screen; /settings reloads and shows the new plan.
          settings: {
            displayMode: "overlay",
            theme: "light",
            locale: "tr",
            successUrl: `${window.location.origin}/settings?tab=faturalandirma`,
          },
        });
      } catch {
        setError("Ödeme ekranı açılamadı. Lütfen tekrar deneyin.");
      } finally {
        setBusy(false);
      }
    },
    [email, organizationId, accepted, busy],
  );

  // Open Paddle's hosted customer portal (change plan / cancel / update card).
  // The link is generated server-side per request (single-use, short-lived), so
  // we fetch then redirect the whole tab to it. All proration/cancel logic lives
  // in Paddle's tested UI — we never compute charges here.
  const openPortal = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !data.url) {
        setError("Abonelik yönetim sayfası açılamadı. Lütfen tekrar deneyin.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Step 1: preview the change (Paddle computes the exact prorated charge) and open
  // the confirm panel. Never applies anything by itself.
  const startChange = useCallback(async (planCode: string) => {
    if (changeBusy) return;
    setError(null);
    setChangeBusy(true);
    try {
      const res = await fetch("/api/billing/plan-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mode?: "upgrade" | "downgrade";
        targetName?: string;
        targetMonthly?: number;
        immediateTotal?: string | null;
        recurringTotal?: string | null;
        previewToken?: string;
      };
      if (!res.ok || !data.mode || !data.previewToken) {
        setError(data.error ?? "Plan bilgisi alınamadı. Lütfen tekrar deneyin.");
        return;
      }
      setPending({
        planCode,
        name: data.targetName ?? planCode,
        mode: data.mode,
        targetMonthly: data.targetMonthly ?? 0,
        immediateTotal: data.immediateTotal ?? null,
        recurringTotal: data.recurringTotal ?? null,
        previewToken: data.previewToken,
      });
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setChangeBusy(false);
    }
  }, [changeBusy]);

  // Step 2: apply the previewed change. Paddle charges/schedules; our webhook then
  // updates the local plan, so we refresh once it returns.
  const confirmChange = useCallback(async () => {
    if (!pending || changeBusy) return;
    setError(null);
    setChangeBusy(true);
    try {
      const res = await fetch("/api/billing/plan-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode: pending.planCode, previewToken: pending.previewToken }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        ok?: boolean;
        amountChanged?: boolean;
        pending?: boolean;
      };
      if (data.pending) {
        // Ambiguous Paddle outcome (timeout/5xx): it may already be applied. We do NOT
        // re-send. Close the dialog and let the webhook settle the plan on refresh.
        setPending(null);
        setError(data.error ?? "İşleminiz alındı; onay bekleniyor. Birkaç dakika içinde güncellenecek.");
        setTimeout(() => router.refresh(), 4000);
        return;
      }
      if (!res.ok || !data.ok) {
        setError(
          (data.error ?? "Plan değişikliği yapılamadı. Lütfen tekrar deneyin.") +
            (data.detail ? ` (${data.detail})` : ""),
        );
        // 409 = this preview is spent (single-use) or its amount moved. The dialog's
        // token is dead → close it so the next click mints a FRESH preview + amount.
        if (res.status === 409) setPending(null);
        return;
      }
      setPending(null);
      // Give Paddle's webhook a moment to update the local plan, then refresh.
      setTimeout(() => router.refresh(), 2500);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setChangeBusy(false);
    }
  }, [pending, changeBusy, router]);

  // Index of the org's current plan in the (ordered) catalog, to label each card's
  // button as an upgrade or a downgrade.
  const currentIndex = plans.findIndex((p) => p.code === currentPlanCode);

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
                : "ücretsiz deneme süreniz doldu"}
            </strong>
          </>
        ) : null}
        {lapsed ? (
          <>
            {" "}
            — <strong className="text-destructive">aboneliğiniz aktif değil</strong>
          </>
        ) : null}
        .
      </p>

      {manageable ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ödeme yönteminizi değiştirmek veya aboneliğinizi iptal etmek için güvenli abonelik yönetim
            sayfasını kullanın; işlemler Paddle üzerinden yürütülür.
            {planChangeEnabled ? " Plan yükseltme/düşürme için aşağıdaki planlardan birini seçin." : ""}
          </p>
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Açılıyor…" : "Aboneliği yönet (iptal / kart)"}
          </button>
        </div>
      ) : (
        <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            <Link href="/on-bilgilendirme" target="_blank" className="text-primary hover:underline">
              Ön Bilgilendirme Formu
            </Link>
            {" ve "}
            <Link href="/mesafeli-satis" target="_blank" className="text-primary hover:underline">
              Mesafeli Satış Sözleşmesi
            </Link>
            ’ni okudum, kabul ediyorum. Ücretli plana geçmeden önce bu onay gereklidir.
          </span>
        </label>
      )}

      {pending ? (
        <div className="space-y-2 rounded-md border border-primary/40 bg-accent/30 p-3">
          <p className="text-sm">
            {pending.mode === "upgrade" ? (
              pending.immediateTotal ? (
                <>
                  <strong>{pending.name}</strong> planına <strong>yükseltiyorsunuz</strong>. Şimdi{" "}
                  <strong>{pending.immediateTotal}</strong> tahsil edilecek, ardından aylık{" "}
                  {pending.recurringTotal ?? `${pending.targetMonthly.toLocaleString("tr-TR")} ₺`}.
                </>
              ) : (
                // Fail-closed: never let the customer authorize a charge without the
                // exact prorated amount (preview couldn't return it → block, don't
                // charge blind).
                <>
                  <strong>{pending.name}</strong> planına yükseltme için{" "}
                  <strong>kesin tahsilat tutarı şu an hesaplanamadı.</strong> Ödemeden önce tutarı
                  görmeniz gerekir — lütfen “Vazgeç” deyip tekrar deneyin.
                </>
              )
            ) : (
              <>
                <strong>{pending.name}</strong> planına <strong>düşürüyorsunuz</strong>. Değişiklik{" "}
                <strong>hemen</strong> geçerli olur (yeni plan limitleri anında uygulanır); aradaki fark
                bir sonraki faturanıza yansıtılır. Yeni aylık ücret{" "}
                {pending.recurringTotal ?? `${pending.targetMonthly.toLocaleString("tr-TR")} ₺`}.
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirmChange()}
              // Fail-closed: an upgrade charges immediately, so block confirm until
              // the exact amount is known. A downgrade has no immediate charge.
              disabled={changeBusy || (pending.mode === "upgrade" && !pending.immediateTotal)}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {changeBusy
                ? "İşleniyor…"
                : pending.mode === "upgrade"
                  ? pending.immediateTotal
                    ? `${pending.immediateTotal} öde ve yükselt`
                    : "Tutar alınamadı"
                  : "Düşür (hemen geçerli)"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={changeBusy}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p, i) => {
          const isCurrent = isLockedCurrentPlan({
            active,
            trialing,
            planCode: p.code,
            currentPlanCode,
          });
          const isUpgrade = currentIndex >= 0 && i > currentIndex;
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
              {isCurrent ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Mevcut plan
                </button>
              ) : planChangeEnabled ? (
                <button
                  type="button"
                  disabled={changeBusy || !p.priceId || pending !== null}
                  onClick={() => void startChange(p.code)}
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isUpgrade ? "Yükselt" : "Düşür"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready || !p.priceId || !accepted || busy || manageable}
                  onClick={() => openCheckout(p.code, p.priceId)}
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {manageable
                    ? "Yönetimden değiştirin"
                    : !ready
                      ? "Yükleniyor…"
                      : trialing
                        ? "Bu planı seç"
                        : "Bu plana geç"}
                </button>
              )}
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
