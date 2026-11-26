import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentHourInTimeZone, orgTimezone } from "@/lib/timezone";
import { calendarDateOf, todayKey } from "@/modules/availability/core";
import { hasMessagingConnection } from "@/lib/channels";
import { PROVIDER_MESSAGEABLE_RESERVATION_WHERE } from "@/lib/channels/capability";
import { lifecycleStatusWhere, type LifecycleMessageKind } from "@/lib/lifecycle-status";
import { CHECKOUT_SEND_END_HOUR } from "@/lib/lifecycle-window";
import { bookingRefsInMultipleProperties } from "@/lib/booking-property-conflict";
import { lifecycleBaselineWhere, lifecycleTemplatedPropertyWhere, lifecycleUnusableIds } from "@/lib/automation";
import { loadErasureGuard } from "@/lib/erasure";

// ---------------------------------------------------------------------------
// "OTOMATİK GÖNDERİM DURDURULDU" YALNIZ GERÇEKTEN DURDURULUYORSA (kurucu 11-20 sabah B-1: "yalnız bu rezervasyon için gönderim gerçekten
// engelleniyorsa gösterilsin. Eski mesajları sonradan gönderme sözü vermesin.").
//
// Yüklem = TUTMA KURALI × GÖNDERİCİNİN KENDİ KOŞULLARI. Rezervasyon iki farklı dairede etkin kayıtlıysa (`booking-property-conflict.ts`,
// göndericiler + kuyruk işçisi + Girişler aynı yüklem) VE tutma kalksa karşılama / giriş / çıkış göndericilerinden biri bu rezervasyona —
// şimdi ya da penceresi gelince — mesaj gönderecekse "durduruldu" doğrudur. Göndericinin koşulları göndericinin YAPI TAŞLARIYLA okunur
// (ikinci kural yok; Girişler'in "gönderici gerçekten gönderecek mi" okumasıyla aynı yöntem, `readiness-list/load.ts`):
//   · genel anahtar `AUTO_REPLY_ENABLED` · türün işletme anahtarı + açılış tabanı · kanal bağlantısı (`hasMessagingConnection` — belirteç
//     çekmez, yenilemez);
//   · satır: işletme · gönderilebilir durum (`lifecycle-status.ts`) · bu türde damgasız · kanaldan mesajlaşabilir (V0.5) · daire başına açılış
//     tabanı (`lifecycleBaselineWhere`) · bu türde metni olan daire (`lifecycleTemplatedPropertyWhere`);
//   · açıkça silinmiş (KVKK) misafir değil ve satır kuyruğun / eski kuyruk denemesinin SAHİPLİĞİNDE değil — göndericinin kendi ön elemesi
//     (`lifecycleUnusableIds`, sert kontrol 11-20 A1): kuyrukta gönderimi belirsiz (`ambiguous` / `review`, misafire gitmiş OLABİLİR) ya da
//     kesin başarısız satır varsa gönderici bu rezervasyonu bir daha kuyruğa vermez → "durduruldu" yanlış bilgi olurdu;
//   · pencere HENÜZ geçmemiş: karşılama ve giriş varış gününe kadar (giriş mesajının "varıştan en çok 4 gün önce" alt sınırı yalnız ZAMANI
//     erteler, engeli değil), çıkış çıkış günü işletme saatiyle 12:00'ye kadar (`lifecycle-window.ts`).
// Geçici engeller sayılmaz (sağlayıcının 429 beklemesi, reddedilen gönderimin yeniden deneme aralığı): onlar mesajı durdurmaz, erteler.
// Göndericiyle eşitlik davranışsal pinli: yanlış kopya kaldırılınca gerçek gönderici gönderiyor ⇔ yüklem "durduruldu" demişti
// (`tests/integration/booking-conflict-auto-send.test.ts` PARİTE).
// ---------------------------------------------------------------------------

const KINDS: readonly LifecycleMessageKind[] = ["welcome", "checkin", "checkout"];

type OrgSwitches = {
  timezone: string | null;
  autoWelcome: boolean;
  autoWelcomeEnabledAt: Date | null;
  autoCheckin: boolean;
  autoCheckinEnabledAt: Date | null;
  autoCheckout: boolean;
  autoCheckoutEnabledAt: Date | null;
};

