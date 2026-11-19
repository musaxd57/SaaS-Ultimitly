"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

/**
 * "Yanlış kopyayı kaldır" (UA-1, kurucu 11-19; düğme adı kurucunun işlem adı, 11-19 akşam madde 4 — "Rezervasyonu iptal et" AYRI bir
 * işlemdir, bu ekranda yok) — karşılaştırma sayfasında elle / dosyayla girilmiş kopyanın kartında. Kayıt KALICI silinir → önce AYNI satırda
 * kısa onay ("Bu kayıt silinsin mi?" + Sil / Vazgeç; İK-3 ile aynı biçim ve odak düzeni). İstek yalnız onaydaki "Sil" ile gider. Sayfanın
 * adres anahtarı silinen satırsa sayfa kalan bir satırın anahtarına geçer (yoksa yenileme 404 olurdu). 409'da satır yerindedir: sunucunun
 * cümlesi gösterilir ve liste kendiliğinden bu satırın anahtarıyla yenilenir (son kopyada sayfa "Rezervasyonu aç" gösterir).
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

  /**
   * 409: bu satır YERİNDE (son kopya ya da arada kaynağa bağlandı). Sayfa bu satırın anahtarıyla yeniden çizilir — sayfanın anahtarı öteki
   * yöneticinin az önce kaldırdığı kopya olabilir (eski iki ekran, iki farklı kopya), o anahtarla yenileme 404 olurdu.
   */
  function showThisRow() {
    if (reservationId === pageKey) router.refresh();
    else router.replace(`/reservations/compare/${encodeURIComponent(reservationId)}`);
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
      const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      const message = body?.error ?? "Silinemedi. Sayfayı yenileyip tekrar deneyin.";
      // Son kopya hata değildir: kaldırılmak istenen kopya artık tek kayıt (öteki kopya başka yerden kaldırıldı) — neden bilgi olarak
      // gösterilir. Kaynağa bağlanan kayıt ve öteki hatalar hata bildirimi.
      if (res.status === 409 && body?.code === "last_copy") toast.info(message);
      else toast.error(message);
      if (res.status === 409) showThisRow();
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
      Yanlış kopyayı kaldır
    </Button>
  );
}
