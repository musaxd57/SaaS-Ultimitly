"use client";

import { cn } from "@/lib/utils";

export type BillingPeriod = "month" | "year";

// ---------------------------------------------------------------------------
// AYLIK / YILLIK SEÇİCİ — landing fiyat kartları VE ayarlar faturalandırma
// kartları aynı bileşeni kullanır (iki ayrı kopya, iki ayrı davranış demekti).
//
// ⚠️ ERİŞİLEBİLİRLİK DESENİ: `role="group"` + iki `aria-pressed` butonu.
// Deponun ZATEN kullandığı desen budur (`properties/calendar-sources.tsx`,
// `inbox/auto-reply-toggle.tsx`); kaynakta tek bir `role="radiogroup"`,
// `role="tablist"` veya `role="switch"` YOK.
//  · `radiogroup` DEĞİL: doğru bir radiogroup gezici `tabindex` + ok tuşu
//    yönetimi ister; bu depoda o altyapı hiç yok ve YARIM kurulmuş bir
//    radiogroup (iki radyo da Tab'lanabilir, ok tuşu çalışmaz) ekran okuyucu
//    için düz butondan DAHA KÖTÜDÜR.
//  · `switch` DEĞİL: switch açık/kapalıdır, "Aylık" bir "kapalı" hâli değildir.
//  · Yatay tab-strip DENENDİ VE KULLANICI TARAFINDAN KALDIRILDI (yatay kaydırma
//    çubuğu) — tekrar önerilmemeli.
// İki düz buton Tab ile gezilir, Space/Enter ile çalışır ve basılı durum
// odaktaki öğede değiştiği için ekran okuyucu tarafından yeniden seslendirilir.
// ---------------------------------------------------------------------------

export function BillingPeriodToggle({
  value,
  onChange,
  size = "md",
  className,
}: {
  value: BillingPeriod;
  onChange: (next: BillingPeriod) => void;
  /** Ayarlar paneli daha küçük bir ölçekte çalışıyor. */
  size?: "sm" | "md";
  className?: string;
}) {
  const options: [BillingPeriod, string][] = [
    ["month", "Aylık"],
    ["year", "Yıllık"],
  ];
  return (
    <div
      role="group"
      aria-label="Faturalandırma dönemi"
      className={cn(
        "flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1",
        className,
      )}
    >
      {options.map(([period, label]) => {
        const active = value === period;
        return (
          <button
            key={period}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(period)}
            className={cn(
              "rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fiyatların değiştiğini ekran okuyucuya duyurur.
 *
 * ⚠️ Gerekli çünkü kullanıcının odağı butonda kalıyor: butonun kendi basılı
 * durumu değişiyor ama SAYFANIN GERİ KALANI (üç kartın fiyatı) sessizce
 * güncelleniyordu. Görmeyen kullanıcı için toggle'ın bir şey yaptığına dair
 * tek kanıt bu satır.
 */
export function BillingPeriodAnnouncer({ value }: { value: BillingPeriod }) {
  return (
    <p className="sr-only" aria-live="polite">
      {value === "year" ? "Yıllık fiyatlar gösteriliyor" : "Aylık fiyatlar gösteriliyor"}
    </p>
  );
}
