"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// ---------------------------------------------------------------------------
// Cloudflare Turnstile widget'ı (kayıt formu, U15 — anahtar `SIGNUP_TURNSTILE_ENABLED`). Yalnız sunucu site anahtarı verdiğinde çizilir;
// betik `render=explicit` ile bir kez yüklenir, widget kendi kabına çizilir. Belirteç tek kullanımlıktır: form başarısız gönderimden sonra
// `reset()` çağırır, yeni belirteç gelene kadar gönder düğmesi kapalı kalır.
// ---------------------------------------------------------------------------

export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null; // sonraki çizimde yeniden denenebilsin
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  reset(): void;
}

export const TurnstileWidget = forwardRef<
  TurnstileHandle,
  { siteKey: string; action: string; onToken: (token: string) => void; onLoadError?: () => void }
>(function TurnstileWidget({ siteKey, action, onToken, onLoadError }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;
  const errorCb = useRef(onLoadError);
  errorCb.current = onLoadError;

  useImperativeHandle(ref, () => ({
    reset() {
      tokenCb.current("");
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          callback: (t: string) => tokenCb.current(t),
          "expired-callback": () => tokenCb.current(""),
          "error-callback": () => tokenCb.current(""),
        });
      })
      .catch(() => {
        if (!cancelled) errorCb.current?.();
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  return <div ref={box} data-testid="turnstile-box" className="flex min-h-[65px] justify-center" />;
});
