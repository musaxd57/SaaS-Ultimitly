"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshAfterBilling } from "@/components/settings/refresh-after-billing";
import { formatMinor } from "@/lib/utils";
import { BILLING_TEXT, billingReason } from "@/lib/billing/billing-ui-text";

// ---------------------------------------------------------------------------
// I4 C (kurucu 10-17) — "Aboneliği devam ettir". Yalnız DURAKLATILMIŞ Paddle aboneliğinde ve `PADDLE_RESUME_ENABLED` açıkken çizilir.
// C2: bütün paketler görünür (önceki paket işaretli). C1: onayda büyük yazı ("Pro planınız hemen açılır.") + altında küçük yazıyla
// tahsilat ("₺899 kayıtlı kartınızdan şimdi tahsil edilecek."). Tutar Paddle'dan; okunamazsa onay açılmaz. Kart reddi → kart güncelleme
// bağlantısı (Paddle'ın güvenli sayfası, yeni sekme). Başka paket seçilirse önce önceki paket devam eder, paket değişikliği ardından
// paket kartlarından (tutarı ayrıca gösterilir) — Paddle duraklatılmış abonelikte paket değişikliğine izin veriyorsa tek adıma iner (P3).
// ---------------------------------------------------------------------------

export interface ResumePlanOption {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
}

/** Sonucu belirsiz istek (Haiku 10-17): ödeme alınmış da olabilir, alınmamış da — sonuç vaat edilmez. */
const UNCERTAIN = "İşleminizin sonucu henüz kesinleşmedi. Birkaç dakika sonra sayfayı yenileyin; ödemeniz alındıysa aboneliğiniz açılmış olur.";

type Preview = { planCode: string; planName: string; amount: string; confirm: { headline: string; fine: string }; previewToken: string };

