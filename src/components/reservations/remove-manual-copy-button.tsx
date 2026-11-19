"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

/**
 * "Bu kaydı kaldır" (UA-1, kurucu 11-19) — karşılaştırma sayfasında elle / dosyayla girilmiş kopyanın kartında. Kayıt KALICI silinir →
 * önce AYNI satırda kısa onay ("Bu kayıt silinsin mi?" + Sil / Vazgeç; İK-3 ile aynı biçim ve odak düzeni). İstek yalnız onaydaki "Sil"
 * ile gider. Sayfanın adres anahtarı silinen satırsa sayfa kalan bir satırın anahtarına geçer (yoksa yenileme 404 olurdu).
 */
export function RemoveManualCopyButton({
  reservationId,
  pageKey,
  fallbackKey,
}: {
  reservationId: string;
  /** Sayfanın adres anahtarı (satır kimliği). */
  pageKey: string;
  /** Bu satır silinirse sayfanın geçeceği kalan satırın kimliği (yoksa `null` → panele dönülür). */
  fallbackKey: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusTriggerLater = () => requestAnimationFrame(() => trigger.current?.focus());

  function afterGone() {
    if (reservationId !== pageKey) router.refresh();
    else router.replace(fallbackKey ? `/reservations/compare/${encodeURIComponent(fallbackKey)}` : "/dashboard");
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(reservationId)}/manual-copy`, { method: "DELETE" });
      // 404 = kayıt zaten silinmiş (başka sekmede) → hata değil.
      if (res.ok || res.status === 404) {
        afterGone();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? "Silinemedi. Sayfayı yenileyip tekrar deneyin.");
      // 409: kayıt artık kaynağa bağlı — sayfa yenilenir, kart eylemsiz görünür.
      if (res.status === 409) router.refresh();
      setConfirming(false);
      focusTriggerLater();
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
      setConfirming(false);
      focusTriggerLater();
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs" data-testid="manual-copy-confirm">
        <span>Bu kayıt silinsin mi?</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs text-destructive"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          Sil
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          autoFocus
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            focusTriggerLater();
          }}
        >
          Vazgeç
        </Button>
      </span>
    );
  }
  return (
    <Button ref={trigger} type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setConfirming(true)}>
      Bu kaydı kaldır
    </Button>
  );
}
