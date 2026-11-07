import { Skeleton, SkeletonCard, SkeletonPageHeader, SkeletonScreen } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// AYARLAR — yükleniyor iskeleti. Şekil kaynağı: `settings-sections.tsx`
// (masaüstünde sol yapışkan nav + içerik kolonu).
// ⚠️ Sol nav `hidden lg:block`: mobilde native `<select>` var, yani küçük
// ekranda o kolona yer AYIRMAK boşluk üretirdi.
// ---------------------------------------------------------------------------

export default function Loading() {
  return (
    <SkeletonScreen label="Ayarlar yükleniyor…">
      <SkeletonPageHeader titleWidth="w-32" descWidth="w-80" />
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <div className="hidden space-y-1 lg:block">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonCard key={i}>
              <div className="p-5">
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="space-y-3 p-5 pt-0">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-10 w-full" />
                ))}
              </div>
            </SkeletonCard>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
