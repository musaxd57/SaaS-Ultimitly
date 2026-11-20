"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Çipi şeridin ortasına getiren yatay konum (saf). Sola taşmaz (0'ın altı yok); sağ uç sınırını tarayıcı kendisi keser. Geniş ekranda
 * şerit sarar ve kaymaz — atanan değer orada etkisizdir.
 */
export function centeredScrollLeft(chipLeft: number, chipWidth: number, stripWidth: number): number {
  return Math.max(0, Math.round(chipLeft - (stripWidth - chipWidth) / 2));
}

export interface PropertyFilterChip {
  /** React anahtarı (daire kimliği; "tümü" çipi için sabit bir ad). */
  key: string;
  href: string;
  label: string;
  active: boolean;
}

/**
 * Daire süzgeci çipleri (Görevler · Takvim · İptaller — üç sayfada üç ayrı kopyaydı, biçimleri de ayrışmıştı).
 *
 * Telefonda TEK SATIR, yana kaydırılır; `sm` ve üstünde bugünkü gibi alt satıra sarar. Gerekçe (FB gezisi 11-20 akşam, gerçek uygulama
 * 390 px): 12 dairede çipler 5 satır tutuyor, sayfanın asıl içeriği (takvim, görev panosu) ilk ekranın altına iniyordu; plan sınırı 25
 * daire — o sayıda süzgeç ekranın tamamını kaplar. Şerit kenar payını aşarak ekran kenarında kesilir (devamı olduğu görünür).
 *
 * Seçili çip sayfa açılınca şeridin ortasına gelir: 10. daire seçiliyken şerit baştan başlasaydı kullanıcı hangi süzgecin açık olduğunu
 * göremezdi. Kaydırma YALNIZ şeridin kendi yatay konumudur (`scrollLeft`) — `scrollIntoView` kullanılmaz: sayfa aşağıdayken (geri
 * dönüşte kaydırma konumu geri yüklenince) pencereyi de yukarı çekerdi. Görünür metinler çağıranın verdiğiyle AYNI.
 */
export function PropertyFilterChips({ items, label = "Daire süzgeci" }: { items: PropertyFilterChip[]; label?: string }) {
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const activeKey = items.find((i) => i.active)?.key ?? null;

  useEffect(() => {
    const nav = navRef.current;
    const chip = activeRef.current;
    if (!nav || !chip) return;
    nav.scrollLeft = centeredScrollLeft(chip.offsetLeft - nav.offsetLeft, chip.offsetWidth, nav.clientWidth);
  }, [activeKey]);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      data-property-filter
      className="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          ref={item.active ? activeRef : undefined}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            // `shrink-0 whitespace-nowrap`: tek satırlık şeritte çip ezilmez / kırılmaz. Telefonda dokunma yüksekliği 40 px (ürünün ölçüsü,
            // pin `tests/unit/phone-touch-targets.test.ts`); sm ve üstünde sıkı ölçü.
            "inline-flex min-h-10 max-w-[14rem] shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors sm:min-h-0",
            item.active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent",
          )}
        >
          <span className="truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
