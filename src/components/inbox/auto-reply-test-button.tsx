"use client";

import { useState } from "react";
import { FlaskConical, Loader2, X, Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

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
            role="dialog"
            aria-modal="true"
            aria-label="Oto-yanıt testi (önizleme)"
            className="mt-8 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-xl"
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
