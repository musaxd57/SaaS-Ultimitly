import type { Prisma, Reservation } from "@prisma/client";

// ---------------------------------------------------------------------------
// REZERVASYON SATIRININ KAYNAK SINIFI — TEK KURAL (UA-1, kurucu 11-19; tasarım `docs/TASARIM-2026-11-19-ua1-kayitlari-karsilastir.md` §2).
//
// "Kayıtları karşılaştır" sayfası aynı rezervasyonun iki dairedeki satırlarını yan yana gösterir; ev sahibi YALNIZ bizim içimizde doğan
// (elle ya da dosyayla girilen) kopyayı kaldırabilir. Takvim / kanal satırı silinirse sonraki senkron onu geri getirir → silinmez.
//
// Alanların anlamı yazan kodlardan okundu (tahmin değil):
//   · iCal aboneliği (`import/sync.ts`): `calendarSourceId` = besleme kimliği; kanal `channelFromLabel` → airbnb / booking / direct /
//     other (ASLA "manual" / "ics").
//   · kanal senkronu (`ingest/write-service.ts`): kanal sağlayıcının platform eşlemesi (Hospitable "manual" → "direct"; ASLA "manual" /
//     "ics"); `connectionId` etkin bağlantı varsa dolu — YOKSA NULL (eski ortam belirteci) → NULL bağlantı "elle" demek DEĞİLDİR.
//   · elle tek kayıt (`api/reservations` POST): `sourceReference` verilince kanal "manual" (referanssız satır çakışmaya giremez);
//     `guestNameSource` "host", `ingestedAt` NULL.
//   · dosya (`api/reservations/import`): `.ics` → kanal "ics"; CSV → kanal "manual" + `guestNameSource` "file"; ikisinde de takvim /
//     bağlantı kimliği NULL.
//   · besleme silinince (`calendar-sources/[id]` DELETE) bağı kopan satırlar `calendarSourceId` NULL + kanal "manual" olur ("öksüz" —
//     rozeti zaten "Manuel"; artık hiçbir kaynak onu geri getirmez). Bu sınıfta "elle" sayılır (adı geçen rotanın kendi kararı).
// Dolayısıyla "bizim içimizde doğdu" ⟺ takvim kimliği YOK + bağlantı kimliği YOK + kanal "manual" ya da "ics". Bunun DIŞINDAKİ her şey
// (bilinmeyen kanal etiketi, boş dize, gelecekte eklenecek bir yazıcı) kaynaktan gelmiş sayılır → silinemez (güvenli yön).
// YAPRAK modül: yalnız tip içe aktarır.
// ---------------------------------------------------------------------------

export type BookingRowSourceClass = "manual" | "file" | "calendar" | "channel";

/** Satırın sınıfı belirleyen alanları (şemadan türetilir — yalnız okuma). */
export type BookingRowSourceFacts = Pick<Reservation, "calendarSourceId" | "connectionId" | "channel" | "guestNameSource">;

/** Saf: satırın kaynak sınıfı. Belirsiz / eksik → takvim ya da kanal (silinemez). */
export function bookingRowSourceClass(row: BookingRowSourceFacts): BookingRowSourceClass {
  if (row.calendarSourceId !== null) return "calendar";
  if (row.connectionId !== null) return "channel";
  if (row.channel === "ics") return "file";
  // CSV ile elle tek kaydı yalnız ad kökeni ayırır (ikisi de kanal "manual"); kökeni olmayan eski satır / öksüz besleme satırı "elle".
  if (row.channel === "manual") return row.guestNameSource === "file" ? "file" : "manual";
  return "channel";
}

/** Saf: bu sınıftaki satır karşılaştırma sayfasından kaldırılabilir mi (yalnız elle / dosya). */
export function isRemovableBookingRowClass(cls: BookingRowSourceClass): boolean {
  return cls === "manual" || cls === "file";
}

/**
 * `isRemovableBookingRowClass(bookingRowSourceClass(row))`un SORGU ikizi: silme işleminin İÇİNDE yeniden uygulanır (okuma ile silme
 * arasında bir besleme satırı benimseyip `calendarSourceId` yazarsa silinmez). İkizlik birim testinde iki yönlü pinli. Kanal değerleri
 * SAHİPLİK işaretçisidir (elle / dosya — değişmez 6), yetenek değil; eşitlik biçiminde yazıldı (kanal alanına sabit liste süzgeci yalnız
 * Channel Layer'da — `core-channel-independence` V0.9 pini).
 */
export const REMOVABLE_BOOKING_ROW_WHERE = {
  calendarSourceId: null,
  connectionId: null,
  OR: [{ channel: "manual" }, { channel: "ics" }],
} satisfies Prisma.ReservationWhereInput;