export function ResumeSubscription({
  plans,
  currentPlanCode,
  locale,
}: {
  plans: ResumePlanOption[];
  currentPlanCode: string;
  locale: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(currentPlanCode);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardUpdateUrl, setCardUpdateUrl] = useState<string | null>(null);
  const current = plans.find((p) => p.code === currentPlanCode);
  // Klavye odağı (erişilebilirlik 10-22): açan düğme kalkınca odak sayfanın başına düşüyordu. Paket seçimi açılınca seçili pakete, tutar onayı
  // açılınca "Vazgeç"e iner (yanlışlıkla Enter ödeme almasın); vazgeçince açan düğmeye, sonuç gelince durum satırına / "Devam et"e döner.
  const openTriggerRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusLater = (target: () => HTMLElement | null) => requestAnimationFrame(() => target()?.focus());
  const ids = useId();

  async function loadPreview(noticeText?: string) {
    setBusy(true);
    setError(null);
    setCardUpdateUrl(null);
    try {
      const res = await fetch("/api/billing/resume-preview", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Partial<Preview> & { error?: string; fields?: Record<string, string>; pendingVerification?: boolean };
      if (data.pendingVerification) {
        setNotice(data.error ?? BILLING_TEXT.changePending);
        focusLater(() => noticeRef.current);
        return;
      }
      if (!res.ok || !data.previewToken || !data.confirm || !data.amount) {
        setError(billingReason(data, "Tutar şu anda hesaplanamadı; ödeme alınmadı. Birkaç dakika sonra tekrar deneyin."));
        // "Devam et" istek sürerken kilitliydi (odak sayfa başına düşmüş olabilir) — kilit kalkınca ona dön, yeniden denenebilsin (Haiku 10-22).
        focusLater(() => previewTriggerRef.current);
        return;
      }
      setPreview(data as Preview);
      if (noticeText) setNotice(noticeText);
    } catch {
      setError(BILLING_TEXT.network);
      focusLater(() => previewTriggerRef.current);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let again: string | null = null;
    try {
      const res = await fetch("/api/billing/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewToken: preview.previewToken }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        pending?: boolean;
        pendingVerification?: boolean;
        amountChanged?: boolean;
        cardUpdateUrl?: string | null;
        error?: string;
        fields?: Record<string, string>;
      };
      if (res.ok && data.ok) {
        setPreview(null);
        setOpen(false);
        setNotice("Aboneliğiniz devam ettirildi. Birkaç saniye içinde açılacak.");
        focusLater(() => noticeRef.current);
        refreshAfterBilling(router);
        return;
      }
      if (data.pending) {
        setPreview(null);
        setNotice(data.error ?? BILLING_TEXT.changePending);
        focusLater(() => noticeRef.current);
        refreshAfterBilling(router);
        return;
      }
      setPreview(null);
      focusLater(() => previewTriggerRef.current);
      if (res.status === 402) {
        setError(data.error ?? "Ödeme alınamadı. Kart bilgilerinizi güncelleyin.");
        setCardUpdateUrl(data.cardUpdateUrl ?? null);
      } else if (res.status === 409 && data.amountChanged) {
        again = "Tutar değişti. Yeni tutarı kontrol edip yeniden onaylayın.";
      } else if (data.pendingVerification) {
        setNotice(data.error ?? BILLING_TEXT.changePending);
      } else if (typeof data.error === "string" || data.fields) {
        // Sunucunun KESİN cevabı (ret / zaten etkin / tutar okunamadı) — kendi metni.
        setError(billingReason(data, UNCERTAIN));
      } else {
        // Sunucudan okunabilir cevap yok (zaman aşımı / ağ geçidi hatası): ödeme ALINMIŞ olabilir — "alınmadı" DENMEZ (Haiku 10-17).
        setNotice(UNCERTAIN);
        focusLater(() => noticeRef.current);
        refreshAfterBilling(router);
      }
    } catch {
      // Bağlantı istek yolda koptu: istek Paddle'a ulaşmış olabilir → sonuç vaat edilmez, sayfa yenilenir.
      setPreview(null);
      setNotice(UNCERTAIN);
      focusLater(() => noticeRef.current);
      refreshAfterBilling(router);
    } finally {
      setBusy(false);
    }
    if (again) await loadPreview(again);
  }

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-accent/30 p-3" data-testid="resume-subscription">
      {!open ? (
        <button
          ref={openTriggerRef}
          type="button"
          onClick={() => {
            setOpen(true);
            setNotice(null);
          }}
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Aboneliği devam ettir
        </button>
      ) : (
        <div className="space-y-2">
          <p id={`${ids}-plans`} className="text-sm font-medium">
            Paketinizi seçin
          </p>
          <div role="radiogroup" aria-labelledby={`${ids}-plans`} className="space-y-1">
            {plans.map((p) => (
              <label key={p.code} className="flex items-center gap-2 text-sm">
                <input type="radio" name="resume-plan" checked={chosen === p.code} onChange={() => setChosen(p.code)} autoFocus={chosen === p.code} />
                <span>
                  {p.name} — {formatMinor(p.priceMinor, p.currency, locale)} / ay
                  {p.code === currentPlanCode ? <span className="ml-1 text-xs text-muted-foreground">(önceki paketiniz)</span> : null}
                </span>
              </label>
            ))}
          </div>
          {chosen !== currentPlanCode && current ? (
            <p className="text-xs text-muted-foreground">
              Önce önceki paketiniz ({current.name}) devam ettirilir; ardından aşağıdaki paket kartlarından{" "}
              {plans.find((p) => p.code === chosen)?.name ?? "seçtiğiniz pakete"} geçebilirsiniz (fark ayrıca gösterilir).
            </p>
          ) : null}
          {preview ? (
            <div
              role="group"
              aria-labelledby={`${ids}-headline`}
              aria-describedby={`${ids}-fine`}
              className="space-y-1 rounded-md border border-border bg-background p-3"
            >
              <p id={`${ids}-headline`} className="text-base font-semibold">
                {preview.confirm.headline}
              </p>
              <p id={`${ids}-fine`} className="text-[11px] leading-snug text-muted-foreground">
                {preview.confirm.fine}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={busy}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "İşleniyor…" : `${preview.amount} öde ve devam ettir`}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    setPreview(null);
                    focusLater(() => previewTriggerRef.current);
                  }}
                  disabled={busy}
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                ref={previewTriggerRef}
                type="button"
                onClick={() => void loadPreview()}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Hesaplanıyor…" : chosen !== currentPlanCode && current ? `Önce ${current.name} ile devam et` : "Devam et"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  focusLater(() => openTriggerRef.current);
                }}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                Vazgeç
              </button>
            </div>
          )}
        </div>
      )}
      {notice ? (
        <p ref={noticeRef} role="status" tabIndex={-1} className="text-xs text-muted-foreground outline-none">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
          {cardUpdateUrl ? (
            <>
              {" "}
              <a href={cardUpdateUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Kart bilgilerini güncelle
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
