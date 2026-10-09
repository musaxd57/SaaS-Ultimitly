import "server-only";

import { calendarDateOf } from "@/modules/availability/core";
import { detectAvailabilityRequestKinds } from "@/lib/ai/availability-claims";
import { runAvailabilityTool } from "@/lib/ai/tools/availability-tool-load";
import { availabilityQueryOf, verifiedAvailabilityEnabled, type VerifiedAvailability } from "@/lib/ai/verified-availability";
import type { DateResolutionContext } from "@/lib/ai/date-resolution";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ MÜSAİTLİK — çağrı tarafı (kurucu onayı 10-09). Anahtar kapalıyken HİÇ koşmaz (sorgu yok) → istem ve kapı birebir eski.
//
// Yalnız: (1) cevapsız misafir mesajlarının kelime ağı TEK tür "availability" görüyorsa (uzatma / erken giriş / geç çıkış / tarih
// değişikliği varsa koşmaz — ev sahibinin kararı), (2) SON misafir mesajından tek bir aralık çözülüyorsa, (3) araç `ok` dönerse.
// Kapı ayrıca bütün katmanların birleşimine bakar (anlama / beyan / bekçi) — burası yalnız ön elemedir, izin vermez.
// ---------------------------------------------------------------------------

export interface VerifiedAvailabilityContext {
  va: VerifiedAvailability;
  scope: { organizationId: string; propertyId: string };
  dateCtx: DateResolutionContext;
}

export async function loadVerifiedAvailability(input: {
  organizationId: string;
  propertyId: string;
  timeZone: string;
  guestTexts: readonly string[];
  lastGuestText: string;
  reservation: { arrivalDate: Date; departureDate: Date } | null;
  now?: Date;
  /**
   * Son misafir mesajının YAZILDIĞI an (10-10): göreli günler ("yarın") ona göre çözülür — 23:59'da yazılıp 00:01'de işlenen "yarın
   * boş mu?" bir gün kaymasın (F14 sınıfı). Takvim sorgusunun tazeliği yine `now`dır. Verilmezse `now` (QR anında cevaplanır).
   */
  writtenAt?: Date;
  /** Anahtarı çağıran belirler (QR kendi anahtarıyla — `AI_VERIFIED_QR_ENABLED`); verilmezse kanal anahtarı. */
  enabled?: boolean;
}): Promise<VerifiedAvailabilityContext | null> {
  if (!(input.enabled ?? verifiedAvailabilityEnabled())) return null;
  const kinds = new Set(input.guestTexts.flatMap((t) => detectAvailabilityRequestKinds(t)));
  if (kinds.size !== 1 || !kinds.has("availability")) return null;
  const now = input.now ?? new Date();
  const dateCtx: DateResolutionContext = {
    now: input.writtenAt ?? now,
    timeZone: input.timeZone,
    reservation: input.reservation
      ? {
          arrival: calendarDateOf(input.reservation.arrivalDate, input.timeZone).key,
          departure: calendarDateOf(input.reservation.departureDate, input.timeZone).key,
        }
      : null,
  };
  const query = availabilityQueryOf(input.lastGuestText, dateCtx);
  if (!query) return null;
  const result = await runAvailabilityTool(input.organizationId, { propertyId: input.propertyId, ...query }, now);
  if (result.status !== "ok") return null;
  return { va: { query, result }, scope: { organizationId: input.organizationId, propertyId: input.propertyId }, dateCtx };
}
