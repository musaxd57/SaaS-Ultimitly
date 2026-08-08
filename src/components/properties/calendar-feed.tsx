"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmDialog } from "@/lib/confirm";

interface CalendarFeedProps {
  feedUrl: string;
  propertyId: string;
}

/**
 * Shows the property's public iCal feed URL with copy + download actions.
 * Paste the URL into Airbnb / Booking.com / Google Calendar to block the
 * exported reservation dates automatically.
 */
export function CalendarFeed({ feedUrl, propertyId }: CalendarFeedProps) {
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // GERİ ALINAMAZ işlem: eski adres anında ölür ve ona abone olan kanallar
  // sessizce güncelleme almayı bırakır. O yüzden iki adımlı onay ve onay
  // metninde çift-rezervasyon uyarısı — uyarısız düz bir buton burada
  // ayağa sıkan bir silahtır.
  async function rotate() {
    const ok = await confirmDialog({
      title: "Takvim bağlantısını yenilemek istiyor musunuz?",
      body:
        "Şu anki bağlantı ANINDA geçersiz olur. Airbnb, Booking.com veya Google Takvim'e eklediyseniz, " +
        "yeni bağlantıyı oralara tekrar yapıştırmanız gerekir — yapmazsanız o kanallar bu dairenin dolu " +
        "günlerini görmez ve ÇİFT REZERVASYON alabilirsiniz. Yalnızca bağlantı başkasının eline geçtiyse yenileyin.",
      confirmLabel: "Yenile",
      destructive: true,
    });
    if (!ok) return;
    setRotating(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/rotate-ical`, { method: "POST" });
      if (!res.ok) {
        setError("Bağlantı yenilenemedi. Lütfen tekrar deneyin.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setRotating(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Bağlantıyı kopyalayın:", feedUrl);
    }
  }

  return (
    <div className="space-y-2.5">
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
        Bu bağlantıyı Airbnb / Booking.com / Google Takvim&apos;e ekleyerek rezervasyon
        tarihlerini otomatik bloke edebilirsiniz.
      </p>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        {/* min-w-0: flex çocuğu varsayılan `min-width:auto` ile kendi
            min-content'inin altına inemez; adres tek parça (nowrap) olduğu için
            `truncate` o hâlde ASLA devreye girmez ve satır kabını taşırır.
            Sayfanın yatay kaymasını asıl kapatan şey mülk sayfasındaki grid
            çocuklarının min-w-0'ı, ama kısıt burada DOĞUYOR — bu bileşen başka
            (daraltılabilir) bir kaba taşınırsa koruma onunla birlikte gelsin. */}
        <code className="min-w-0 flex-1 truncate text-xs" title={feedUrl}>
          {feedUrl}
        </code>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-4" />}
          {copied ? "Kopyalandı" : "Bağlantıyı kopyala"}
        </Button>
        <a href={feedUrl} download className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download className="size-4" /> .ics indir
        </a>
        <Button variant="outline" size="sm" onClick={rotate} disabled={rotating}>
          {rotating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Bağlantıyı yenile
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">
        Bu bağlantıyı bilen herkes bu dairenin dolu günlerini görebilir. Yanlış birine gittiyse
        &quot;Bağlantıyı yenile&quot; ile eskisini geçersiz kılabilirsiniz.
      </p>
    </div>
  );
}
