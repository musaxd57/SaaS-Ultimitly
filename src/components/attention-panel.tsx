import Link from "next/link";
import { AlertTriangle, CalendarPlus, CalendarRange, CalendarX2, Clock, Hand, HandHeart, Hourglass, LogOut, Repeat, RotateCcw, ServerCrash, Unplug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signalCategoryLabel } from "@/modules/intelligence/labels";
import type { AttentionItem, AttentionKind } from "@/modules/intelligence/incidents/attention";
import type { MoneyImpact } from "@/modules/intelligence/money/impact";
import { itemKindLabel } from "@/lib/conversation-items/view";
import { commitmentDurationLabel, commitmentLabel } from "@/lib/guest-commitments-core";
import { CONNECTION_ERROR_TEXT, CONNECTION_ERROR_TEXT_VIEWER, agoLabel } from "@/lib/channels/health";
import { ReactivateReservationButton } from "@/components/reactivate-reservation-button";

// ---------------------------------------------------------------------------
// V2.1 — "Dikkat Gerektirenler" kartı.
//
// 🚨 SAKİN GÜNDE HİÇ BASMAZ (`null` döner). Boş durum metni, "şu an sorun yok"
// rozeti, gri bir kutu YOK: her gün orada duran bir uyarı kartı üç günde duvar
// kâğıdına döner ve gerçekten bir şey olduğunda da görülmez. Panelin kendi
// notunun şartı buydu.
//
// 🚨 SÖZ, KESİNLİK DERECESİNE GÖRE KURULUR. `certainty: "inferred"` satırlar
// (tekrar eden arıza) kelime ağıyla sınıflandırılmış sinyallerden türüyor —
// Türkçe olumsuz fiil boşluğu ÖLÇÜLMÜŞ bir açık. O yüzden bu satırlar açıkça
// "otomatik sınıflandırma" diye işaretlenir ve emir kipi kullanılmaz.
// ---------------------------------------------------------------------------

const ICONS: Record<AttentionKind, typeof AlertTriangle> = {
  feed_broken: CalendarX2,
  departing_unanswered: LogOut,
  unanswered_aging: Clock,
  recurring_issue: Repeat,
  calendar_conflict: CalendarRange,
  held_request: Hand,
  decision_pending: Hourglass,
  commitment_due: HandHeart,
  connection_unhealthy: Unplug,
  booking_gap: CalendarPlus,
  channel_reactivation: RotateCcw,
  provider_outage: ServerCrash,
};

/** "5 Eki" — takvim günü; saat dilimi kaydırması olmasın diye UTC okunur (anahtar zaten gün). */
/** Satırın React anahtarı: tür + hedef + an (+ aynı ana düşebilen satırlarda kararlı kimlik — gece-4 S1-15). */
export function attentionRowKey(item: AttentionItem): string {
  return `${item.kind}:${item.href}:${item.occurredAt.getTime()}${item.rowKey ? `:${item.rowKey}` : ""}`;
}

function dayLabel(key: string, offsetDays = 0): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Yarı açık [from, to) GECELER: son gece `to`dan bir önceki gündür ("5 Eki – 7 Eki" çıkış gününü gösterirdi). */
function nightsLabel(from: string, to: string): string {
  const last = dayLabel(to, -1);
  const first = dayLabel(from);
  return first === last ? `${first} gecesi` : `${first} – ${last} geceleri`;
}

/** Yarı açık [from, to) aralığındaki gece sayısı (takvim günü anahtarları). */
function nightCount(from: string, to: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(1, Math.round((ms(to) - ms(from)) / 86_400_000));
}

