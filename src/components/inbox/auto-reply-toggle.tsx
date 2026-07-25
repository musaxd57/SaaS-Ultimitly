"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
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
        toast.error("Ayar güncellenemedi.");
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // DURUM ROZETİ görünümü, ama HÂLÂ bir anahtar. Başlıkta üç düğme yan yana
    // durup hepsi eşit ağırlıkta görünüyordu; artık tek primary komut "Yeni
    // konuşma", bu ise durumunu okutan sakin bir çip. Yükseklik/radius diğer
    // kontrollerle aynı (h-8 · rounded-md).
    //
    // Salt-okunur bir <span>'e ÇEVİRMEDİM: host oto-yanıtı buradan açıp
    // kapatıyor; kaldırmak bir yeteneği silmek olurdu (iş mantığına dokunma).
    // `aria-pressed` ile durum artık ekran okuyucuya da bildiriliyor — eskiden
    // yalnız görünür metindeydi.
    <button
      type="button"
      onClick={toggle}
      disabled={busy || locked}
      aria-pressed={locked ? undefined : on}
      title={locked ? "Aboneliğiniz aktif değil — açmak için Ayarlar'dan bir plan seçin." : title}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50",
        on && !locked
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-border bg-muted/50 text-muted-foreground hover:bg-accent",
      )}
    >
      {locked ? (
        <Lock className="size-3.5" aria-hidden="true" />
      ) : busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Bot className="size-3.5" aria-hidden="true" />
      )}
      {label}: {locked ? "yükseltin" : on ? "Açık" : "Kapalı"}
    </button>
  );
}
