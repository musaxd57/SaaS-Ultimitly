"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Download, Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRestoreFocusOnIdle } from "@/lib/use-restore-focus";

/**
 * Pull guest conversations from Hospitable (Airbnb / Booking) into the inbox.
 * Read-only against Hospitable — nothing is sent. Shows the result inline.
 */
export function HospitableSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Uzun süren çekme işlemi boyunca düğme disabled → odak <body>'ye düşerdi;
  // sonuç role="status" ile duyuruluyor ama klavye kullanıcısı yerini
  // kaybediyordu (gerekçe: lib/use-restore-focus.ts).
  const { ref: btnRef, arm } = useRestoreFocusOnIdle<HTMLButtonElement>(busy);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function sync() {
    arm();
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
        setResult({ ok: false, text: data.error ?? "Mesajlar çekilemedi. Lütfen tekrar deneyin." });
      }
    } catch {
      setResult({ ok: false, text: "İstek gönderilemedi. Lütfen tekrar deneyin." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        ref={btnRef}
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
        {busy ? "Mesajlar çekiliyor…" : "Mesajları çek"}
      </button>
      {/*
        DÜRÜST BEKLEME METNİ. İşlem gerçekten dakikalar sürebiliyor (tüm
        rezervasyon penceresi sayfalanıyor) ve tek geri bildirim dönen bir
        simgeydi — host "takıldı mı?" diye ikinci kez basıyordu. Gerçek bir
        ilerleme yüzdesi göstermek sunucu tarafında adım adım raporlama ister;
        bu satır aynı belirsizliği kuruşuna mal olmadan gideriyor.
      */}
      {busy ? (
        <span role="status" className="text-xs text-muted-foreground">
          Bu birkaç dakika sürebilir — sayfayı kapatmayın.
        </span>
      ) : null}
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
