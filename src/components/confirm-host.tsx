"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { registerConfirmHandler, type ConfirmOptions } from "@/lib/confirm";

type Pending = { options: ConfirmOptions; resolve: (value: boolean) => void };

/**
 * Onay diyaloğunu ekrana basan tek yüzey. Kök layout'ta mount edilir.
 *
 * Uygulamadaki mobil drawer / şablon paneliyle AYNI sözleşme: role="dialog" +
 * aria-modal, adlandırılmış başlık, Escape ile kapanma, odak içeri alınır ve
 * kapanınca ÇAĞIRAN öğeye geri verilir.
 *
 * Kapanış yolu ne olursa olsun (onay, vazgeç, Escape, arka plan) söz MUTLAKA
 * çözülür — çözülmeyen bir söz, çağrı yerinde sessizce asılı kalan bir "sil"
 * işlemi demek olurdu.
 */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    return registerConfirmHandler(
      (options) =>
        new Promise<boolean>((resolve) => {
          restoreRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPending({ options, resolve });
        }),
    );
  }, []);

  const settle = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
    // Kullanıcı yerini kaybetmesin: odak çağıran düğmeye döner.
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore?.isConnected) restore.focus();
  }, []);

  useEffect(() => {
    if (!pending) return;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        settle(false); // Escape = vazgeç (yıkıcı işlemde güvenli yön)
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pending, settle]);

  if (!pending) return null;

  const { title, body, confirmLabel, cancelLabel, destructive } = pending.options;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {body ? (
          <p id={bodyId} className="mt-1.5 text-sm text-muted-foreground">
            {body}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => settle(false)}>
            {cancelLabel ?? "Vazgeç"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={() => settle(true)}
          >
            {confirmLabel ?? "Onayla"}
          </Button>
        </div>
      </div>
    </div>
  );
}
