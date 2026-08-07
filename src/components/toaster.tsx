"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { subscribeToasts, type ToastMessage } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Bilgi/başarı kendiliğinden kapanır; HATA kapanmaz (okunmadan gitmemeli). */
const AUTO_DISMISS_MS = 6000;
/**
 * Ekranı kaplamasın diye AYNI ANDA en fazla bu kadarı ÇİZİLİR — ama fazlası
 * ATILMAZ. Eskiden `slice(-MAX_VISIBLE)` uygulanıyordu: art arda 6 hata olunca
 * ilk ikisi iz bırakmadan siliniyordu, yani bu bileşenin kapatmak için var
 * olduğu "sessiz hata" sorununu kendisi üretiyordu. Artık taşanlar sayılır
 * ("+N önceki bildirim") ve görünenler kapatıldıkça sırayla ortaya çıkar.
 */
const MAX_VISIBLE = 4;
/**
 * Patolojik döngüye karşı sert tavan. 50 kapatılmamış bildirim birikmişse zaten
 * çok daha büyük bir arıza var; bellek/DOM'u korumak için en eskiler düşer.
 */
const HARD_CAP = 50;

const ICONS = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
} as const;

const STYLES = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  info: "border-border bg-card text-foreground",
} as const;

/**
 * Bildirim yığını. Kök layout'ta mount edilir → her rotada (pazarlama sayfaları
 * dahil) hazırdır, `toast()` çağıran bileşenin ağaçta nerede durduğu önemsizdir.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    return subscribeToasts((message) => {
      setItems((prev) => {
        const next = [...prev, message];
        return next.length > HARD_CAP ? next.slice(-HARD_CAP) : next;
      });
      if (message.variant !== "error") {
        setTimeout(() => dismiss(message.id), AUTO_DISMISS_MS);
      }
    });
  }, [dismiss]);

  if (items.length === 0) return null;

  // En yeniler çizilir; geride kalanlar SAYILIR ve görünenler kapatıldıkça
  // sırayla ortaya çıkar — hiçbiri sessizce kaybolmaz.
  const visible = items.slice(-MAX_VISIBLE);
  const hiddenCount = items.length - visible.length;

  return (
    <div
      // ROL ŞART: rolü olmayan bir <div>'e konan aria-label çoğu yardımcı
      // teknoloji tarafından YOK SAYILIR — yani etiket hiçbir işe yaramıyordu.
      // Bölge olarak işaretlenince kullanıcı bildirimlere gezinerek ulaşabilir.
      // Tek tek satırlar kendi canlı-bölge role'lerini ayrıca taşır.
      role="region"
      aria-label="Bildirimler"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {hiddenCount > 0 ? (
        <p
          // GÖRSEL amaçlı: sayaç ekran okuyucuya DUYURULMAZ. Her bildirim
          // zaten GELDİĞİ anda okundu (o sırada çiziliydi) ve görünenler
          // kapatıldıkça eskiler DOM'a geri eklenip yeniden duyuruluyor.
          // Canlı bölge yapılsaydı her değişimde "+2 önceki bildirim" tekrar
          // okunur, gerçek hataların üstünü örterdi.
          aria-hidden="true"
          className="pointer-events-auto w-full max-w-sm rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow"
        >
          +{hiddenCount} önceki bildirim — görünenleri kapatınca sırayla açılır
        </p>
      ) : null}
      {visible.map((t) => {
        const Icon = ICONS[t.variant];
        return (
          <div
            key={t.id}
            // Hata KESİNTİ ile duyurulur, diğerleri nazikçe.
            role={t.variant === "error" ? "alert" : "status"}
            className={cn(
              // `lxt-in`: giriş animasyonu. Toast'lar sert POP ediyordu; panelde
              // zaten tanımlı `fade-up` keyframe'i kullanılmıyordu. Reduced-motion
              // bloğu globals.css'te mevcut ve bunu da kapsıyor.
              "lxt-in pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg",
              STYLES[t.variant],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 leading-snug">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Bildirimi kapat"
              className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
