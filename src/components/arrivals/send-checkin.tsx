"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CHECKIN_NOW_TEXT } from "@/lib/checkin-now-text";

// ---------------------------------------------------------------------------
// UX-10 D5 (kurucu 11-13: "ilk 2'si kesinlikle olur"): Girişler satırından "Giriş mesajını gönderin". Dokununca onay penceresi açılır ve
// misafirin göreceği metnin TAM hâli o anda sunucudan istenir (liste HTML'inde yok; kapı kodu taşıyabilir). "Gönderin" önizlenen sürümle
// gider — metin bu arada değiştiyse sunucu reddeder. Gönderildikten sonra liste yenilenir (satır "gönderildi" olur). Belirsiz teslimde
// "ulaşmış olabilir" denir ve yeniden gönder SUNULMAZ. Pencere sözleşmesi: Escape, odak içeride, kapanınca düğmeye döner.
// ---------------------------------------------------------------------------

type Preview = { body: string; revision: number; propertyName: string; guestName: string | null };
type Phase =
  | { at: "closed" }
  | { at: "loading" }
  | { at: "ready"; preview: Preview }
  | { at: "sending"; preview: Preview }
  | { at: "done"; message: string; tone: "ok" | "warn" | "error" };

export const SEND_CHECKIN_LABEL = "Giriş mesajını gönderin";
export const SEND_CHECKIN_WARNING = "Bu mesaj misafirinize şimdi gider; geri alınamaz.";

export function SendCheckin({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ at: "closed" });
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const open = phase.at !== "closed";
  const url = `/api/reservations/${encodeURIComponent(reservationId)}/checkin-message`;

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPhase((p) => (p.at === "sending" ? p : { at: "closed" }));
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  async function openDialog() {
    setPhase({ at: "loading" });
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (Preview & { error?: string }) | null;
      if (!res.ok || !body || typeof body.body !== "string") {
        setPhase({ at: "done", message: body?.error ?? CHECKIN_NOW_TEXT.changed, tone: "error" });
        return;
      }
      setPhase({ at: "ready", preview: body });
    } catch {
      setPhase({ at: "done", message: "Bağlantı hatası. Lütfen tekrar deneyin.", tone: "error" });
    }
  }

  async function send(preview: Preview) {
    setPhase({ at: "sending", preview });
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: preview.revision }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; message?: string; error?: string } | null;
      if (res.ok && body?.ok) {
        setPhase({ at: "done", message: body.message ?? CHECKIN_NOW_TEXT.sent, tone: "ok" });
      } else {
        // Belirsiz teslim: uyarı tonu, YENİDEN GÖNDER YOK.
        setPhase({ at: "done", message: body?.error ?? CHECKIN_NOW_TEXT.definitive, tone: body?.code === "ambiguous" ? "warn" : "error" });
      }
      startTransition(() => router.refresh());
    } catch {
      setPhase({ at: "done", message: CHECKIN_NOW_TEXT.ambiguous, tone: "warn" });
      startTransition(() => router.refresh());
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => void openDialog()}
        data-send-checkin
        className="inline-flex min-h-10 items-center font-medium text-primary hover:underline sm:min-h-0"
      >
        {SEND_CHECKIN_LABEL}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8 dark:bg-black/60" onClick={() => phase.at !== "sending" && setPhase({ at: "closed" })}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="mt-8 w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="text-base font-semibold">
              {SEND_CHECKIN_LABEL}
            </h2>
            {phase.at === "loading" ? <p className="mt-3 text-sm text-muted-foreground">Mesaj hazırlanıyor…</p> : null}
            {phase.at === "ready" || phase.at === "sending" ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {phase.preview.propertyName}
                  {phase.preview.guestName ? ` · ${phase.preview.guestName}` : ""}
                </p>
                <div data-checkin-preview className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm">
                  {phase.preview.body}
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">{SEND_CHECKIN_WARNING}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPhase({ at: "closed" })}
                    disabled={phase.at === "sending"}
                    className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    Vazgeçin
                  </button>
                  <button
                    type="button"
                    onClick={() => phase.at === "ready" && void send(phase.preview)}
                    disabled={phase.at === "sending"}
                    className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {phase.at === "sending" ? "Gönderiliyor…" : "Gönderin"}
                  </button>
                </div>
              </>
            ) : null}
            {phase.at === "done" ? (
              <>
                <p
                  role={phase.tone === "ok" ? "status" : "alert"}
                  className={phase.tone === "ok" ? "mt-3 text-sm text-foreground" : phase.tone === "warn" ? "mt-3 text-sm text-amber-700 dark:text-amber-300" : "mt-3 text-sm text-destructive"}
                >
                  {phase.message}
                </p>
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => setPhase({ at: "closed" })} className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent">
                    Kapat
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
