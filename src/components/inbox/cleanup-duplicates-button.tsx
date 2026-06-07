"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clean up stale duplicate conversations created when a channel was reconnected
 * (the same guest thread split across an old + new reservation). Safe: only
 * removes a copy whose messages are all already in the kept thread — confirms
 * first because it deletes conversations.
 */
export function CleanupDuplicatesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (
      !window.confirm(
        "Aynı misafir ve daire için bölünmüş tekrar konuşmalar temizlenecek. " +
          "Sadece tüm mesajları zaten güncel kopyada bulunan bayat kopyalar silinir — " +
          "hiçbir mesaj kaybolmaz. Devam edilsin mi?",
      )
    ) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/conversations/cleanup-duplicates", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const review = data.needsReview > 0 ? ` · ${data.needsReview} elle bakılmalı` : "";
        setResult({ ok: true, text: `${data.removed} tekrar silindi${review}` });
        router.refresh();
      } else {
        setResult({ ok: false, text: data.error ?? "Temizlik başarısız" });
      }
    } catch {
      setResult({ ok: false, text: "İstek gönderilemedi" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Kanal yeniden bağlanınca oluşan bölünmüş tekrar konuşmaları güvenle temizler — hiçbir mesaj kaybolmaz."
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
        {busy ? "Temizleniyor…" : "Tekrarları temizle"}
      </button>
      {result ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium",
            result.ok ? "text-emerald-600" : "text-destructive",
          )}
        >
          {result.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          {result.text}
        </span>
      ) : null}
    </div>
  );
}
