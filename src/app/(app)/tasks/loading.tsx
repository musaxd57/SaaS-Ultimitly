// ---------------------------------------------------------------------------
// GÖREVLER — yükleniyor iskeleti.
//
// SORUN (mesajlar sayfasında çözülmüştü, buraya taşınmamıştı): mülk filtre çipleri
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
      <span className="sr-only">Görevler yükleniyor…</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-28" />
          <Bar className="h-4 w-72" />
        </div>
        <Bar className="h-9 w-32" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bar className="h-7 w-16" />
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-28" />
        <Bar className="h-7 w-20" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, col) => (
          <div key={col} className="space-y-2 rounded-lg border border-border p-3">
            <Bar className="h-5 w-24" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <Bar className="h-4 w-3/4" />
                <Bar className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
