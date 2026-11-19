import { notFound } from "next/navigation";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { isImpersonating } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import { formatDate, formatDateTime, cn } from "@/lib/utils";
import { RESERVATION_STATUS } from "@/lib/constants";
import { SELLER } from "@/lib/legal-entity";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { BOOKING_SPAN_HEADLINE, bookingSpanPropertiesLine } from "@/components/attention-panel";
import { RemoveManualCopyButton } from "@/components/reservations/remove-manual-copy-button";
import { loadBookingComparison, type ComparedBookingRow } from "@/lib/reservations/compare";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// "KAYITLARI KARŞILAŞTIR" (UA-1, kurucu 11-19; tasarım `docs/TASARIM-2026-11-19-ua1-kayitlari-karsilastir.md` §2). Aynı rezervasyonun
// bu işletmedeki bütün satırları yan yana (telefonda alt alta). Yalnız elle / dosya satırı kaldırılır; takvim / kanal satırında silme
// yok, kaynağın nasıl düzeltileceği yazar. Metinler tasarımdaki cümleler (kurucu onayı bekliyor, UA-a).
// ---------------------------------------------------------------------------

/** Kaynak satırı — tasarım §2'deki etiketler AYNEN. */
function sourceLabel(row: ComparedBookingRow): string {
  switch (row.sourceClass) {
    case "manual":
      return "Elle girildi";
    case "file":
      return "Dosyadan içe aktarıldı";
    case "calendar":
      return row.calendarSourceLabel ? `Takvimden geliyor: ${row.calendarSourceLabel}` : "Takvimden geliyor";
    case "channel":
      return "Kanaldan geliyor";
  }
}

function RecordFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-28">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export default async function CompareBookingRecordsPage({ params }: { params: Promise<{ key: string }> }) {
  const session = await requireManagerSession();
  const { key } = await params;
  const comparison = await loadBookingComparison(prisma, { organizationId: session.organizationId, key, now: new Date() });
  if (!comparison) notFound();
  const org = await prisma.organization.findUnique({ where: { id: session.organizationId }, select: { timezone: true } });
  const tz = orgTimezone(org?.timezone);
  // Destek görünümü (bürünme) salt okunur: kaldırma düğmesi çizilmez (sunucu da reddeder).
  const readOnly = isImpersonating(session);
  const remainingAfter = (id: string) => comparison.rows.find((r) => r.id !== id)?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kayıtları karşılaştır"
        description={
          comparison.resolved ? (
            "Kayıtlar artık tek dairede. Otomatik mesajlar olağan akışa döndü."
          ) : (
            // Dikkat satırıyla aynı iki satır (kurucu 11-19 akşam, madde 3): sabit başlık + daire adları " · " ile (ada ek takılmaz).
            <>
              <span className="block">{BOOKING_SPAN_HEADLINE}</span>
              <span className="block break-words">{bookingSpanPropertiesLine(comparison.activePropertyNames)}</span>
            </>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2" data-testid="compare-rows">
        {comparison.rows.map((row) => (
          <Card
            key={row.id}
            data-testid="compare-row"
            data-active={row.active ? "1" : "0"}
            className={cn(!row.active && "opacity-60")}
          >
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="min-w-0 break-words text-base">{row.propertyName}</CardTitle>
              {row.active ? null : <Badge tone="muted">Etkin değil</Badge>}
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="space-y-1.5">
                <RecordFact label="Daire">{row.propertyName}</RecordFact>
                <RecordFact label="Kaynak">{sourceLabel(row)}</RecordFact>
                <RecordFact label="Giriş → çıkış">
                  {formatDate(row.arrivalDate)} → {formatDate(row.departureDate)}
                </RecordFact>
                <RecordFact label="Misafir">{row.guestName}</RecordFact>
                <RecordFact label="Durum">{RESERVATION_STATUS.label(row.status)}</RecordFact>
                <RecordFact label="Son güncelleme">{formatDateTime(row.updatedAt, tz)}</RecordFact>
              </dl>
              {/* Etkin olmayan satır çakışmayı oluşturmuyor: eylem / açıklama yok. */}
              {!row.active ? null : row.sourceClass === "calendar" ? (
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>
                    {/* Besleme adı yoksa (kaynak başka işletmenin / okunamadı) ad atlanır; cümlenin geri kalanı aynı. */}
                    {`Bu kayıt ${row.calendarSourceLabel ? `${row.calendarSourceLabel} ` : ""}takviminden geliyor. `}
                    Takvim yanlış daireye eklendiyse daire sayfasında kaldırıp doğru daireye ekleyin.
                  </p>
                  <LinkButton href={`/properties/${encodeURIComponent(row.propertyId)}`} size="sm" variant="outline" className="h-8 text-xs">
                    Daire sayfasına git
                  </LinkButton>
                </div>
              ) : row.sourceClass === "channel" ? (
                <p className="text-xs text-muted-foreground">
                  Bu kayıt kanaldan geliyor. İlanın bağlı olduğu daire yanlışsa{" "}
                  <a href={`mailto:${SELLER.eposta}`} className="text-primary underline hover:no-underline">
                    bize yazın
                  </a>
                  , birlikte düzeltelim.
                </p>
              ) : row.removable && !readOnly ? (
                <RemoveManualCopyButton reservationId={row.id} pageKey={key} fallbackKey={remainingAfter(row.id)} />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
