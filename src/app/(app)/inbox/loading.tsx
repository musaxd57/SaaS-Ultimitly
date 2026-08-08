// ---------------------------------------------------------------------------
// MESAJLAR — yükleniyor iskeleti.
//
// SORUN: filtre sekmeleri birer `<Link>`, yani her tıklama bir sunucu turu. Bu
// yolun kendi `loading.tsx`'i YOKTU, dolayısıyla en yakın sınır olan
// `(app)/loading.tsx` devreye giriyordu — o da sayfanın TAMAMINI ortalanmış tek
// bir dönen simgeyle değiştiriyordu. Yani "Beklemede"ye basınca başlık, filtre
// çubuğu ve arama kutusu birlikte yok oluyor, sonra hepsi yeniden çiziliyordu.
// 200 ms'lik bir istek bile bu yüzden "ekran sıfırlandı" hissi veriyordu.
//
// ÇÖZÜM (davranış DEĞİŞMEDEN): sayfanın iskeleti yerinde kalıyor — başlık ve
// filtre çubuğu aynı yükseklikte duruyor, yalnız LİSTE alanı iskelet satırlara
// dönüyor. Veri yine sunucudan geliyor, tek bir sorgu bile değişmedi; değişen
// şey, bekleme sırasında ekranın çökmemesi.
//
// ⚠️ GERÇEKTEN ANLIK yapmak (tıklar tıklamaz filtreleme) veriyi tarayıcıya
// taşımayı gerektirir; bu, sayfalama ve sayaç mantığının ikinci bir kopyası
// demek — bilerek YAPILMADI (kullanıcı kararı: "veriler o hızla geliyorsa risk
// alma"). Bu dosya riski sıfır olan kısmı alıyor.
// ---------------------------------------------------------------------------

function Bar({ className }: { className: string }) {
  return <div className={`lxs-pulse rounded bg-muted ${className}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Konuşmalar yükleniyor…</span>

      {/* Başlık bandı — gerçek PageHeader ile aynı yükseklikte. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-40" />
          <Bar className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-8 w-32" />
          <Bar className="h-8 w-28" />
          <Bar className="h-8 w-44" />
          <Bar className="h-9 w-36" />
        </div>
      </div>

      {/* Filtre çubuğu — tıklanan sekmenin yeri KAYBOLMASIN diye aynı ölçüde. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Genişlikler SABİT sınıflar — Tailwind şablon-literalinden sınıf
            üretemez (`w-[${x}px]` derlenmez ve kutu genişliksiz kalırdı). */}
        <div className="flex gap-2">
          <Bar className="h-9 w-16" />
          <Bar className="h-9 w-14" />
          <Bar className="h-9 w-24" />
          <Bar className="h-9 w-24" />
          <Bar className="h-9 w-20" />
          <Bar className="h-9 w-24" />
        </div>
        <Bar className="h-9 w-64" />
      </div>

      {/* Liste — sayfa boyutuna değil, ekranı dolduracak makul bir sayıya göre. */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Bar className="h-4 w-48" />
                <Bar className="h-3 w-3/4" />
              </div>
              <Bar className="h-5 w-20 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