function headline(item: AttentionItem): string {
  switch (item.kind) {
    case "feed_broken":
      return `${item.sourceLabel ?? "Takvim"} bağlantısı güncellenemiyor`;
    case "departing_unanswered":
      return `Çıkışı yaklaşan misafir ${item.hoursWaiting ?? 0} saattir cevap bekliyor`;
    case "unanswered_aging":
      return `${item.hoursWaiting ?? 0} saattir cevapsız misafir mesajı`;
    case "recurring_issue":
      return `${signalCategoryLabel(item.category ?? "")} tekrar ediyor`;
    case "calendar_conflict":
      if (item.possibleDuplicate) return "Aynı rezervasyon iki kez görünüyor olabilir";
      if (item.heldRequest) return "Onay bekleyen bir talep dolu gecelerle çakışıyor";
      return "Aynı gecelere iki rezervasyon var";
    case "held_request": {
      const first = item.requestKinds?.[0];
      return `Size bırakılan istek: ${first ? itemKindLabel(first) : "misafir isteği"}`;
    }
    case "decision_pending":
      return item.decisionUnverified
        ? `Gönderim doğrulanamadı: ${item.decisionTitle ?? "konaklama isteği"}`
        : `Karar bekliyor: ${item.decisionTitle ?? "konaklama isteği"}`;
    case "commitment_due": {
      const what = item.commitmentKind ? commitmentLabel(item.commitmentKind, item.commitmentTopic) : "misafir isteği";
      const left = item.minutesLeft ?? 0;
      // 1 gün sonra TEK hatırlatma (kurucu 10-17 gece: kendiliğinden kapatma YOK, e-posta YOK — yalnız bu satırın metni; işareti sunucu koyar).
      if (item.commitmentReminder) return `Söz 1 gündür açık: ${what}`;
      return left < 0 ? `Misafire verilen söz gecikti: ${what}` : `Misafire söz verildi: ${what}`;
    }
    case "connection_unhealthy":
      return item.connectionErrorKind ? "Kanal bağlantısı okunamıyor" : "Kanal senkronu gecikiyor";
    case "booking_gap":
      return `İki konaklama arasında ${item.nights ? nightCount(item.nights.from, item.nights.to) : 1} gece boş görünüyor`;
    case "channel_reactivation":
      return "Kanal, iptal edilmiş bir rezervasyonu yeniden etkin gösteriyor";
    case "provider_outage":
      return `Kanal sağlayıcısında arıza — ${item.waitingCount ?? 0} mesaj bekliyor`;
  }
}

