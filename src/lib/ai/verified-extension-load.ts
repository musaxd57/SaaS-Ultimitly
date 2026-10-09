import "server-only";

import { calendarDateOf, nightsBetween, todayKey } from "@/modules/availability/core";
import { guestChangeRequestPath } from "@/lib/channels/capability";
import { detectAvailabilityRequestKinds } from "@/lib/ai/availability-claims";
import { runAvailabilityTool } from "@/lib/ai/tools/availability-tool-load";
import { extensionQueryOf, verifiedExtensionEnabled } from "@/lib/ai/verified-extension";
import type { VerifiedAvailabilityContext } from "@/lib/ai/verified-availability-load";
import type { DateResolutionContext } from "@/lib/ai/date-resolution";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ UZATMA — çağrı tarafı (kurucu kararı 10-09). Anahtar kapalıyken HİÇ koşmaz (sorgu yok) → istem ve kapı birebir eski.
//
// Yalnız: (1) cevapsız misafir mesajlarının kelime ağı uzatma görüyor ve başka tür (erken giriş / geç çıkış / tarih değişikliği) yok,
// (2) konuşmanın rezervasyonu AIRBNB ve iptal edilmemiş, konaklama bitmemiş (bugün ≤ çıkış günü), (3) SON misafir mesajından uzatma
// aralığı çözülüyor, (4) araç `ok`. Kapı ayrıca bütün katmanların birleşimine bakar — burası yalnız ön elemedir, izin vermez.
// ---------------------------------------------------------------------------

export async function loadVerifiedExtension(input: {
  organizationId: string;
  propertyId: string;
  timeZone: string;
  guestTexts: readonly string[];
  lastGuestText: string;
  reservation: { arrivalDate: Date; departureDate: Date; channel: string | null; status: string | null } | null;
  now?: Date;
  /** Anahtarı çağıran belirler (QR kendi anahtarıyla — `AI_VERIFIED_QR_ENABLED`); verilmezse kanal anahtarı. */
  enabled?: boolean;
}): Promise<VerifiedAvailabilityContext | null> {
  if (!(input.enabled ?? verifiedExtensionEnabled())) return null;
  const r = input.reservation;
  // Metin "Airbnb uygulamasından değişiklik talebi" der → yalnız Airbnb rezervasyonu; doğrudan / diğer kanal ev sahibine.
  // Yalnız ONAYLI konaklama (Haiku 10-09: rezervasyon talebi "pending", erken çıkışla "completed" da geçiyordu).
  if (!r || guestChangeRequestPath(r) !== "airbnb_app" || r.status !== "confirmed") return null;
  const kinds = new Set(input.guestTexts.flatMap((t) => detectAvailabilityRequestKinds(t)));
  if (!kinds.has("extend") || [...kinds].some((k) => k !== "extend" && k !== "availability")) return null;
  const now = input.now ?? new Date();
  const departure = calendarDateOf(r.departureDate, input.timeZone).key;
  // Konaklama bitti → sorgu yok. Motor geçmişte başlayan aralığı zaten `starts_in_past` ile reddeder (mutasyon E2 EŞDEĞER: sonuç aynı,
  // bu satır yalnız gereksiz takvim sorgusunu keser).
  if (nightsBetween(todayKey(now, input.timeZone), departure) < 0) return null;
  const dateCtx: DateResolutionContext = {
    now,
    timeZone: input.timeZone,
    reservation: { arrival: calendarDateOf(r.arrivalDate, input.timeZone).key, departure },
  };
  const query = extensionQueryOf(input.lastGuestText, dateCtx);
  if (!query) return null;
  const result = await runAvailabilityTool(input.organizationId, { propertyId: input.propertyId, ...query }, now);
  if (result.status !== "ok") return null;
  return { va: { query, result }, scope: { organizationId: input.organizationId, propertyId: input.propertyId }, dateCtx };
}
