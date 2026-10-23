"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Panel içi hata sınırı.
 *
 * Bu dosya olmadan `(app)` altındaki bir sayfa patladığında en yakın boundary
 * kök `app/error.tsx` oluyordu — o da `(app)/layout.tsx`in DIŞINDA. Host tek bir
 * hatada sol menüyü, üst barı, kısacası uygulamayı komple kaybedip tam ekran bir
 * hata sayfasına düşüyordu; oradan panele dönüş yolu yoktu (yalnız pazarlama
 * sitesine "Ana sayfa" linki).
 *
 * Next.js'te error.tsx yalnız segmentin ÇOCUKLARINI sarar, kendi layout'unu
 * değil → kabuk ayakta kalır, kullanıcı yerini kaybetmez.
 *
 * Ham hata metni EKRANA BASILMAZ (mesaj DB sorgusu/PII taşıyabilir); yalnız
 * destek konuşmasında işe yarayan digest gösterilir.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Panel hatası:", error?.digest ?? "digest yok");
  }, [error]);

  return (
    <Card role="alert">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">Bu sayfa yüklenemedi</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Beklenmedik bir hata oluştu. Verilerinizde bir kayıp yok — tekrar deneyebilir ya da
            panele dönebilirsiniz.
          </p>
          {error?.digest ? (
            <p className="pt-1 text-xs text-muted-foreground">
              Destek referansı: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>
            <RotateCw className="size-4" /> Tekrar dene
          </Button>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
            Panele dön
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
