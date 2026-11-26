"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/marketing/reveal";
import {
  BillingPeriodToggle,
  BillingPeriodAnnouncer,
  type BillingPeriod,
} from "@/components/billing-period-toggle";

// ---------------------------------------------------------------------------
// LANDING FİYAT KARTLARI — aylık/yıllık seçicisi yüzünden client adası.
//
// ⚠️ FİYAT DİZGİLERİ BURADA HESAPLANMAZ, PROP OLARAK GELİR. `landing-page.tsx`
// bir sunucu bileşeni ve fiyatları `defaultPlans()`tan okuyor; buraya ham sayı
// taşımak "fiyatlar tek kaynaktan gelir" değişmezini delerdi (sayfanın kendi
// yorumu bunu açıkça yasaklıyor: daha önce landing kendi "₺449" dizgisini
// taşıyordu ve sessizce ayrışabiliyordu).
// ---------------------------------------------------------------------------

export type PricingTier = {
  name: string;
  planCode: string;
  desc: string;
  features: string[];
  highlight: boolean;
};

export type TierPrices = {
  /** "₺899" — aylık ödeyenin gördüğü. */
  monthly: string;
  /** "₺749" — yıllık ödeyenin AYLIK karşılığı (kıyas için). */
  monthlyEquivalent: string;
  /** "₺8.990" — yıllıkta gerçekten tahsil edilen tutar. */
  annualTotal: string;
};

export function PricingTiers({
  tiers,
  prices,
  annualAvailable = false,
}: {
  tiers: PricingTier[];
  /** planCode → fiyat dizgileri (sunucuda biçimlendirilmiş). */
  prices: Record<string, TierPrices>;
  /**
   * Üç kademenin de YILLIK Paddle fiyat id'si env'de var mı?
   *
   * 🚨 KAPI ŞART — landing, ayarların satabildiğinden FAZLASINI vaat ETMEMELİ.
   * Bu prop olmadan sayfa "Yıllık" seçeneğini ve "2 ay bedava" rozetini
   * KOŞULSUZ gösteriyordu; env'ler eksik bir kurulumda (yerel geliştirme, .eu,
   * ya da biri env'i silerse) ziyaretçi yıllığı seçip Ayarlar'a gidiyor ve
   * orada yalnız aylık buluyordu. Ayarlar tarafı zaten aynı kapıyı kullanıyor.
   */
  annualAvailable?: boolean;
}) {
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const annual = annualAvailable && period === "year";

  return (
    <>
      {annualAvailable ? (
      <div className="mt-8 flex flex-col items-center gap-2">
        <BillingPeriodToggle value={period} onChange={setPeriod} />
        {/* ⚠️ ÜSTÜ ÇİZİLİ FİYAT BİLİNÇLİ OLARAK KULLANILMADI. Türkiye'de üstü
            çizili fiyat bir İNDİRİM iddiasıdır (Ticari Reklam Yönetmeliği) ve
            referans dönemde gerçekten uygulanmış bir "eski fiyat" ister. ₺899
            eski fiyat değil — toggle'ın diğer konumunda HÂLÂ SATILAN güncel
            fiyat. Bunun yerine sözün kendisi tek bir rozetle söyleniyor. */}
        {/* 🚨 ROZET METNİ DÖNEME GÖRE DEĞİŞİR — sabit "2 ay bedava" YAZMA.
            Aylık seçiliyken serbest duran bir "2 ay bedava" rozeti, AYLIK
            fiyatın içinde iki ay hediye varmış gibi okunuyordu (kullanıcı
            ekran görüntüsüyle bildirdi). Aylıkta bir DAVET ("yıllığa geç"),
            yıllıkta bir ONAY ("aldın") olmalı — ikisi de aynı sözü söylüyor
            ama hangi seçeneğe ait olduğu artık cümlenin içinde. */}
        <Badge tone="success">
          {annual ? "2 ay bedava — yıllık seçildi" : "Yıllığa geçin, 2 ay bedava"}
        </Badge>
      </div>
      ) : null}
      {annualAvailable ? <BillingPeriodAnnouncer value={period} /> : null}

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {tiers.map((t, i) => {
          const p = prices[t.planCode];
          return (
            <Reveal
              key={t.name}
              delay={i * 90}
              className={cn(
                "card-lift flex flex-col rounded-xl border bg-card p-6",
                t.highlight ? "border-primary shadow-lg ring-1 ring-primary" : "border-border",
              )}
            >
              {t.highlight ? (
                <span className="mb-3 inline-flex w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                  En popüler
                </span>
              ) : null}
              <h3 className="text-lg font-semibold">{t.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>

              {/* 🚨 YILLIKTA DA BAŞLIK SAYISI AYLIKTIR — ₺8.990 YAZMA.
                  Kartın tamamı aylık zihin modeli üzerine kurulu ("daire başına
                  değil, sabit ücret"). Başlığa yıllık toplamı koymak, yıllığı
                  ilk bakışta 10 KAT PAHALI gösterir ve toggle'ın kazanmak için
                  var olduğu kıyası öldürür. ₺749'u ₺899'un yanına koymak
                  tasarrufu hiçbir indirim dili kullanmadan okutur.
                  Alt satır OPSİYONEL DEĞİL: ₺749 × 12 = ₺8.988 ≠ ₺8.990, yani
                  gerçekten tahsil edilen tutarı yazan şey o satır. Yuvarlama
                  gizlenmiyor, açıklanıyor. */}
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold">
                  {/* `—` yedeği KORUNDU (eski JSX'ten): fiyat haritasında kalem
                      yoksa boş bir başlık yerine tire görünür. Boş bırakmak,
                      kartı "ücretsiz" gibi okutabilirdi. */}
                  {(annual ? p?.monthlyEquivalent : p?.monthly) ?? "—"}
                </span>
                <span className="text-sm text-muted-foreground">/ay</span>
              </div>
              <p
                className={cn(
                  "mt-1 text-xs",
                  annual ? "text-muted-foreground" : "invisible",
                )}
              >
                {/* Aylıkta da yer AYRILIR (invisible), yoksa toggle'a basınca
                    üç kart birden zıplıyor. */}
                {annual ? `yıllık ${p?.annualTotal} olarak faturalanır` : " "}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {t.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={cn(
                  buttonVariants({ variant: t.highlight ? "default" : "outline" }),
                  "mt-6 w-full",
                )}
              >
                Başla
              </Link>
            </Reveal>
          );
        })}
      </div>
    </>
  );
}
