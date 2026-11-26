import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import { cn, formatDateTime } from "@/lib/utils";
import { RESERVATION_STATUS } from "@/lib/constants";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, INACTIVE_CARD_CLASS } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AUTO_SEND_STOPPED_TEXT, BOOKING_SPAN_HEADLINE, bookingSpanDetailLine } from "@/components/attention-panel";
import { loadReservationDetail } from "@/lib/reservations/detail";
import { bookingSourceLabelWithChannel, dayKeyLabel, nightsBetweenKeys, partyParts } from "@/lib/reservations/detail-format";
import { autoSendStoppedByConflict } from "@/lib/booking-conflict-auto-send";
import { calendarDateOf } from "@/modules/availability/core";
import { reportError } from "@/lib/report-error";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// REZERVASYON (kurucu 11-20 öğlen B-2: "Rezervasyonu aç takvime değil, bu ekranda doğrudan kalan kayda götürsün. Kayıt Beklemede veya İptal
// olsa da açılabilsin. İlk sürümde salt okunur kalması da doğru. … daire yerinde Lale 3 birdaha yazılmasın"; "kişi sayısını görmek isterim
// kalabalık olmasın"). Tasarım `docs/TASARIM-2026-11-20-rezervasyon-detay-ekrani.md` (B taslağı): kart başlığı daire (bağlantı) + durum
// rozeti; satırlar giriş → çıkış (gece) · misafir (· kişi) · kaynak · son güncelleme. Mesaj, görev, not, tutar ve HİÇBİR düzenleme / iptal
// eylemi yok. Personel görmez (yönetici sayfa kapısı). Kayıt iki dairede etkinse üstte Dikkat satırının aynı üç satırı.
// ---------------------------------------------------------------------------

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-28">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerSession();
  const { id } = await params;
  const now = new Date();
  const detail = await loadReservationDetail(prisma, { organizationId: session.organizationId, id, now });
  if (!detail) notFound();
  const org = await prisma.organization.findUnique({ where: { id: session.organizationId }, select: { timezone: true } });
  const tz = orgTimezone(org?.timezone);
  // Günler TEK TARİH KURALIYLA (işletmenin takvim günü) — takvimle aynı gün; `formatDate` UTC okur, an olarak saklı takvim kaydında kayardı.
  const arrivalKey = calendarDateOf(detail.arrivalDate, tz).key;
  const departureKey = calendarDateOf(detail.departureDate, tz).key;
  const nights = nightsBetweenKeys(arrivalKey, departureKey);
  const cancelled = detail.status === "cancelled";
  // "Otomatik gönderim durduruldu" Dikkat satırıyla AYNI yüklemden; okunamazsa yazılmaz (söz verilmez), sayfa düşmez.
  const autoSendStopped = detail.conflict
    ? (
        await autoSendStoppedByConflict({ organizationId: session.organizationId, refs: [detail.conflict.sourceReference], now }).catch((err) => {
          void reportError("reservations.detail.auto-send-stopped", err);
          return new Set<string>();
        })
      ).has(detail.conflict.sourceReference)
    : false;
  const conflictArrivalDay = detail.conflict?.earliestActiveArrival ? calendarDateOf(detail.conflict.earliestActiveArrival, tz).key : undefined;
  const guestLine = [detail.guestName, ...partyParts(detail.party)].join(" · ");

  return (
    <div className="space-y-6">
      {/* Açıklama satırı YOK: daire kartın başlığında, misafir kartın satırında — hiçbiri iki kez yazılmaz (kurucu: "birdaha yazılmasın"). */}
      <PageHeader title="Rezervasyon" />
      {detail.conflict ? (
        <div
          data-testid="reservation-conflict"
          className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="break-words">{BOOKING_SPAN_HEADLINE}</p>
            <p className="break-words text-xs text-muted-foreground">{bookingSpanDetailLine(detail.conflict.activePropertyNames, conflictArrivalDay)}</p>
            <p className="text-xs">
              {autoSendStopped ? <span className="text-muted-foreground">{`${AUTO_SEND_STOPPED_TEXT} · `}</span> : null}
              <Link href={`/reservations/compare/${encodeURIComponent(detail.id)}`} className="font-medium text-primary hover:underline">
                Kayıtları karşılaştır
              </Link>
            </p>
          </div>
        </div>
      ) : null}
      {/* İptal kartı SOLUK YAZIYLA değil zeminle ayrılır: yüzde 60 saydamlık bütün metni soldurup karşıtlığı 2,5–4,1:1'e düşürüyordu (etiketler,
          daire bağlantısı, "İptal" rozeti — WCAG AA 4,5 ister; FB gezisi 11-20, axe, açık + koyu tema). Kesik çerçeve + gri zemin aynı
          "etkin değil" işaretini verir, yazı tam karşıtlıkta kalır. */}
      <Card data-testid="reservation-card" data-status={detail.status} className={cn(cancelled && INACTIVE_CARD_CLASS)}>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="min-w-0 break-words text-base">
            <Link href={`/properties/${encodeURIComponent(detail.propertyId)}`} className="text-primary underline hover:no-underline">
              {detail.propertyName}
            </Link>
          </CardTitle>
          <Badge tone={RESERVATION_STATUS.tone(detail.status)}>{RESERVATION_STATUS.label(detail.status)}</Badge>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1.5">
            <Fact label="Giriş → çıkış">
              {`${dayKeyLabel(arrivalKey)} → ${dayKeyLabel(departureKey)} · ${nights} gece`}
            </Fact>
            <Fact label="Misafir">{guestLine}</Fact>
            <Fact label="Kaynak">{bookingSourceLabelWithChannel(detail)}</Fact>
            <Fact label="Son güncelleme">{formatDateTime(detail.updatedAt, tz)}</Fact>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
