import type { Prisma, PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// AYNI REZERVASYON İKİ FARKLI DAİREDE KAYITLIYSA SİSTEM DAİRE TAHMİN ETMEZ (kurucu 11-18 akşam).
//
// Rezervasyon kaydı (daire, kaynak kimliği) çiftinde tekildir → aynı kaynak kimliği iki AYRI dairede bulunabilir (eşleştirme hatası, taşınan
// ilan, yarım kalan içe aktarım). Böyle bir rezervasyonun misafiri hangi dairede kalacak — kayıtlardan bilinemez. "İlk kayıt kazanır" ya da
// "metni olan daire kazanır" doğru daireyi KANITLAMAZ; yanlış dairenin giriş bilgisi (kapı kodu) gidebilir. Bu yüzden iki farklı dairede
// ETKİN kaydı olan rezervasyona otomatik karşılama / giriş bilgisi / çıkış mesajı gönderilmez (tutulur); ev sahibi yanlış kaydı kaldırınca
// (ya da kayıt iptal olunca) olağan akış sürer. ETKİN kayıt = iptal edilmemiş VE konaklaması bitmemiş: aynı kaynak kimliğini taşıyan, haftalar
// önce bitmiş bayat bir kopya (yeniden bağlama artığı) canlı rezervasyonu tutmaz.
//
// Tek kural burada: göndericiler (`automation.ts`), kuyruk işçisinin gönderim anı kontrolü (`outbox/worker.ts`) ve Girişler ekranının
// "gönderilecek mi" satırı (`readiness-list/load.ts`) aynı yüklemi kullanır.
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

/** İptal edilmiş kayıt etkin değildir (yazım farkları dahil: cancelled / canceled). Karar kartındaki iptal yüklemiyle aynı okuma. */
export function isActiveBookingStatus(status: string): boolean {
  return !/cancel/i.test(status);
}

/**
 * Konaklaması bitmiş kayıt etkin değildir. Pay bilinçli geniş (iki gün): çıkış tarihi "yalnız gün" de saklanabilir (gün başı / öğlen çapası)
 * ve işletmenin saat dilimi burada okunmaz — çıkış günü içindeki kayıt her dilimde "bitmemiş" sayılır.
 */
export const BOOKING_ENDED_SLACK_MS = 48 * 3_600_000;

export interface BookingRowFacts {
  propertyId: string;
  status: string;
  departureDate: Date;
}

/** Saf: kayıt etkin mi (iptal değil + konaklaması bitmemiş). */
export function isActiveBookingRow(row: Pick<BookingRowFacts, "status" | "departureDate">, now: Date): boolean {
  return isActiveBookingStatus(row.status) && row.departureDate.getTime() >= now.getTime() - BOOKING_ENDED_SLACK_MS;
}

/** Saf: bir rezervasyonun satırları ETKİN olarak birden çok daireye yayılıyor mu. */
export function spansMultipleProperties(rows: readonly BookingRowFacts[], now: Date): boolean {
  const properties = new Set<string>();
  for (const row of rows) if (isActiveBookingRow(row, now)) properties.add(row.propertyId);
  return properties.size > 1;
}

/**
 * Verilen kaynak kimliklerinden, bu işletmede birden çok dairede ETKİN kaydı olanlar. Tek sorgu (çağıran sayfa başına ≤ 25 kimlik verir;
 * kimlik başına en çok daire sayısı kadar satır). Boş girdide sorgu yok.
 */
export async function bookingRefsInMultipleProperties(
  db: Db,
  input: { organizationId: string; refs: readonly string[]; now: Date },
): Promise<Set<string>> {
  const refs = [...new Set(input.refs)];
  if (refs.length === 0) return new Set();
  const rows = await db.reservation.findMany({
    where: { sourceReference: { in: refs }, property: { organizationId: input.organizationId } },
    select: { sourceReference: true, propertyId: true, status: true, departureDate: true },
  });
  const byRef = new Map<string, BookingRowFacts[]>();
  for (const row of rows) {
    if (!row.sourceReference) continue;
    const list = byRef.get(row.sourceReference);
    if (list) list.push(row);
    else byRef.set(row.sourceReference, [row]);
  }
  const conflicted = new Set<string>();
  for (const [ref, list] of byRef) if (spansMultipleProperties(list, input.now)) conflicted.add(ref);
  return conflicted;
}
