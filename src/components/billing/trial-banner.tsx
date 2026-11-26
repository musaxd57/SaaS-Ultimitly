"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { trialBannerStage, trialBannerSnoozeCookie } from "@/lib/billing/trial-banner";
import { cn } from "@/lib/utils";

/**
 * Deneme bandı (UX-8, kurucu 11-13: büyük ürünlerin kalıbı). Kademeli: son 7 gün nötr, son 3 gün amber, son gün kalın; bitişte (yalnız
 * faturalandırma zorunluyken) kapatılamaz. Kapatma aşamaya göre 24 / 12 / 4 saat (↓`lib/billing/trial-banner.ts`). Hiçbir zaman engellemez.
 */
export function TrialBanner({
  daysLeft,
  endsLabel,
  endsDayWord,
  automationStops,
}: {
  daysLeft: number;
  /** Bitiş tarihi ("18 Kasım"), işletmenin saat diliminde. */
  endsLabel: string | null;
  /** Son günde "bugün" / "yarın". */
  endsDayWord: "bugün" | "yarın" | null;
  /** Süre dolunca otomatik yanıtlar gerçekten kapanıyor mu (faturalandırma zorunlu) — değilse bunu söylemeyiz. */
  automationStops: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  const stage = trialBannerStage(daysLeft);
  if (hidden || stage === "calm") return null;

  const when = endsLabel ? ` (${endsLabel})` : "";
  const label =
    stage === "ended"
      ? "Ücretsiz deneme süreniz doldu — devam için bir plan seçin."
      : stage === "last"
        ? `Denemeniz ${endsDayWord ?? "yarın"} bitiyor${when}.${automationStops ? " Bittiğinde otomatik yanıtlar kapanır." : ""}`
        : `Denemenizin bitmesine ${daysLeft} gün kaldı${when}.`;

  function snooze() {
    if (stage === "ended" || stage === "calm") return;
    try {
      document.cookie = trialBannerSnoozeCookie(window.location.protocol === "https:", stage);
    } catch {
      // Çerez yazılamasa da bant bu sayfa ömrü boyunca kapanır.
    }
    setHidden(true);
  }

  return (
    <div
      data-trial-stage={stage}
      className={cn(
        "relative flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border px-9 py-2 text-center text-sm",
        stage === "info"
          ? "border-border bg-muted/50 text-foreground"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
        (stage === "last" || stage === "ended") && "font-medium",
      )}
    >
      <span>{label}</span>
      <Link href="/settings?tab=faturalandirma" className="font-medium underline underline-offset-2">
        Plan seçin
      </Link>
      {stage !== "ended" ? (
        <button
          type="button"
          onClick={snooze}
          aria-label="Kapat"
          title="Kapat"
          className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8 dark:hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
