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

// ---------------------------------------------------------------------------
// EV SAHİBİNE "BİR KEZ" UYARI (kurucu 11-18 akşam: "hosta bir kez eşleştirme uyarısı çıkmalı") — Panel › Dikkat Gerektirenler satırı.
// Tutma kuralıyla AYNI yüklem: gönderici bir rezervasyonu tutuyorsa (ve yalnız o zaman) burada da görünür.
// ---------------------------------------------------------------------------

/** Saf: rezervasyonun ETKİN satırlarının daireleri (tekil, ilk görülme sırasıyla). `spansMultipleProperties` ≡ uzunluk > 1. */
export function activePropertyIdsOf(rows: readonly BookingRowFacts[], now: Date): string[] {
  const out: string[] = [];
  for (const row of rows) if (isActiveBookingRow(row, now) && !out.includes(row.propertyId)) out.push(row.propertyId);
  return out;
}

/**
 * `isActiveBookingRow`un SORGU ikizi (aday süzgeci): iptal yazımı içermeyen durum + çıkışı pay içinde. Kesin karar yine bellekte saf
 * yüklemle verilir (`activePropertyIdsOf`); süzgeç onunla aynı sınırı çizer (`/cancel/i` ≡ büyük-küçük harf duyarsız "cancel" içerir —
 * "cancel" ASCII, dil kuralı farkı yok · çıkış ≥ şimdi − pay).
 */
function activeBookingRowWhere(now: Date): Prisma.ReservationWhereInput {
  return {
    departureDate: { gte: new Date(now.getTime() - BOOKING_ENDED_SLACK_MS) },
    NOT: { status: { contains: "cancel", mode: "insensitive" } },
  };
}

/** Panel satırı tavanı: en yakın varışlı bu kadar rezervasyon okunur; fazlası varsa çağırana `capped` (sessiz kesme yok). */
export const BOOKING_CONFLICT_ROW_CAP = 20;

export interface ActiveBookingConflict {
  sourceReference: string;
  /** Etkin kaydı olan daireler (en az iki), ada göre sıralı. */
  properties: { id: string; name: string }[];
  /** Etkin satırların en erken varışı (misafirin varış günü — satırlar farklı tarih taşıyabilir). */
  arrivalDate: Date;
  /** Kararlı satır anahtarı: etkin satırların en küçük kimliği (ekranda gösterilmez; kaynak kimliği taşınmaz). */
  rowKey: string;
}

/**
 * Bu işletmede iki (ya da daha çok) FARKLI dairede ETKİN kaydı olan rezervasyonlar, en yakın varış önce, en çok `cap` tane.
 *
 * İki sorgu: (1) kaynak kimliği başına ETKİN satır sayısı > 1 olanlar (kayıt (daire, kaynak kimliği) çiftinde tekil → satır sayısı = daire
 * sayısı), tavanın bir fazlası okunur ki aşım görülsün; (2) yalnız o kimliklerin satırları + daire adları. Kesin karar saf yüklemle.
 * Daire kapsamı İŞLETMEDİR (tek daireye daraltma çağıranın işi): öteki daire başka bir sayfanın kapsamındaysa çakışma yine çakışmadır.
 */
export async function activeBookingConflicts(
  db: Db,
  input: { organizationId: string; now: Date; cap?: number },
): Promise<{ conflicts: ActiveBookingConflict[]; capped: boolean }> {
  const cap = input.cap ?? BOOKING_CONFLICT_ROW_CAP;
  const where: Prisma.ReservationWhereInput = {
    sourceReference: { not: null },
    property: { organizationId: input.organizationId },
    ...activeBookingRowWhere(input.now),
  };
  const groups = await db.reservation.groupBy({
    by: ["sourceReference"],
    where,
    having: { sourceReference: { _count: { gt: 1 } } },
    orderBy: [{ _min: { arrivalDate: "asc" } }, { sourceReference: "asc" }],
    take: cap + 1,
  });
  const capped = groups.length > cap;
  const refs = groups
    .slice(0, cap)
    .map((g) => g.sourceReference)
    .filter((r): r is string => r !== null);
  if (refs.length === 0) return { conflicts: [], capped };
  const rows = await db.reservation.findMany({
    where: { sourceReference: { in: refs }, property: { organizationId: input.organizationId } },
    select: { id: true, sourceReference: true, propertyId: true, status: true, arrivalDate: true, departureDate: true, property: { select: { name: true } } },
  });
  const conflicts: ActiveBookingConflict[] = [];
  for (const ref of refs) {
    const list = rows.filter((r) => r.sourceReference === ref);
    const propertyIds = activePropertyIdsOf(list, input.now);
    // Sorgular arasında satır iptal / silinmiş olabilir: kesin karar bellekte.
    if (propertyIds.length < 2) continue;
    const active = list.filter((r) => isActiveBookingRow(r, input.now));
    const nameOf = new Map(active.map((r) => [r.propertyId, r.property.name]));
    conflicts.push({
      sourceReference: ref,
      properties: propertyIds
        .map((id) => ({ id, name: nameOf.get(id) ?? "" }))
        .sort((a, b) => a.name.localeCompare(b.name, "tr") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      arrivalDate: new Date(Math.min(...active.map((r) => r.arrivalDate.getTime()))),
      rowKey: active.map((r) => r.id).sort()[0],
    });
  }
  conflicts.sort((a, b) => a.arrivalDate.getTime() - b.arrivalDate.getTime() || (a.rowKey < b.rowKey ? -1 : 1));
  return { conflicts, capped };
}
