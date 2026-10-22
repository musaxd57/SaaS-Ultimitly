"use client";

import { useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

/**
 * QR SOHBET EKRANINDA "CİHAZ KİLİDİNİ SIFIRLA" (kurucu 10-22 U1 (c), "Olur 3'ü birden"). Sohbet her konaklamada onu ilk açan cihaza
 * bağlanır; misafir telefonunu değiştirdiğinde / çerezleri silindiğinde ya da bağlantıyı saklayan başka biri önce açtığında gerçek
 * misafir "sohbet başka cihazda başladı" görür. Düğme eskiden yalnız mülk sayfasındaydı — misafirin yazdığı ekrandan da sıfırlanır
 * (aynı uç `api/properties/[id]/reset-chat`, aynı yetki: sahip / yönetici). Önce kısa onay: sıfırlamadan sonra karekodu İLK okutan cihaz
 * bağlanır (sohbet kodu açıksa kodu bilen).
 */
export function ResetDeviceButton({ propertyId }: { propertyId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/reset-chat`, { method: "POST" });
      if (!res.ok) {
        setError("Sıfırlanamadı. Lütfen tekrar deneyin.");
        return;
      }
      setConfirming(false);
      setDone(true);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div role="group" aria-label="Cihaz kilidini sıfırlama onayı" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
        <span className="text-xs text-foreground">
          Sıfırlansın mı? Misafir karekodu tekrar okuttuğunda yeni cihazı bağlanır.
        </span>
        <button
          type="button"
          autoFocus
          onClick={() => {
            setConfirming(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          disabled={busy}
          className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null} Evet, sıfırla
        </button>
        {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setDone(false);
          setConfirming(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" /> Cihaz kilidini sıfırla
      </button>
      {done ? (
        <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
          Sıfırlandı — misafir sayfayı yeniden açabilir.
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">Misafir sohbete ulaşamıyorsa (telefon değişti, çerezler silindi).</span>
      )}
    </div>
  );
}
