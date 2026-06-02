"use client";

import { useState } from "react";
import { FlaskConical, Loader2, X, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface MessagePreview {
  guest: string;
  property: string;
  hasEntry: boolean;
  alreadySent: boolean;
  body: string | null;
}

/**
 * Dry-run a guest message (welcome or check-out) for upcoming reservations —
 * shows the exact text that would be sent, per guest, WITHOUT sending anything.
 */
export function MessagePreviewButton({
  endpoint,
  label,
  missingNote,
}: {
  endpoint: string;
  label: string;
  missingNote: string;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<MessagePreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setPreviews(data.previews as MessagePreview[]);
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

  const missing = previews?.filter((p) => !p.hasEntry) ?? [];

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={runTest} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
        {label} (gönderMEZ)
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 sm:p-8">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{label}</h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                aria-label="Kapat"
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Gönderilecek metnin önizlemesi. Hiçbir şey gönderilmedi.
            </p>

            {error ? (
              <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {missing.length > 0 ? (
              <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {missing.length} dairede {missingNote} ({" "}
                {[...new Set(missing.map((m) => m.property))].join(", ")} ) — bunlara gönderilmez.
              </p>
            ) : null}

            <div className="mt-3 space-y-3">
              {previews && previews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Yaklaşan (45 gün içinde) uygun rezervasyon bulunamadı.
                </p>
              ) : null}
              {previews
                ?.filter((p) => p.hasEntry)
                .map((p, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{p.guest}</span>
                      <Badge tone="muted">{p.property}</Badge>
                      {p.alreadySent ? (
                        <Badge tone="success">
                          <Check className="mr-1 size-3" /> Zaten gönderildi
                        </Badge>
                      ) : null}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                      {p.body}
                    </pre>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
