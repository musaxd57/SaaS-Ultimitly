import { Skeleton, SkeletonCard, SkeletonPageHeader, SkeletonScreen } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// PANEL — yükleniyor iskeleti. Şekil kaynağı: `dashboard/page.tsx`.
// Öncesinde bu rota `(app)/loading.tsx`e düşüyordu: boş bir ekranın ortasında
// tek bir dönen çember.
//
// ⚠️ `OnboardingGuide` İÇİN KUTU YOK ve KOYULMAYACAK: kurulum tamamlanınca o
// bileşen HİÇ çizilmiyor. Koşullu bir bloğa yer ayırmak, içerik geldiğinde
// GARANTİ bir sıçrama demektir — iskeletin tek işi bunu önlemek. Eksik yer
// ayırmak fazla yer ayırmaktan iyidir (eksikte sayfa uzar, fazlada zıplar).
// ---------------------------------------------------------------------------

/** Stat kutucuğu — `stat-card.tsx` ile aynı iskelet. */
function StatTile() {
  return (
    <SkeletonCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Skeleton className="h-5 w-28" />
          {/* değer `text-3xl` → 36 px satır kutusu */}
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="size-10 rounded-lg" />
      </div>
    </SkeletonCard>
  );
}

/** Liste kartı — CardHeader(p-5) + CardContent(p-5 pt-0) + iki satırlı satırlar. */
function ListCard() {
  return (
    <SkeletonCard>
      <div className="flex flex-row items-center justify-between p-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-5 w-8" />
      </div>
      <div className="space-y-2 p-5 pt-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-5 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export default function Loading() {
  return (
    <SkeletonScreen label="Panel yükleniyor…">
      <SkeletonPageHeader titleWidth="w-56" descWidth="w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatTile key={i} />
        ))}
      </div>
      {/* Girişler · Çıkışlar · Bekleyen Mesajlar · Bugünkü Görevler */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <ListCard key={i} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
