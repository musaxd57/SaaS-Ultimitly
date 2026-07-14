"use client";

import { useState } from "react";
import { KeyRound, Copy, Loader2, MessageSquareText } from "lucide-react";

/**
 * Owner/manager control to generate a per-reservation QR chat PIN and reveal it
 * ONCE (the host relays it to the guest, e.g. in the check-in message). The PIN
 * is stored server-side only as a hash; regenerating invalidates the previous
 * one. Rendered only when the QR chat + PIN feature is enabled.
 *
 * UX notes (user feedback round):
 *  - Removal asks for an explicit INLINE confirmation that spells out the
 *    consequence in both org modes (strict OFF → chat opens without a code;
 *    strict ON → chat stays locked until a new code exists).
 *  - "Airbnb mesaj taslağını kopyala" builds a ready-to-send TR+EN message with
 *    the code CLIENT-SIDE from the just-shown PIN — nothing is stored, nothing
 *    is auto-sent; the host pastes/edits/sends it themselves on the channel.
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
  const [draftCopied, setDraftCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    setDraftCopied(false);
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
      setConfirmRemove(false);
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

  /** Ready-to-send channel message (TR + EN). Built in-memory from the shown
   *  PIN; never persisted, never sent automatically — the host approves it. */
  function airbnbDraft(p: string): string {
    return (
      `Merhaba! Dairedeki QR yardım sohbeti için giriş kodunuz: ${p}\n` +
      `QR'ı okutup bu kodu girmeniz yeterli.\n\n` +
      `Hello! Your access code for the in-apartment QR help chat: ${p}\n` +
      `Just scan the QR and enter this code.`
    );
  }

  async function copyDraft() {
    if (!pin) return;
    try {
      await navigator.clipboard?.writeText(airbnbDraft(pin));
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable — the PIN is visible on screen */
    }
  }

  return (
    <div className="mt-1 space-y-1">
      {pin ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5">
          <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => void copyDraft()}
            className="inline-flex h-6 w-fit items-center gap-1 rounded px-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
          >
            <MessageSquareText className="size-3" />
            {draftCopied ? "Taslak kopyalandı" : "Airbnb mesaj taslağını kopyala"}
          </button>
        </div>
      ) : confirmRemove ? (
        <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2">
          <p className="text-[11px] text-foreground">
            Bu rezervasyonun giriş kodu kaldırılacak. İşletme genelinde kod zorunluluğu kapalıysa
            misafir QR sohbetine kod girmeden erişebilir; zorunluluk açıksa yeni bir kod
            oluşturulana kadar bu konaklamanın sohbeti kilitli kalır. Devam edilsin mi?
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              disabled={busy}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex h-7 items-center rounded-md border border-destructive/40 px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null} Kodu kaldır
            </button>
          </div>
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
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              className="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Giriş kodunu kaldır
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
