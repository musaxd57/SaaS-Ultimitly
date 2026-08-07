// ---------------------------------------------------------------------------
// MİSAFİR SOHBETLERİ — yükleniyor iskeleti.
//
// SORUN (mesajlar sayfasında çözülmüştü, buraya taşınmamıştı): sayfalama bağlantıları
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
      <span className="sr-only">Misafir sohbetleri yükleniyor…</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-48" />
          <Bar className="h-4 w-72" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Bar className="h-4 w-44" />
                <Bar className="h-3 w-3/4" />
              </div>
              <Bar className="h-5 w-16 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
