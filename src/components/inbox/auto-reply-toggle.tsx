"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { useRestoreFocusOnIdle } from "@/lib/use-restore-focus";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  upgradeHref,
  variant = "chip",
  describedBy,
}: {
  field: "autoReplyHospitable" | "autoWelcome" | "autoCheckin" | "autoCheckout";
  label: string;
  enabled: boolean;
  title?: string;
  locked?: boolean;
  /** Kilitliyken plan sayfasına bağlantı (UX 10-21 G: kilitli düğme çıkışsızdı). Yalnız hesap sahibine verilir — başka rol sekmeyi görmez. */
  upgradeHref?: string;
  /**
   * Görünüm. `chip` (varsayılan): Mesajlar başlığındaki sakin durum çipi. `switch` (kurucu 10-22 U5, Ayarlar'daki "Otomasyon durumu"
   * kartı): gerçek açma / kapama anahtarı — ray + top, `role="switch"`; adı satırdaki başlıktan (`label`), açıklaması `describedBy`.
   */
  variant?: "chip" | "switch";
  /** `switch` görünümünde satır açıklamasının kimliği (ekran okuyucu anahtarla birlikte okur). */
  describedBy?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  // `disabled={busy}` odağı düşürür; anahtarın yeni hâlinin duyulması için
  // odak geri verilir (gerekçe: lib/use-restore-focus.ts).
  const { ref: btnRef, arm } = useRestoreFocusOnIdle<HTMLButtonElement>(busy);

  async function toggle() {
    arm();
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

  if (variant === "switch") {
    const active = on && !locked;
    return (
      <span className="inline-flex shrink-0 items-center gap-2">
        {/* Durum renkle değil yazıyla da okunur (WCAG 1.4.1); anahtarın kendisi `aria-checked` ile duyurulur. */}
        <span
          aria-hidden="true"
          className={cn(
            "w-12 text-right text-xs font-medium",
            active
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          {locked ? "Kilitli" : active ? "Açık" : "Kapalı"}
        </span>
        <button
          ref={btnRef}
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={label}
          aria-describedby={describedBy}
          onClick={toggle}
          disabled={busy || locked}
          title={
            locked
              ? "Aboneliğiniz aktif değil — açmak için bir plan seçin."
              : title
          }
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
            // Kapalı ray kart zemininden en az 3:1 ayrışır (WCAG 1.4.11); durum ayrıca yanındaki "Açık / Kapalı" yazısıyla okunur.
            active
              ? "bg-emerald-600 dark:bg-emerald-500"
              : "bg-muted-foreground/70",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200",
              active ? "translate-x-5" : "translate-x-0",
            )}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : locked ? (
              <Lock className="size-3 text-muted-foreground" />
            ) : null}
          </span>
        </button>
      </span>
    );
  }

  if (locked && upgradeHref) {
    return (
      <Link
        href={upgradeHref}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <Lock className="size-3.5" aria-hidden="true" />
        {label}: planınızı seçin
      </Link>
    );
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
      ref={btnRef}
      type="button"
      onClick={toggle}
      disabled={busy || locked}
      aria-pressed={locked ? undefined : on}
      title={
        locked
          ? "Aboneliğiniz aktif değil — açmak için Ayarlar'dan bir plan seçin."
          : title
      }
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50",
        on && !locked
          ? "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
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
