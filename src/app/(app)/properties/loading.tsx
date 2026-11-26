import { Skeleton, SkeletonCard, SkeletonPageHeader, SkeletonScreen } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// DAİRELER — yükleniyor iskeleti. Şekil kaynağı: `properties/page.tsx`.
// ⚠️ ALTI kart: `lg:grid-cols-3` düzeninde tam iki sıra. Portföy daha büyükse
// içerik gelince sayfa AŞAĞI doğru uzar (göze batmaz); altıdan az mülkü olanda
// kısalır ve üstteki her şey yerinde kaldığı için yine sıçrama olmaz.
// ---------------------------------------------------------------------------

function PropertyCard() {
  return (
    <SkeletonCard className="h-full p-5">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="mt-3 h-6 w-3/4" />
      <Skeleton className="mt-1 h-5 w-1/2" />
      <Skeleton className="mt-3 h-4 w-40" />
      <div className="mt-3 flex items-center gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto h-5 w-20 rounded-full" />
      </div>
    </SkeletonCard>
  );
}

export default function Loading() {
  return (
    <SkeletonScreen label="Daireler yükleniyor…">
      <SkeletonPageHeader titleWidth="w-28" descWidth="w-72" actions={1} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <PropertyCard key={i} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
