"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";

// ---------------------------------------------------------------------------
// "SAYFA UZUN SÜRDÜ" ÇIKIŞ YOLU — yükleniyor iskeletinin altında belirir.
//
// Kullanıcı canlıda yaşadı: bir geçişte sayfa yükleme ekranında ASILI KALDI,
// F5 attı ve anında düzeldi. İskelet tek başına o durumda hiçbir şey söylemiyor
// ve hiçbir çıkış sunmuyor — kullanıcı ekrana bakıp bekliyor.
//
// 🚨 OTOMATİK YENİLEME BİLİNÇLİ OLARAK YAPILMADI. Sayfa GERÇEKTEN açılamıyorsa
// (DB yavaş, oturum düştü, 500) otomatik `location.reload()` sonsuz bir döngüye
// girer: her N saniyede bir istek, kullanıcı hiçbir şey yapamaz, sunucu boşuna
// yüklenir. Karar kullanıcıda kalıyor.
//
// ⚠️ BU, TAKILMANIN SEBEBİNİ ÇÖZMEZ, yalnız kullanıcıyı sıkışmaktan kurtarır.
// Panel `force-dynamic` ve ~24 DB sorgusu koşuyor; biri yavaşlarsa sayfa bekler.
// Sebebin ölçülmesi ayrı bir iş.
//
// ⚠️ TEK İSTEMCİ ADASI: `loading.tsx` dosyalarının kendisi sunucu bileşeni
// KALIYOR (oraya `"use client"` koymak her rotaya JS bindirirdi). Yalnız bu
// küçük bileşen istemcide çalışıyor.
// ---------------------------------------------------------------------------

/** Kaç ms sonra çıkış yolu gösterilsin. Normal bir geçiş bunun çok altında biter. */
const SLOW_AFTER_MS = 10_000;

export function SlowLoadNotice() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  if (!slow) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
    >
      <span className="text-muted-foreground">
        {/* ⚠️ KESME İŞARETİ `&apos;` OLMAK ZORUNDA — JSX metninde ÇIPLAK `'`
            ESLint'in `react/no-unescaped-entities` kuralını kırar ve CI kırmızı
            olunca Railway deploy'u ATLAR (canlıda yaşandı: metin değişikliği
            "SKIPPED · CI check suite failed" olarak takıldı). Türkçede özel
            addan sonra kesme ZORUNLU olduğu için bu tuzağa sık düşülür. */}
        Sayfa&apos;nın açılması uzun sürdü. Sayfayı yenilemeyi deneyin.
      </span>
      <button
        type="button"
        // `location.reload()` — `router.refresh()` DEĞİL. Asılı kalan şey tam da
        // istemci-taraflı geçişin kendisi olabilir; tam sayfa yükleme o durumu
        // da sıfırlar (kullanıcının F5'i zaten bunu yapıp düzeltti).
        onClick={() => window.location.reload()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <RotateCw className="size-3.5" aria-hidden="true" />
        Yenile
      </button>
    </div>
  );
}