/** Türün işletme anahtarı açıksa açılış tabanı (taban yoksa gönderici hiç göndermez → `null`). */
function baselineOf(org: OrgSwitches, kind: LifecycleMessageKind): Date | null {
  if (kind === "welcome") return org.autoWelcome ? org.autoWelcomeEnabledAt : null;
  if (kind === "checkin") return org.autoCheckin ? org.autoCheckinEnabledAt : null;
  return org.autoCheckout ? org.autoCheckoutEnabledAt : null;
}

/** Bu türde henüz gönderilmemiş satır (göndericinin damgası; kuyrukta bekleyen satır teslimde damgalanır → bekleyen = gönderilmemiş). */
function notSentWhere(kind: LifecycleMessageKind): Prisma.ReservationWhereInput {
  if (kind === "welcome") return { welcomeSentAt: null };
  if (kind === "checkin") return { checkinSentAt: null };
  return { checkoutSentAt: null };
}

/** Bu türün penceresi henüz geçmedi mi (şimdi ya da ileride gönderilebilir). Gün tek tarih kuralıyla, işletmenin saat diliminde. */
function windowStillOpen(kind: LifecycleMessageKind, row: { arrivalDate: Date; departureDate: Date }, now: Date, tz: string): boolean {
  const today = todayKey(now, tz);
  if (kind === "checkout") {
    const day = calendarDateOf(row.departureDate, tz).key;
    return day > today || (day === today && currentHourInTimeZone(tz, now) < CHECKOUT_SEND_END_HOUR);
  }
  return calendarDateOf(row.arrivalDate, tz).key >= today;
}

/**
 * Verilen kaynak kimliklerinden, iki dairede kayıt tutması bir otomatik mesajı GERÇEKTEN durduranlar. Başka işletmenin satırı hiç okunmaz.
 * Ucuz koşullar önce: boş girdi / genel anahtar / işletme anahtarları kapalıysa sorgu yok; çakışma yoksa bağlantı ve satırlar okunmaz.
 */
export async function autoSendStoppedByConflict(input: { organizationId: string; refs: readonly string[]; now: Date }): Promise<Set<string>> {
  const out = new Set<string>();
  const refs = [...new Set(input.refs)];
  if (refs.length === 0) return out;
  if (process.env.AUTO_REPLY_ENABLED !== "1") return out;
  const { organizationId, now } = input;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      timezone: true,
      autoWelcome: true,
      autoWelcomeEnabledAt: true,
      autoCheckin: true,
      autoCheckinEnabledAt: true,
      autoCheckout: true,
      autoCheckoutEnabledAt: true,
    },
  });
  if (!org) return out;
  const switched = KINDS.flatMap((kind) => {
    const baseline = baselineOf(org, kind);
    return baseline ? [{ kind, baseline }] : [];
  });
  if (switched.length === 0) return out;
  // Tutma kuralı — göndericilerle AYNI yüklem ve sorgu.
  const conflicted = [...(await bookingRefsInMultipleProperties(prisma, { organizationId, refs, now }))];
  if (conflicted.length === 0) return out;
  if (!(await hasMessagingConnection(organizationId))) return out;

  const tz = orgTimezone(org.timezone);
  const erasureRead = loadErasureGuard(organizationId);
  void erasureRead.catch(() => undefined);
  const erasureGuard = () => erasureRead;
  const perKind = await Promise.all(
    switched.map(async ({ kind, baseline }) => ({
      kind,
      rows: await prisma.reservation.findMany({
        where: {
          AND: [
            // Kimlik süzgeci AYRI öğede: mesajlaşabilirlik parçası da `sourceReference` taşır (`{ not: null }`), aynı nesnede onu ezerdi.
            { sourceReference: { in: conflicted } },
            {
              property: { organizationId },
              status: lifecycleStatusWhere(kind),
              ...notSentWhere(kind),
              ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE,
            },
            await lifecycleBaselineWhere(organizationId, baseline),
            await lifecycleTemplatedPropertyWhere(organizationId, kind),
          ],
        },
        select: { id: true, sourceReference: true, arrivalDate: true, departureDate: true },
      }),
    })),
  );
  for (const { kind, rows } of perKind) {
    const unusable = await lifecycleUnusableIds(organizationId, kind, rows, erasureGuard);
    for (const row of rows) {
      const ref = row.sourceReference;
      if (ref && !out.has(ref) && windowStillOpen(kind, row, now, tz) && !unusable.has(row.id)) out.add(ref);
    }
  }
  return out;
}
