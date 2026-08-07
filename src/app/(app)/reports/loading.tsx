// ---------------------------------------------------------------------------
// RAPORLAR — yükleniyor iskeleti.
//
// SORUN (mesajlar sayfasında çözülmüştü, buraya taşınmamıştı): dönem/filtre bağlantıları
// birer `<Link>`, yani her tıklama bir sunucu turu. Bu yolun kendi
// `loading.tsx`'i YOKKEN en yakın sınır olan `(app)/loading.tsx` devreye
// giriyor ve sayfanın TAMAMINI ortalanmış tek bir dönen simgeyle
// değiştiriyordu — başlık ve filtreler birlikte yok olup yeniden çiziliyordu.
// 200 ms'lik bir istek bile bu yüzden "ekran sıfırlandı" hissi veriyordu.
//
// ÇÖZÜM (davranış DEĞİŞMEDEN): iskelet AYNI YÜKSEKLİKTE yerinde kalır, yalnız
// içerik alanı gri satırlara döner. Tek bir sorgu bile değişmedi.
// ⚠️ Genişlikler SABİT sınıf olmalı — Tailwind şablon-literalinden sınıf
// üretemez (`w-[${x}px]` derlenmez ve kutu genişliksiz kalır).
// ---------------------------------------------------------------------------

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Raporlar yükleniyor…</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-28" />
          <Bar className="h-4 w-80" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border p-5">
            <Bar className="h-9 w-9" />
            <Bar className="h-4 w-24" />
            <Bar className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-lg border border-border p-5 lg:col-span-2">
          <Bar className="h-5 w-40" />
          <Bar className="h-48 w-full" />
        </div>
        <div className="space-y-3 rounded-lg border border-border p-5">
          <Bar className="h-5 w-32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Bar key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
