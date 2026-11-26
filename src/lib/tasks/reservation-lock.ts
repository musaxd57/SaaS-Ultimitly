import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// REZERVASYON GÖREVLERİ KİLİDİ — tek kaynak (ad alanı 44; diğerleri: 23 takvim beslemesi · 40 silme · 41 QR · 42 e-posta kuyruğu ·
// 43 konuşma kimliği · 45 görev tekrarı · 46 söz · 47 görev kaynak mesajı · 48 bilgi tabanı plan sınırı). Görev üretimi
// (`createReservationTasks`), iptal temizliği ve Codex 11-04 P2 ile TARİH İZLEME (`followReservationDates`) aynı kilidi alır: tarih yazan
// işlem görev üreticisinin commit'ini bekler ve onun eski tarihle yazdığı görevi yeni tarihe taşır (ya da üretici yeni tarihi okur).
// ---------------------------------------------------------------------------

export const RESERVATION_TASKS_LOCK_NS = 44;

/** İşlem içinde (işlem sonuna kadar) rezervasyonun görev kilidini alır. Dış işlem İÇİNDE çağrılmalıdır. */
export async function lockReservationTasks(tx: { $executeRaw: Prisma.TransactionClient["$executeRaw"] }, reservationId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${RESERVATION_TASKS_LOCK_NS}::int4, hashtext(${reservationId}))`);
}
