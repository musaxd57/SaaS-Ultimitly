"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

  async function loadPreview(noticeText?: string) {
    setBusy(true);
    setError(null);
    setCardUpdateUrl(null);
    try {
      const res = await fetch("/api/billing/resume-preview", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Partial<Preview> & { error?: string; fields?: Record<string, string>; pendingVerification?: boolean };
      if (data.pendingVerification) {
        setNotice(data.error ?? BILLING_TEXT.changePending);
        return;
      }
      if (!res.ok || !data.previewToken || !data.confirm || !data.amount) {
        setError(billingReason(data, "Tutar şu anda hesaplanamadı; ödeme alınmadı. Birkaç dakika sonra tekrar deneyin."));
        return;
      }
      setPreview(data as Preview);
      if (noticeText) setNotice(noticeText);
    } catch {
      setError(BILLING_TEXT.network);
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
        setTimeout(() => router.refresh(), 2500);
        return;
      }
      if (data.pending) {
        setPreview(null);
        setNotice(data.error ?? BILLING_TEXT.changePending);
        setTimeout(() => router.refresh(), 4000);
        return;
      }
      setPreview(null);
      if (res.status === 402) {
        setError(data.error ?? "Ödeme alınamadı. Kart bilgilerinizi güncelleyin.");
        setCardUpdateUrl(data.cardUpdateUrl ?? null);
      } else if (res.status === 409 && data.amountChanged) {
        again = "Tutar değişti. Yeni tutarı kontrol edip yeniden onaylayın.";
      } else if (data.pendingVerification) {
        setNotice(data.error ?? BILLING_TEXT.changePending);
      } else {
        setError(billingReason(data, "Aboneliğiniz devam ettirilemedi; ödeme alınmadı. Lütfen tekrar deneyin, sorun sürerse bize yazın."));
      }
    } catch {
      setError(BILLING_TEXT.network);
    } finally {
      setBusy(false);
    }
    if (again) await loadPreview(again);
  }

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-accent/30 p-3" data-testid="resume-subscription">
      {!open ? (
        <button
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
          <p className="text-sm font-medium">Paketinizi seçin</p>
          <div className="space-y-1">
            {plans.map((p) => (
              <label key={p.code} className="flex items-center gap-2 text-sm">
                <input type="radio" name="resume-plan" checked={chosen === p.code} onChange={() => setChosen(p.code)} />
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
            <div className="space-y-1 rounded-md border border-border bg-background p-3">
              <p className="text-base font-semibold">{preview.confirm.headline}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">{preview.confirm.fine}</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={busy}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "İşleniyor…" : "Onayla"}
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
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
                type="button"
                onClick={() => void loadPreview()}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Hesaplanıyor…" : "Devam et"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
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
        <p role="status" className="text-xs text-muted-foreground">
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
