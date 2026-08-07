// ---------------------------------------------------------------------------
// TAKVİM — yükleniyor iskeleti.
//
// SORUN (mesajlar sayfasında çözülmüştü, buraya taşınmamıştı): önceki/sonraki ay bağlantıları
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
      <span className="sr-only">Takvim yükleniyor…</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-32" />
          <Bar className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-9" />
          <Bar className="h-9 w-28" />
          <Bar className="h-9 w-9" />
        </div>
      </div>
      <div className="flex gap-2">
        <Bar className="h-7 w-20" />
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-20" />
      </div>
      <div className="rounded-lg border border-border p-5">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 42 }).map((_, i) => (
            <Bar key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
