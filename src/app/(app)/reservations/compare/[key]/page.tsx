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
import { AUTO_SEND_STOPPED_TEXT, BOOKING_SPAN_HEADLINE, bookingSpanDetailLine } from "@/components/attention-panel";
import { RemoveManualCopyButton } from "@/components/reservations/remove-manual-copy-button";
import { loadBookingComparison } from "@/lib/reservations/compare";
import { bookingSourceLabel } from "@/lib/reservations/detail-format";
import { autoSendStoppedByConflict } from "@/lib/booking-conflict-auto-send";
import { calendarDateOf } from "@/modules/availability/core";
import { reportError } from "@/lib/report-error";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// "KAYITLARI KARŞILAŞTIR" (UA-1, kurucu 11-19; tasarım `docs/TASARIM-2026-11-19-ua1-kayitlari-karsilastir.md` §2). Aynı rezervasyonun
// bu işletmedeki bütün satırları yan yana (telefonda alt alta). Yalnız elle / dosya satırı kaldırılır; takvim / kanal satırında silme
// yok, kaynağın nasıl düzeltileceği yazar. Metinler tasarımdaki cümleler (kurucu onayı bekliyor, UA-a).
// ---------------------------------------------------------------------------

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
  // Çakışma çözüldüyse (etkin kayıt tek dairede) kalan rezervasyon açılabilir (kurucu 11-19 akşam, madde 4: son kopya yanıtından sonra
  // liste yenilenince "Rezervasyonu aç"). Çakışma sürerken yok — hangisinin açılacağı sorunun kendisi; etkin kayıt kalmadıysa da yok.
  // Kurucu 11-20 öğlen B-2: takvime değil DOĞRUDAN kalan kaydın detay sayfasına (`/reservations/<kimlik>`) gider; "Kayıt Beklemede veya İptal
  // olsa da açılabilsin" → etkin kayıt kalmadıysa sayfanın kendi kaydı açılır (detay sayfası her durumu gösterir).
  const openRow = comparison.resolved ? (comparison.rows.find((r) => r.active) ?? comparison.rows.find((r) => r.id === key)) : undefined;
  // Çakışma sürerken açıklama Dikkat satırının satırları (kurucu 11-20 sabah B-1): varış günü aynı kuralla (en erken etkin varış, işletmenin
  // takvim günü); "Otomatik gönderim durduruldu" AYNI yüklemden — okunamazsa yazılmaz (söz verilmez), sayfa düşmez.
  const arrivalDay = comparison.earliestActiveArrival ? calendarDateOf(comparison.earliestActiveArrival, tz).key : undefined;
  const autoSendStopped = comparison.resolved
    ? false
    : (
        await autoSendStoppedByConflict({ organizationId: session.organizationId, refs: [comparison.sourceReference], now: new Date() }).catch(
          (err) => {
            void reportError("reservations.compare.auto-send-stopped", err);
            return new Set<string>();
          },
        )
      ).has(comparison.sourceReference);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kayıtları karşılaştır"
        description={
          comparison.resolved ? (
            "Kayıtlar artık tek dairede. Otomatik mesajlar olağan akışa döndü."
          ) : (
            // Dikkat satırıyla aynı satırlar (kurucu 11-20 sabah B-1); bu sayfada eylem adı yok (sayfanın kendisi "Kayıtları karşılaştır").
            <>
              <span className="block">{BOOKING_SPAN_HEADLINE}</span>
              <span className="block break-words">{bookingSpanDetailLine(comparison.activePropertyNames, arrivalDay)}</span>
              {autoSendStopped ? <span className="block">{AUTO_SEND_STOPPED_TEXT}</span> : null}
            </>
          )
        }
      >
        {openRow ? (
          <LinkButton href={`/reservations/${encodeURIComponent(openRow.id)}`} size="sm" data-testid="compare-open-reservation">
            Rezervasyonu aç
          </LinkButton>
        ) : null}
      </PageHeader>
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
                <RecordFact label="Kaynak">{bookingSourceLabel(row)}</RecordFact>
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
