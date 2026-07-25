"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Download, Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pull guest conversations from Hospitable (Airbnb / Booking) into the inbox.
 * Read-only against Hospitable — nothing is sent. Shows the result inline.
 */
export function HospitableSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function sync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/hospitable/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const capped = data.propertiesCapped ?? 0;
        setResult({
          ok: true,
          text:
            `${data.properties ?? 0} mülk · ${data.reservations ?? 0} rezervasyon · ${data.conversations} konuşma · ${data.messages} yeni mesaj` +
            (capped > 0 ? ` · ${capped} mülk plan limiti nedeniyle eklenmedi (planınızı yükseltin)` : ""),
        });
        router.refresh();
      } else {
        setResult({ ok: false, text: data.error ?? "Çekme başarısız" });
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
        onClick={sync}
        disabled={busy}
        title="Airbnb / Booking konuşmalarını Hospitable'dan çek (sadece okuma — hiçbir şey gönderilmez)"
        // Kompakt SECONDARY: başlıktaki tek primary komut "Yeni konuşma".
        // Yükseklik/radius diğer kontrollerle aynı (h-8 · rounded-md = 6px).
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-muted-foreground")}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {busy ? "Çekiliyor…" : "Mesajları çek"}
      </button>
      {result ? (
        <span
          // Uzun süren çekme işleminin TEK sonucu bu satır; canlı bölge olmadan
          // ekran okuyucu kullanıcısı ne başarıyı ne hatayı duyuyordu.
          role="status"
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
