"use client";

import { useState } from "react";
import { Check, Copy, Download, CalendarClock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

interface CalendarFeedProps {
  feedUrl: string;
}

/**
 * Shows the property's public iCal feed URL with copy + download actions.
 * Paste the URL into Airbnb / Booking.com / Google Calendar to block the
 * exported reservation dates automatically.
 */
export function CalendarFeed({ feedUrl }: CalendarFeedProps) {
  const [copied, setCopied] = useState(false);

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
        <code className="flex-1 truncate text-xs" title={feedUrl}>
          {feedUrl}
        </code>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          {copied ? "Kopyalandı" : "Bağlantıyı kopyala"}
        </Button>
        <a href={feedUrl} download className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download className="size-4" /> .ics indir
        </a>
      </div>
    </div>
  );
}
