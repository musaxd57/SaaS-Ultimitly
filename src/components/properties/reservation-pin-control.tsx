"use client";

import { useState } from "react";
import { KeyRound, Copy, Loader2 } from "lucide-react";

/**
 * Owner/manager control to generate a per-reservation QR chat PIN and reveal it
 * ONCE (the host relays it to the guest, e.g. in the check-in message). The PIN
 * is stored server-side only as a hash; regenerating invalidates the previous
 * one. Rendered only when the QR chat + PIN feature is enabled.
 */
export function ReservationPinControl({
  reservationId,
  initialHasPin,
}: {
  reservationId: string;
  initialHasPin: boolean;
}) {
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [pin, setPin] = useState<string | null>(null); // shown once after (re)generate
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/reservations/${reservationId}/chat-pin`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { pin?: string };
      if (!res.ok || !data.pin) {
        setError("Kod oluşturulamadı. Lütfen tekrar deneyin.");
        return;
      }
      setPin(data.pin);
      setHasPin(true);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${reservationId}/chat-pin`, { method: "DELETE" });
      if (!res.ok) {
        setError("Kaldırılamadı. Lütfen tekrar deneyin.");
        return;
      }
      setPin(null);
      setHasPin(false);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!pin) return;
    try {
      await navigator.clipboard?.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable — the PIN is visible on screen */
    }
  }

  return (
    <div className="mt-1 space-y-1">
      {pin ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1">
          <span className="font-mono text-sm tracking-[0.3em] text-amber-900">{pin}</span>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
          >
            <Copy className="size-3" /> {copied ? "Kopyalandı" : "Kopyala"}
          </button>
          <span className="text-[10px] text-amber-700">Bu kod bir daha gösterilmez — misafire iletin.</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
            {hasPin ? "Kodu yenile" : "Giriş kodu oluştur"}
          </button>
          {hasPin ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Kaldır
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
