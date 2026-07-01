"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toggle the Airbnb/Booking channel night auto-reply switch.
 * When on, safe and high-confidence guest messages inside the active-hours window
 * are answered automatically; complaints and risky messages still wait for a human.
 * `locked` (subscription not active) renders it inert with an upgrade hint — the
 * server suppresses automation anyway, this just avoids a misleading "Açık".
 */
export function AutoReplyToggle({
  field,
  label,
  enabled,
  title,
  locked = false,
}: {
  field: "autoReplyHospitable" | "autoWelcome" | "autoCheckin" | "autoCheckout";
  label: string;
  enabled: boolean;
  title?: string;
  locked?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (locked) return;
    const next = !on;
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (res.ok) {
        setOn(next);
        router.refresh();
      } else {
        window.alert("Ayar güncellenemedi.");
      }
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || locked}
      title={locked ? "Aboneliğiniz aktif değil — açmak için Ayarlar'dan bir plan seçin." : title}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        on && !locked
          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      {locked ? (
        <Lock className="size-4" />
      ) : busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Bot className="size-4" />
      )}
      {label}: {locked ? "yükseltin" : on ? "Açık" : "Kapalı"}
    </button>
  );
}