function detail(item: AttentionItem, canManageChannel: boolean): string {
  switch (item.kind) {
    case "feed_broken":
      // Ne olduğunu DEĞİL, host için ne anlama geldiğini söyler.
      return `${item.propertyName} · bu kanaldan yeni rezervasyon gelmiyor olabilir`;
    case "departing_unanswered":
    case "unanswered_aging":
      return item.propertyName;
    case "recurring_issue":
      return `${item.propertyName} · ${item.evidenceCount ?? 0} sinyal`;
    case "calendar_conflict": {
      const range = item.nights ? nightsLabel(item.nights.from, item.nights.to) : "";
      const more = (item.conflictCount ?? 1) > 1 ? ` · ${(item.conflictCount ?? 1) - 1} çakışma daha` : "";
      return `${item.propertyName} · ${range}${more} · takvimi kontrol edin`;
    }
    case "held_request": {
      const more = (item.requestCount ?? 1) > 1 ? ` · ${(item.requestCount ?? 1) - 1} istek daha` : "";
      return `${item.propertyName}${more} · misafire yanıt verin`;
    }
    case "decision_pending":
      return item.decisionUnverified
        ? `${item.propertyName} · konuşmayı kanaldan kontrol edin`
        : `${item.propertyName} · onaylayın ya da reddedin`;
    case "commitment_due": {
      const left = item.minutesLeft ?? 0;
      if (item.commitmentReminder) {
        return `${item.propertyName} · ${item.commitmentTime ?? ""} · yapıldıysa görevi tamamlayın, yapılmayacaksa iptal edin`;
      }
      // Dilim / gün sözünde süre YOK (pencere sonu söylenmez — O12): "gecikti" ya da yalnız durum.
      if (item.commitmentPrecise === false) {
        return `${item.propertyName} · ${item.commitmentTime ?? ""} · ilgili görev tamamlanmadı${left < 0 ? " · gecikti" : ""}`;
      }
      // 0 = son an geldi ya da açık saatin 30 dk payı içinde (gecikti denmez).
      const when = left < 0 ? `${commitmentDurationLabel(left)} gecikti` : left === 0 ? "zamanı geldi" : `${commitmentDurationLabel(left)} kaldı`;
      return `${item.propertyName} · ${item.commitmentTime ?? ""} · ilgili görev tamamlanmadı · ${when}`;
    }
    case "connection_unhealthy": {
      const last =
        item.minutesSinceOk !== undefined ? `kanaldan son başarılı okuma ${agoLabel(item.minutesSinceOk)}` : "henüz başarılı okuma yok";
      if (!item.connectionErrorKind) return `Tüm daireler · ${last} · yeni mesajlar gecikebilir`;
      // Bağlantıyı yalnız sahip / operatör onarır; ötekine "yeniden bağlanın" değil nötr çağrı.
      const what = canManageChannel ? CONNECTION_ERROR_TEXT[item.connectionErrorKind] : CONNECTION_ERROR_TEXT_VIEWER;
      return `Tüm daireler · ${what} · ${last}`;
    }
    case "booking_gap": {
      const range = item.nights ? nightsLabel(item.nights.from, item.nights.to) : "";
      const more = (item.gapCount ?? 1) > 1 ? ` · ${(item.gapCount ?? 1) - 1} boşluk daha` : "";
      return `${item.propertyName} · ${range}${more} · kısa konaklamaya açmak isteyebilirsiniz`;
    }
    case "channel_reactivation":
      // G9 (kurucu kararı 10-13): rezervasyon kendiliğinden geri AÇILMADI — ev sahibi kanaldan doğrular.
      return `${item.propertyName} · rezervasyon iptal olarak kaldı · kanaldan kontrol edin`;
    case "provider_outage":
      // G10: mesajlar iletilmiş OLABİLİR (sağlayıcı alıp hata vermiş olabilir) → elle yanıtlamadan önce kontrol (çift mesaj riski).
      return "Tüm daireler · mesajlar iletilmiş olabilir · elle yanıtlamadan önce konuşmaları kanaldan kontrol edin";
  }
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/**
 * Para etkisi satırı (V2): tahmin HER ZAMAN aralık + "tahmini"; nasıl hesaplandığı ipucunda. Tutar
 * bilinmiyorsa yalnız ev sahibinin yapabileceği şey söylenir; kopya/geçersiz durumda hiçbir şey yazılmaz.
 */
export function moneyLine(m: MoneyImpact | undefined): { text: string; hint?: string } | null {
  if (!m) return null;
  if (m.kind === "estimate") {
    return {
      text: `Risk altındaki tutar: ${money(m.low, m.currency)} – ${money(m.high, m.currency)} (tahmini)`,
      hint:
        "Çakışan gece sayısı × gecelik fiyat aralığınız; üst sınır, etkilenen en uzun konaklamanın tamamı. " +
        "Platform cezaları ve misafiri taşıma masrafı dahil değil.",
    };
  }
  if (m.kind === "unknown" && m.reason === "no_rate") return { text: "Tutarı görmek için bu dairenin gecelik fiyat aralığını ekleyin." };
  if (m.kind === "unknown" && m.reason === "rate_stale") return { text: "Gecelik fiyat aralığınız 6 aydan eski; güncelleyin." };
  return null;
}

export function AttentionPanel({
  items,
  canManageChannel = false,
  canManageReservations = false,
}: {
  items: AttentionItem[];
  /** Kanal bağlantısını onarabilir mi (sahip / operatör) — değilse bağlantı satırı nötr çağrı yapar. */
  canManageChannel?: boolean;
  /** Rezervasyonu yeniden açabilir mi (sahip / yönetici; H2 düğmesi) — personel düğmeyi görmez (rota da 403 döner). */
  canManageReservations?: boolean;
}) {
  // 🚨 Sessiz gün = hiç render yok.
  if (items.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-700/60">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" />
          Dikkat Gerektirenler
        </CardTitle>
        <Badge tone="warning">{items.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          const reopen =
            item.kind === "channel_reactivation" && item.reservationId && canManageReservations ? item.reservationId : null;
          const row = (
            <Link
              key={attentionRowKey(item)}
              href={item.href}
              className="flex min-w-0 flex-1 items-start gap-3 rounded-lg border border-border px-3 py-2 hover:bg-accent"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{headline(item)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {detail(item, canManageChannel)}
                  {item.certainty === "inferred" ? (
                    // Kesin tespit DEĞİL — host'un doğrulaması gerekiyor. Çakışmada sebep sınıflandırma
                    // değil, kayıtlardan birinin güncel olduğunun kanıtlanamaması.
                    <span className="ml-1 text-amber-700 dark:text-amber-500">
                      {item.kind === "calendar_conflict" || item.kind === "booking_gap"
                        ? "· kayıtlardan biri güncel olmayabilir, doğrulayın"
                        : "· otomatik sınıflandırma, doğrulayın"}
                    </span>
                  ) : null}
                </p>
                {(() => {
                  const line = item.kind === "calendar_conflict" ? moneyLine(item.money) : null;
                  return line ? (
                    <p className="truncate text-xs text-muted-foreground" title={line.hint}>
                      {line.text}
                    </p>
                  ) : null;
                })()}
              </div>
            </Link>
          );
          // H2: "yeniden aç" düğmesi bağlantının DIŞINDA (bağlantı içinde düğme geçersiz HTML; tık satırı açmamalı).
          return reopen ? (
            <div key={attentionRowKey(item)} className="flex items-center gap-2">
              {row}
              <ReactivateReservationButton reservationId={reopen} />
            </div>
          ) : (
            row
          );
        })}
      </CardContent>
    </Card>
  );
}
