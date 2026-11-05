import "server-only";

import { prisma } from "@/lib/db";
import { approvedLateCheckouts } from "@/lib/early-checkin/load";
import { laterTime } from "@/lib/early-checkin/readiness";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";

// ---------------------------------------------------------------------------
// TEMİZLİK GÖREVİNİN "MİSAFİR ÇIKIŞI" SAATİ (kurucu 11-05 gece: "geç çıkış isteği onay aldı (12 → 14), orada hemen buna bağlanabilir
// temizlik saati"). Hazırlık hükmüyle (`early-checkin/load.ts`) AYNI kural: mülk saati · misafir beyanı · onaylı geç çıkış'tan EN GEÇİ.
// Saat göreve KOPYALANMAZ (ikinci kaynak olmasın): rezervasyon / onay değişince kart kendiliğinden güncel; görev vadesi tarihi izlemeye devam
// eder (`follow-reservation.ts`).
// ---------------------------------------------------------------------------

export interface CheckoutTime {
  time: string;
  /** Etkin saat ONAYLI GEÇ ÇIKIŞTAN geliyor (mülk saati / misafir beyanından geç). */
  lateApproved: boolean;
}

/** Rezervasyon → misafirin çıkış saati (org kapsamlı; saat bilinmiyorsa satır yok). */
export async function checkoutTimesFor(organizationId: string, reservationIds: readonly string[]): Promise<Map<string, CheckoutTime>> {
  const out = new Map<string, CheckoutTime>();
  if (reservationIds.length === 0) return out;
  const rows = await prisma.reservation.findMany({
    where: { id: { in: [...reservationIds] }, property: { organizationId } },
    select: { id: true, guestCheckoutTime: true, property: { select: { checkOutTime: true } } },
  });
  const approvedLate = await approvedLateCheckouts(organizationId, rows.map((r) => r.id));
  for (const r of rows) {
    const base = laterTime(r.guestCheckoutTime, r.property.checkOutTime);
    const late = approvedLate.get(r.id) ?? null;
    const time = laterTime(base, late);
    if (!time) continue;
    out.set(r.id, { time, lateApproved: late !== null && time === normalizeHhmm(late) && time !== base });
  }
  return out;
}
