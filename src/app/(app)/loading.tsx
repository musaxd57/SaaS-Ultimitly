import { Skeleton, SkeletonCard, SkeletonPageHeader, SkeletonScreen } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// PANELİN GENEL yükleniyor iskeleti — kendi `loading.tsx`i OLMAYAN rotalar
// (bilgi tabanı, şablonlar, iptaller, faturalandırma, hazırlık, operatör).
//
// Öncesinde burada boş bir 60vh kutusunun ortasında tek bir dönen çember vardı.
// Sayfa şekilleri birbirinden farklı olduğu için burada BAŞLIK + TEK GENİŞ KART
// kullanılıyor: her rotada doğru olan en fazla ortak yapı bu. Rotaya özel
// iskelet yazmak, düşük trafikli sayfalarda drift yüzeyi açar; 120 ms gecikme
// zaten çoğu geçişte bunu hiç göstermiyor.
//
// ⚠️ `animate-spin` KULLANILMIYOR: bu depoda `prefers-reduced-motion` kaçışı
// olmayan animasyonlar tam da bunlardı. `lxs-*` kendi bloğuyla susuyor.
// ---------------------------------------------------------------------------

export default function Loading() {
  return (
    <SkeletonScreen label="Yükleniyor…">
      <SkeletonPageHeader />
      <SkeletonCard>
        <div className="p-5">
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="space-y-3 p-5 pt-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </SkeletonCard>
    </SkeletonScreen>
  );
}
