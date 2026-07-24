"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, X, Check, Clock } from "lucide-react";

interface Preview {
  guestIdentifier: string;
  propertyName: string;
  wouldSend: boolean;
  reply: string | null;
  confidence: number | null;
  reason: string | null;
}

/**
 * Dry-run the channel auto-reply and show what the AI WOULD send — without
 * sending anything. Lets the user judge quality before enabling the live night
 * auto-reply.
 */
export function AutoReplyTestButton({ locked = false }: { locked?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Modal contract (Codex 07-24 #8 — same pattern as the mobile drawer in
  // app-shell): body scroll-lock + Escape close + focus move-in/trap/restore.
  // role="dialog" aria-modal alone announces a modal without behaving like one.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // arkaplan modal altında kaymasın
    const prevFocus = document.activeElement as HTMLElement | null;
    // Cleanup uses the trigger captured when the effect RAN (ref.current may
    // have changed by cleanup time — same lint rule as the drawer).
    const trigger = triggerRef.current;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Focus trap: Tab cycles inside the dialog (keyboard/screen-reader users
      // never land on the inert background).
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Focus restore: back to whatever opened the modal (else the trigger).
      (prevFocus ?? trigger)?.focus?.();
    };
  }, [open]);

  async function runTest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/hospitable/auto-reply-test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setPreviews(data.previews as Preview[]);
        setOpen(true);
      } else {
        setError(data.error ?? "Önizleme başarısız oldu.");
        setOpen(true);
      }
    } catch {
      setError("İstek gönderilemedi.");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const willSend = previews?.filter((p) => p.wouldSend) ?? [];
  const willWait = previews?.filter((p) => !p.wouldSend) ?? [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={runTest}
        disabled={busy || locked}
        title={
          locked
            ? "Aboneliğiniz aktif değil — açmak için Ayarlar'dan bir plan seçin."
            : "Oto-yanıtın şu an ne göndereceğini göster — hiçbir şey gönderilmez (test)."
        }
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
        {busy ? "Hazırlanıyor…" : "Oto-yanıt testi"}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Oto-yanıt testi (önizleme)"
            tabIndex={-1}
            className="mt-8 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-xl outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold">Oto-yanıt testi (önizleme)</h2>
                <p className="text-xs text-muted-foreground">
                  Hiçbir mesaj gönderilmedi — sadece AI&apos;ın ne göndereceği gösteriliyor.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                aria-label="Kapat"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : previews && previews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Cevap bekleyen (misafirin son yazdığı) konuşma yok. Önce &quot;Mesajları çek&quot;e basın.
                </p>
              ) : (
                <>
                  {willSend.length > 0 ? (
                    <section className="space-y-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                        <Check className="size-3.5" /> AI bunları otomatik gönderir ({willSend.length})
                      </p>
                      {willSend.map((p) => (
                        <div key={`${p.propertyName}|${p.guestIdentifier}`} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{p.guestIdentifier}</span>
                            {p.propertyName ? <span>· {p.propertyName}</span> : null}
                            {p.confidence != null ? (
                              <span className="ml-auto">%{Math.round(p.confidence * 100)} emin</span>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap text-sm">{p.reply}</p>
                        </div>
                      ))}
                    </section>
                  ) : null}

                  {willWait.length > 0 ? (
                    <section className="space-y-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                        <Clock className="size-3.5" /> Bunlar size bırakılır ({willWait.length})
                      </p>
                      {willWait.map((p) => (
                        <div key={`${p.propertyName}|${p.guestIdentifier}`} className="rounded-lg border border-border bg-muted/30 p-3">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{p.guestIdentifier}</span>
                            {p.propertyName ? <span>· {p.propertyName}</span> : null}
                            <span className="ml-auto">{reasonLabel(p.reason)}</span>
                          </div>
                        </div>
                      ))}
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function reasonLabel(reason: string | null): string {
  switch (reason) {
    case "low_confidence_or_risky":
      return "emin değil / riskli";
    case "complaint":
      return "şikayet";
    case "already_answered":
      return "zaten cevaplandı";
    default:
      return "elle cevap";
  }
}
