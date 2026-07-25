"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { subscribeToasts, type ToastMessage } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Bilgi/başarı kendiliğinden kapanır; HATA kapanmaz (okunmadan gitmemeli). */
const AUTO_DISMISS_MS = 6000;
/** Ekranı kaplamasın: en yeni N bildirim tutulur. */
const MAX_VISIBLE = 4;

const ICONS = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
} as const;

const STYLES = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800",
  info: "border-border bg-card text-foreground",
} as const;

/**
 * Bildirim yığını. Kök layout'ta mount edilir → her rotada (pazarlama sayfaları
 * dahil) hazırdır, `toast()` çağıran bileşenin ağaçta nerede durduğu önemsizdir.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    return subscribeToasts((message) => {
      setItems((prev) => [...prev, message].slice(-MAX_VISIBLE));
      if (message.variant !== "error") {
        setTimeout(() => dismiss(message.id), AUTO_DISMISS_MS);
      }
    });
  }, [dismiss]);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
      // Yığının kendisi bir bölge; tek tek satırlar kendi role'lerini taşır.
      aria-label="Bildirimler"
    >
      {items.map((t) => {
        const Icon = ICONS[t.variant];
        return (
          <div
            key={t.id}
            // Hata KESİNTİ ile duyurulur, diğerleri nazikçe.
            role={t.variant === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg",
              STYLES[t.variant],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1 leading-snug">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Bildirimi kapat"
              className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
