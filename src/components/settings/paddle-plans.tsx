"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { CHECKOUT_PENDING_MESSAGE, CHECKOUT_PENDING_MS } from "@/lib/billing/checkout-pending-shared";
import { formatMinor } from "@/lib/utils";
import { BILLING_TEXT, billingReason, lapsedLabel } from "@/lib/billing/billing-ui-text";
import { TrackingNumberCopy } from "@/components/tracking-number-copy";
import { ResumeSubscription } from "@/components/settings/resume-subscription";
import {
  BillingPeriodToggle,
  BillingPeriodAnnouncer,
  type BillingPeriod,
} from "@/components/billing-period-toggle";

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

/** Betik bu sürede yüklenmezse ödeme kartı "Yükleniyor…"da asılı kalmaz, hata gösterir (K3, Haiku 10-17). */
const PADDLE_LOAD_TIMEOUT_MS = 20_000;

function loadPaddle(): Promise<PaddleGlobal | null> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.Paddle) return resolve(window.Paddle);
    const timer = window.setTimeout(() => reject(new Error("paddle load timeout")), PADDLE_LOAD_TIMEOUT_MS);
    const done = (fn: () => void) => () => {
      window.clearTimeout(timer);
      fn();
    };
    // Betik indi ama `window.Paddle` yoksa (engellendi / bozuk) bu da HATADIR — eskiden `null` çözülüp kart sessizce bekliyordu.
    const onLoad = done(() => (window.Paddle ? resolve(window.Paddle) : reject(new Error("paddle missing after load"))));
    const onError = done(() => reject(new Error("paddle load error")));
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PADDLE_SRC}"]`);
    // Daha önce HATA vermiş betik etiketi yeniden olay üretmez (kart yeniden açılınca söz sonsuza dek asılı kalıyordu) → kaldırılıp yeniden eklenir.
    if (existing && existing.dataset.state !== "error") {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      return;
    }
    existing?.remove();
    const s = document.createElement("script");
    s.src = PADDLE_SRC;
    s.async = true;
    s.onload = onLoad;
    s.onerror = () => {
      s.dataset.state = "error";
      onError();
    };
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
  /** Yıllık toplam (aylık × 10 — "2 ay bedava"). */
  annualPriceMinor: number;
  /** Yıllık ödeyenin aylık karşılığı — kartta kıyas için gösterilir. */
  annualMonthlyEquivalentMinor: number;
  currency: string;
  propertyLimit: number | null;
  priceId: string; // empty when not configured in env
  /** Yıllık Paddle fiyat id'si; env yoksa boş. */
  annualPriceId: string;
  /** Kartla deneme (kurucu 10-17): deneme süreli Paddle fiyatı (kart alınır, deneme bitince tahsil); env yoksa boş. */
  trialPriceId?: string;
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
  annualAvailable = false,
  plans,
  locale,
  currency,
  checkoutPending = false,
  trialNotice = null,
  subscriptionStatus = null,
  resumeEnabled = false,
  cardTrialNotice = null,
  cancelScheduledUntil = null,
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
  /** Üç kademenin de yıllık fiyat id'si env'de var mı? Yoksa seçici çizilmez. */
  annualAvailable?: boolean;
  plans: PlanOption[];
  /** Deployment display locale (server-resolved: appLocale()). Digit grouping and
   *  symbol placement only — says nothing about which currency is charged. */
  locale: string;
  /** Deployment billing currency (server-resolved: appBillingCurrency()). Used ONLY
   *  for the preview fallback, where no Paddle response is available to state it.
   *  When Paddle DOES answer, its own currency wins — see recurringTotal. */
  currency: string;
  /** "Ödemeniz işleniyor" kilidi sunucuda geçerli mi (kurucu onayı 10-10, `lib/billing/checkout-pending.ts`): az önce tamamlanan ödemenin
   *  aboneliği henüz yazılmadı → yeni ödeme ekranı açılmaz. */
  checkoutPending?: boolean;
  /** Deneme erken bittiyse sunucunun hazırladığı sade not (kurucu onayı 10-10, deneme kimliği). */
  trialNotice?: string | null;
  /** Abonelik durumu (erişim kapalıyken sebep etiketi: son ödeme alınamadı / duraklatıldı / iptal edildi — K3, 10-17). */
  subscriptionStatus?: string | null;
  /** I4 C (kurucu 10-17): `PADDLE_RESUME_ENABLED` açık + yönetilebilir abonelik → duraklatılmışken "Aboneliği devam ettir". */
  resumeEnabled?: boolean;
  /** Kartla deneme kapısı (kurucu 10-17): doluysa hesapta kart isteniyor — metin gösterilir, paket düğmeleri DENEME SÜRELİ fiyatla açılır. */
  cardTrialNotice?: string | null;
  /**
   * Yenileme iptal edildi: erişimin süreceği son gün, sunucuda işletmenin saat diliminde biçimlenmiş ("17 Kasım 2026"). Kurucu 10-17: iptal
   * eden kullanıcı o tarihe kadar paketini kullanır ve bunu ekranda görür.
   */
  cancelScheduledUntil?: string | null;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  // Ödeme ekranı betiği yüklenemedi / başlatılamadı: düğme "Yükleniyor…"da asılı kalmasın (K3 envanteri A2/A21).
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hata OLMAYAN bilgi (onay bekleniyor, tutar değişti): kırmızı hata alanında gösterilmez (K3 envanteri S15).
  const [notice, setNotice] = useState<string | null>(null);
  // Beklenmeyen sunucu hatasının tam takip numarası (kurucu kararı 10-10): metinde kısa numara, düğmede tamamı.
  const [trackingId, setTrackingId] = useState<string | null>(null);
  // In-app plan change: the previewed change awaiting the user's confirmation.
  const [pending, setPending] = useState<{
    planCode: string;
    name: string;
    mode: "upgrade" | "downgrade";
    targetMonthlyMinor: number;
    immediateTotal: string | null;
    recurringTotal: string | null;
    previewToken: string;
  } | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  // Distance-selling consent: the buyer must accept the Ön Bilgilendirme Formu +
  // Mesafeli Satış Sözleşmesi BEFORE a paid checkout opens. Gates every plan button.
  const [accepted, setAccepted] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("month");
  // Kartla denemede yalnız aylık deneme süreli fiyat (yıllık deneme fiyatı yok).
  const annual = annualAvailable && period === "year" && !cardTrialNotice;
  // In-flight guard: while the consent record is being written (and checkout
  // opened) the plan buttons are disabled, so a double-click can't fire twice.
  const [busy, setBusy] = useState(false);
  // "Ödemeniz işleniyor" (kurucu onayı 10-10): ödeme ekranı başarıyla kapanınca ya da sunucu kilidi geçerliyken yeni ödeme ekranı açılmaz.
  const [processing, setProcessing] = useState(checkoutPending);
  // Son açılan ödeme ekranının onay kaydı — tamamlanma sinyali sunucuya bununla gider (kilit yalnız kendi işletmesinin yeni onayıyla yazılır).
  const lastConsentRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPaddle()
      .then((Paddle) => {
        if (cancelled || !Paddle) return; // `null` yalnız sunucu tarafında (window yok)
        try {
          Paddle.Environment.set(environment);
          Paddle.Initialize({
            token: clientToken,
            eventCallback: (ev) => {
              // The server webhook records the subscription; give it a moment,
              // then refresh so the new plan shows.
              if (ev?.name === "checkout.completed") {
                setProcessing(true);
                // Sunucu kilidiyle aynı süre: webhook hiç gelmezse kart bu sayfada da kendiliğinden açılır (Haiku incelemesi).
                setTimeout(() => setProcessing(false), CHECKOUT_PENDING_MS);
                const consentId = lastConsentRef.current;
                if (consentId) {
                  void fetch("/api/billing/checkout-pending", {
                    method: "POST",
                    keepalive: true,
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ consentId }),
                  }).catch(() => {});
                }
                setTimeout(() => router.refresh(), 4000);
              }
            },
          });
          setReady(true);
        } catch {
          setLoadFailed(true);
          setError(BILLING_TEXT.checkoutOpenFailed);
        }
      })
      .catch(() => {
        setLoadFailed(true);
        setError(BILLING_TEXT.checkoutLoadFailed);
      });
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
      // "Ödemeniz işleniyor" kartın altında zaten yazılı (↓) — aynı metin ikinci kez kırmızı hata olarak basılmaz.
      if (processing) return;
      // Defense-in-depth: even if the button somehow fires, never open a paid
      // checkout without the pre-contract acceptance.
      if (!accepted) {
        setError(BILLING_TEXT.consentRequired);
        return;
      }
      setError(null);
      setNotice(null);
      setTrackingId(null);
      setBusy(true);
      try {
        // FAIL-CLOSED: the consent record is the pre-payment legal evidence. If it
        // can't be persisted, do NOT open checkout — the whole point is "no payment
        // without a committed acceptance record". The endpoint returns 2xx ONLY
        // after the row is committed, so res.ok ⇒ the evidence exists. On any
        // failure (non-2xx or network) we stop and let the user retry.
        let consentId: string | undefined;
        // ⚠️ SUNUCUNUN SEBEBİ EKRANA ÇIKMALI (denetim, 08-01). Eskiden gövde hiç
        // okunmuyordu: sunucu "Bu işletmenin zaten aktif bir aboneliği var" dese
        // bile host yalnız "Onayınız kaydedilemedi, tekrar deneyin" görüyor ve
        // sonsuza kadar tekrar deniyordu. Sebep varsa onu göster; yoksa genel
        // mesaja düş (ağ hatası / beklenmedik durum).
        let serverReason: string | undefined;
        // Ağ hatası ile sunucu reddi AYNI metni gösteriyordu (K3 envanteri A5) — müşteri bağlantısını mı kontrol etsin, tekrar mı denesin?
        let networkFailed = false;
        let res: Response | null = null;
        try {
          res = await fetch("/api/billing/consent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ planCode, priceId }),
          });
        } catch {
          /* network error → consentId stays undefined */
          networkFailed = true;
        }
        if (res) {
          // Gövde okunamazsa (boş / bozuk 5xx) ağ hatası DEĞİLDİR — sunucuya ulaşıldı, onay kaydı yazılamadı.
          let body: { consentId?: string; error?: string; fields?: Record<string, string>; correlationId?: string } = {};
          try {
            body = (await res.json()) as typeof body;
          } catch {
            body = {};
          }
          if (res.ok) {
            consentId = body.consentId;
          } else {
            serverReason = billingReason(body, BILLING_TEXT.consentFailed);
            setTrackingId(body.correlationId ?? null);
          }
        }
        if (!consentId) {
          setError(networkFailed ? BILLING_TEXT.network : (serverReason ?? BILLING_TEXT.consentFailed));
          return;
        }
        lastConsentRef.current = consentId;
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
        setError(BILLING_TEXT.checkoutOpenFailed);
      } finally {
        setBusy(false);
      }
    },
    [email, organizationId, accepted, busy, processing],
  );

  // Open Paddle's hosted customer portal (change plan / cancel / update card).
  // The link is generated server-side per request (single-use, short-lived), so
  // we fetch then redirect the whole tab to it. All proration/cancel logic lives
  // in Paddle's tested UI — we never compute charges here.
  const openPortal = useCallback(async () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setTrackingId(null);
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        fields?: Record<string, string>;
        correlationId?: string;
      };
      if (!res.ok || !data.url) {
        // Sunucunun sebebi gösterilir (K3 envanteri A7: 429 "çok fazla istek", 400 "abonelik bulunamadı" ve ağ hatası tek genel metne
        // düşüyordu); beklenmeyen hata (500) takip numaralı metni taşır.
        setError(billingReason(data, BILLING_TEXT.portalFailed));
        setTrackingId(data.correlationId ?? null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError(BILLING_TEXT.network);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Step 1: preview the change (Paddle computes the exact prorated charge) and open
  // the confirm panel. Never applies anything by itself.
  const startChange = useCallback(async (planCode: string, noticeOnSuccess?: string) => {
    if (changeBusy) return;
    setError(null);
    setNotice(null);
    setTrackingId(null);
    setChangeBusy(true);
    try {
      const res = await fetch("/api/billing/plan-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
        pendingVerification?: boolean;
        mode?: "upgrade" | "downgrade";
        targetName?: string;
        targetMonthlyMinor?: number;
        immediateTotal?: string | null;
        recurringTotal?: string | null;
        previewToken?: string;
        correlationId?: string;
      };
      if (data.pendingVerification) {
        // Önceki değişiklik hâlâ işleniyor: hata değil, bilgi (202 "onay bekleniyor" ile aynı görünüm — Haiku 10-17).
        setNotice(data.error ?? BILLING_TEXT.changePending);
        return;
      }
      if (!res.ok || !data.mode || !data.previewToken) {
        // ⚠️ SEBEP `fields.error` ALTINDA. `badRequest({ error })` gövdeyi
        // `{error:"Doğrulama hatası", fields:{error:"…"}}` diye kuruyor; yalnız
        // `data.error` okunduğunda kullanıcı HER retde jenerik "Doğrulama
        // hatası" görüyordu — "Aboneliğiniz iptal edilmiş", "Zaten bu
        // plandasınız" ve yıllık koruması dahil. Sebebi olmayan bir ret,
        // müşteriyi aynı butona sonsuza kadar bastırır (checkout tarafında
        // kapatılmış olan aynı kusur).
        setError(billingReason(data, BILLING_TEXT.previewFailed));
        setTrackingId(data.correlationId ?? null);
        return;
      }
      setPending({
        planCode,
        name: data.targetName ?? planCode,
        mode: data.mode,
        targetMonthlyMinor: data.targetMonthlyMinor ?? 0,
        immediateTotal: data.immediateTotal ?? null,
        recurringTotal: data.recurringTotal ?? null,
        previewToken: data.previewToken,
      });
      // "Tutar değişti" yalnız yeni tutar GERÇEKTEN gösterilebiliyorsa (Haiku 10-17: tutarı hesaplanamayan yükseltmede de sunucu aynı 409'u
      // veriyor; not "kontrol edin" derken panel "tutar hesaplanamadı" diyordu).
      if (noticeOnSuccess && !(data.mode === "upgrade" && !data.immediateTotal)) setNotice(noticeOnSuccess);
    } catch {
      setError(BILLING_TEXT.network);
    } finally {
      setChangeBusy(false);
    }
  }, [changeBusy]);

  // Step 2: apply the previewed change. Paddle charges/schedules; our webhook then
  // updates the local plan, so we refresh once it returns.
  const confirmChange = useCallback(async () => {
    if (!pending || changeBusy) return;
    setError(null);
    setNotice(null);
    setTrackingId(null);
    setChangeBusy(true);
    // 409 "tutar değişti" → yeni tutar OTOMATİK yeniden hesaplanıp onaya sunulur (K3 envanteri S13: pencere kapanıyor, yeni tutar
    // gösterilmiyordu; müşteri neyi onaylayacağını bilmeden düğmeye yeniden basmak zorundaydı).
    let refreshPlan: string | null = null;
    try {
      const res = await fetch("/api/billing/plan-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode: pending.planCode, previewToken: pending.previewToken }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
        ok?: boolean;
        amountChanged?: boolean;
        pending?: boolean;
        pendingVerification?: boolean;
        correlationId?: string;
      };
      if (data.pending) {
        // Ambiguous Paddle outcome (timeout/5xx): it may already be applied. We do NOT
        // re-send. Close the dialog and let the webhook settle the plan on refresh.
        setPending(null);
        setNotice(data.error ?? BILLING_TEXT.changePending);
        setTimeout(() => router.refresh(), 4000);
        return;
      }
      if (!res.ok || !data.ok) {
        // 409 = this preview is spent (single-use) or its amount moved. The dialog's
        // token is dead → close it so the next click mints a FRESH preview + amount.
        if (res.status === 409) setPending(null);
        if (res.status === 409 && data.amountChanged) {
          // `return` KULLANILMAZ: yeniden hesaplama `finally`den SONRA koşar (meşgul işareti inmiş olmalı).
          refreshPlan = pending.planCode;
        } else if (data.pendingVerification) {
          setNotice(data.error ?? BILLING_TEXT.changePending);
        } else {
          // Sağlayıcının ham sebebi artık gelmiyor (K3 envanteri C2); 400 sebebi `fields` altında (C1: "Doğrulama hatası" görünüyordu).
          setError(billingReason(data, BILLING_TEXT.changeFailed));
          setTrackingId(data.correlationId ?? null);
        }
      } else {
        setPending(null);
        // Give Paddle's webhook a moment to update the local plan, then refresh.
        setTimeout(() => router.refresh(), 2500);
      }
    } catch {
      setError(BILLING_TEXT.network);
    } finally {
      setChangeBusy(false);
    }
    if (refreshPlan) void startChange(refreshPlan, BILLING_TEXT.amountChanged);
  }, [pending, changeBusy, router, startChange]);

  // Index of the org's current plan in the (ordered) catalog, to label each card's
  // button as an upgrade or a downgrade.
  const currentIndex = plans.findIndex((p) => p.code === currentPlanCode);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Şu anki planınız:{" "}
        <strong className="text-foreground">
          {grandfathered ? "Tam erişim (daire sınırı yok)" : currentPlanName}
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
            — <strong className="text-destructive">{lapsedLabel(subscriptionStatus)}</strong>
          </>
        ) : null}
        .
      </p>

      {cancelScheduledUntil ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground" role="status" data-testid="cancel-scheduled-notice">
          {subscriptionStatus === "trialing"
            ? `Aboneliğinizin yenilenmesi iptal edildi. Deneme süreniz ${cancelScheduledUntil} tarihinde bitecek ve ücret alınmayacak. O tarihe kadar ${currentPlanName} paketinin tüm özelliklerini kullanabilirsiniz.`
            : `Aboneliğinizin yenilenmesi iptal edildi. ${cancelScheduledUntil} tarihine kadar ${currentPlanName} paketinin tüm özelliklerini kullanmaya devam edebilirsiniz. Bu tarihten sonra ücret alınmaz.`}
        </p>
      ) : null}

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

      {resumeEnabled && manageable && subscriptionStatus === "paused" ? (
        <ResumeSubscription
          plans={plans.map((p) => ({ code: p.code, name: p.name, priceMinor: p.priceMinor, currency: p.currency }))}
          currentPlanCode={currentPlanCode}
          locale={locale}
        />
      ) : null}

      {pending ? (
        <div className="space-y-2 rounded-md border border-primary/40 bg-accent/30 p-3">
          <p className="text-sm">
            {pending.mode === "upgrade" ? (
              pending.immediateTotal ? (
                <>
                  <strong>{pending.name}</strong> planına <strong>yükseltiyorsunuz</strong>. Şimdi{" "}
                  <strong>{pending.immediateTotal}</strong> tahsil edilecek, ardından aylık{" "}
                  {pending.recurringTotal ?? formatMinor(pending.targetMonthlyMinor, currency, locale)}.
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
                {pending.recurringTotal ?? formatMinor(pending.targetMonthlyMinor, currency, locale)}.
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
              onClick={() => {
                setPending(null);
                setNotice(null);
              }}
              disabled={changeBusy}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      {cardTrialNotice ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="card-trial-notice">
          {cardTrialNotice}
        </p>
      ) : null}

      {annualAvailable && !cardTrialNotice ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <BillingPeriodToggle
            value={period}
            /* Dönem değişince ön-bilgilendirme onayı SIFIRLANIR: onay,
               fiyatı ve süresi farklı BAŞKA bir sözleşmeye verilmişti. */
            onChange={(next) => {
              setPeriod(next);
              setAccepted(false);
            }}
            size="sm"
          />
          {/* ↑landing ile aynı gerekçe: aylıkta DAVET, yıllıkta ONAY. */}
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            {annual ? "2 ay bedava — yıllık seçildi" : "Yıllığa geçin, 2 ay bedava"}
          </span>
          <BillingPeriodAnnouncer value={period} />
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
          // Para birimi PLANDAN gelir; sembol JSX'e gömülü DEĞİL. Aksi hâlde
          // EUR fiyatlı bir deployment tutarı ₺ ile basardı — dönüşüm yapmadan
          // sembol değiştirmek yanlış beyandır.
          // 🚨 Başlık sayısı YILLIKTA DA AYLIKTIR (landing ile aynı karar):
          // yıllık toplamı başlığa koymak planı ilk bakışta 10 kat pahalı
          // gösterir. Gerçekte tahsil edilen tutar alt satırda yazılı.
          const price = formatMinor(
            annual ? p.annualMonthlyEquivalentMinor : p.priceMinor,
            p.currency,
            locale,
          );
          // ⚠️ Checkout'a giden id DÖNEME GÖRE seçilir. Yanlış id göndermek
          // müşteriyi başka bir fatura dönemine abone eder.
          // Kartla deneme: deneme süreli fiyat (kart alınır, deneme bitince tahsil). Fiyat yoksa düğme kapalı — normal (anında tahsilli) ödeme
          // ekranı "ücret alınmaz" metninin altında AÇILMAZ.
          const activePriceId = cardTrialNotice ? (p.trialPriceId ?? "") : annual ? p.annualPriceId : p.priceId;
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
                {price} <span className="text-xs font-normal text-muted-foreground">/ay</span>
              </p>
              {annual ? (
                <p className="text-xs text-muted-foreground">
                  yıllık {formatMinor(p.annualPriceMinor, p.currency, locale)} olarak faturalanır
                </p>
              ) : null}
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
                  // Duraklatılmış abonelikte paket değişmez (önce devam ettirilir — sunucu da reddeder; Haiku 10-17).
                  disabled={changeBusy || !p.priceId || pending !== null || annual || subscriptionStatus === "paused"}
                  onClick={() => void startChange(p.code)}
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isUpgrade ? "Yükselt" : "Düşür"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready || !activePriceId || !accepted || busy || manageable || processing}
                  onClick={() => openCheckout(p.code, activePriceId)}
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {manageable
                    ? "Yönetimden değiştirin"
                    : !ready
                      ? loadFailed
                        ? "Sayfayı yenileyin"
                        : "Yükleniyor…"
                      : cardTrialNotice
                        ? "Kart ekle"
                        : trialing
                          ? "Bu planı seç"
                          : "Bu plana geç"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {trialNotice && !manageable ? <p className="text-xs text-foreground">{trialNotice}</p> : null}
      {processing && !manageable ? <p className="text-xs text-muted-foreground">{CHECKOUT_PENDING_MESSAGE}</p> : null}
      {planChangeEnabled && annual ? <p className="text-xs text-muted-foreground">{BILLING_TEXT.annualChangeViaSupport}</p> : null}
      {notice ? (
        <p className="text-xs text-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {error && trackingId ? <TrackingNumberCopy id={trackingId} /> : null}
      <p className="text-[11px] text-muted-foreground">
        Ödeme, satıcı olarak Paddle üzerinden güvenli şekilde alınır; fatura ve KDV Paddle tarafından
        düzenlenir. İstediğiniz zaman iptal edebilirsiniz.
      </p>
    </div>
  );
}
