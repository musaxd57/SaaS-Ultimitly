import * as React from "react";
import { cn } from "@/lib/utils";
import { SlowLoadNotice } from "@/components/ui/slow-load-notice";

// ---------------------------------------------------------------------------
// YÜKLENİYOR İSKELETİ — TEK PRİMİTİF.
//
// Altı `loading.tsx` dosyası BİREBİR aynı `Bar` yardımcısını kendi içinde
// tanımlıyordu; biri düzeltilip diğerleri unutulursa sessizce ayrışırlar.
//
// ⚠️ ÜÇ ÖLÇÜ KURALI (ayrılırsa içerik geldiğinde SIÇRAR):
//  1. Kart iskeleti GERÇEK `Card` ile aynı sınıfları taşır — `rounded-xl border
//     border-border bg-card shadow-sm` (`ui/card.tsx`). `bg-card` OPSİYONEL
//     DEĞİL: karanlıkta `--card` (%13 L) ile `--background` (%8 L) FARKLI,
//     eksik bırakılırsa kutular içerik gelince gözle görülür biçimde AÇILIR.
//     Mevcut altı iskelet tam olarak bu hatayı taşıyordu.
//  2. Kök boşluk `space-y-6` — kabuğun kabı da öyle (`app-shell.tsx`).
//     `space-y-4` yazmak her aralığı 8 px kaydırır.
//  3. Genişlikler SABİT sınıf olmak ZORUNDA; Tailwind şablon-literalinden sınıf
//     üretemez (`w-[${x}]` derlenmez ve kutu genişliksiz kalır).
//
// Sunucu bileşeni: "use client" YOK, istemciye TEK BAYT JS gitmez.
// ---------------------------------------------------------------------------

/** Tek gri kutu. Ölçüyü ÇAĞIRAN verir (`h-*` / `w-*`). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("lxs-pulse rounded bg-muted", className)} />;
}

/** Gerçek `<Card>` ile BİREBİR aynı kabuk (↑kural 1). */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card shadow-sm", className)}>
      {children}
    </div>
  );
}

/** `PageHeader` ikizi — aynı kenarlık, aynı yükseklik. */
export function SkeletonPageHeader({
  titleWidth = "w-40",
  descWidth = "w-64",
  actions = 0,
}: {
  titleWidth?: string;
  descWidth?: string;
  actions?: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        {/* h1 text-xl/sm:text-2xl → 28/32 px satır kutusu */}
        <Skeleton className={cn("h-7 sm:h-8", titleWidth)} />
        {/* açıklama text-sm → 20 px */}
        <Skeleton className={cn("h-5", descWidth)} />
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Her `loading.tsx`'in kökü.
 *
 * 🚨 `lxs-in` = 120 ms GECİKMELİ görünürlük. 80 ms'de biten bir geçişte iskelet
 * HİÇ görünmez — "parlayıp kaybolan iskelet" hiç olmamasından KÖTÜDÜR ve
 * `loading.tsx` bir Suspense fallback'i olduğu için Next'te gecikme ayarı YOK.
 * `setTimeout` çözümü dosyayı istemci bileşenine çevirirdi (her rotaya JS).
 * CSS `animation-fill-mode: both`, gecikme boyunca `opacity: 0` uyguluyor.
 */
export function SkeletonScreen({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lxs-in space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
      {/* 10 sn'den uzun sürerse çıkış yolu (kullanıcı canlıda asılı kaldı, F5
          düzeltti). Otomatik yenileme BİLİNÇLİ olarak yok — ↓bileşendeki
          döngü gerekçesi. Tek istemci adası; bu dosya sunucu bileşeni kalıyor. */}
      <SlowLoadNotice />
    </div>
  );
}
