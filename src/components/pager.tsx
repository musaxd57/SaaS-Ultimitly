import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SAYFALAMA — TEK KAYNAK.
//
// 🚨 DÜĞME UÇLARDA KAYBOLMAZ, DEVRE DIŞI KALIR. Bu kural pazarlık konusu değil:
// `Önceki` ilk sayfada yok olunca `Sonraki` sola ZIPLIYOR ve kullanıcı her
// sayfa geçişinde düğmeyi yeniden arıyor. Üç sayfa (görevler · gönderilenler ·
// misafir sohbetleri) tam da bunu yapıyordu; mesajlar sayfası doğru çözmüştü
// ve o çözüm buraya taşındı.
//
// Devre dışı hâl bir `<span>`dir, `<button disabled>` değil — odaklanılamaz,
// yani klavye kullanıcısı tıklanamayan bir durağa takılmaz.
//
// ⚠️ GÖRÜNÜRLÜK (kullanıcı bildirdi, 08-07 (2)): eskiden aktif düğme yalnız
// ince bir kenarlıktı, devre dışı olan da `text-muted-foreground/40` ile
// neredeyse görünmezdi — ekranda "tıklanabilir bir şey var mı" belli olmuyordu.
// Artık aktif düğme dolu bir yüzey + ok ikonu taşıyor, devre dışı olan ise
// GÖRÜNÜR ama açıkça sönük (yok olmuş değil, "burada bitti" diyor).
// ---------------------------------------------------------------------------

const BASE =
  "inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors";

function PagerLink({
  href,
  label,
  direction,
}: {
  href: string | null;
  label: string;
  direction: "prev" | "next";
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const icon = <Icon className="size-3.5 shrink-0" aria-hidden="true" />;
  if (!href) {
    return (
      <span aria-hidden="true" className={cn(BASE, "border-border/60 bg-muted/40 text-muted-foreground/70")}>
        {direction === "prev" ? icon : null}
        {label}
        {direction === "next" ? icon : null}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        BASE,
        "border-border bg-card text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      )}
    >
      {direction === "prev" ? icon : null}
      {label}
      {direction === "next" ? icon : null}
    </Link>
  );
}

/**
 * Sayfalama çubuğu: solda özet, sağda Önceki/Sonraki.
 *
 * `hrefFor` çağıranın kendi sorgu-parametresi kurgusunu korur (her sayfanın
 * kendi filtreleri var); bileşen yalnız SAYFA numarasını bilir.
 */
export function Pager({
  page,
  totalPages,
  summary,
  hrefFor,
  position = "alt",
  label = "Sayfalama",
  hasNext,
  hasPrev,
}: {
  page: number;
  totalPages: number;
  /** "1328 konuşmadan 1–50 arası · Sayfa 1 / 27" gibi hazır metin. */
  summary: string;
  hrefFor: (page: number) => string;
  position?: "üst" | "alt";
  label?: string;
  /**
   * "Sonraki" var mı? — VARSAYILAN `page < totalPages`.
   *
   * ⚠️ Geçersiz kılma seçeneği ZORUNLUYDU: gönderilenler sayfasında kural
   * farklı (`moreExist && !cappedOut`) — karma listede gezilebilir sayfa
   * sayısının bir TAVANI var ve tavana gelindiğinde daha fazla kayıt OLSA
   * BİLE ileri gidilemiyor. Bileşenin sayfa-türevli kuralını oraya dayatmak,
   * hiçbir yere gitmeyen aktif bir düğme gösterirdi.
   */
  hasNext?: boolean;
  /** "Önceki" var mı? — varsayılan `page > 1`. */
  hasPrev?: boolean;
}) {
  const canPrev = hasPrev ?? page > 1;
  const canNext = hasNext ?? page < totalPages;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-xs text-muted-foreground",
        position === "üst" ? "px-1 pb-1" : "px-4 py-3",
      )}
    >
      <span>{summary}</span>
      {/* Tek sayfa varken sayfalama HİÇ basılmaz — tıklanacak bir şey yokken
          iki sönük düğme göstermek gürültüdür. */}
      {totalPages > 1 ? (
        <nav aria-label={`${label} (${position})`} className="flex shrink-0 gap-1.5">
          <PagerLink
            href={canPrev ? hrefFor(page - 1) : null}
            label="Önceki"
            direction="prev"
          />
          <PagerLink
            href={canNext ? hrefFor(page + 1) : null}
            label="Sonraki"
            direction="next"
          />
        </nav>
      ) : null}
    </div>
  );
}
