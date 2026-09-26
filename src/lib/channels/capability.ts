import type { Prisma } from "@prisma/client";
import { INTERNAL_THREAD_PREFIX } from "./outbound";

// ---------------------------------------------------------------------------
// MESSAGING CAPABILITY — "bu kayıt sağlayıcı üzerinden mesajlanabilir mi?" (V0.5)
//
// Tek kaynak. Eskiden automation.ts'te 6 kopya `channel notIn ["ics","manual"]` +
// `calendarSourceId: null` + `sourceReference not null`, ve 2 kopya `startsWith
// "qr-chat:"` vardı; her kopya diğerinden sürüklenebiliyordu ve "önizleme == gerçek"
// paritesi yalnız yorumla korunuyordu. Artık gönderici ve önizleme AYNI fragment'i
// spread eder; parite yapısal.
//
// Karar üç bacaklıdır — hiçbiri `channel` string'inden YETENEK ÇIKARMAZ (değişmez #20):
//   · `calendarSourceId: null` — asıl işaretçi: bir takvim kaynağına bağlı satır tanım
//     gereği sağlayıcıda YOK (abonelik yolu kanalı "airbnb" yazar; kanal iCal işaretçisi
//     DEĞİL — denetim 08-08).
//   · `channel notIn [ics, manual]` — bu iki değer OTA adı değil MEKANİZMA işaretçisi
//     (yalnız elle .ics / .csv / UI yolu yazar); sağlayıcı normalizasyonu asla üretmez.
//   · `sourceReference not null` — sağlayıcı kimliği yoksa gönderim hedefi de yok.
// Org düzeyi yetenek (kimlik bilgisi var mı; env fallback dahil) bu dosyada DEĞİL:
// kimlik çözümü V0.3'ün işi (`getOrgHospitableToken` → V0.7'de bağlantıdan), ve
// sağlayıcı yeteneği gönderim anında adaptör kapısında (`dispatchOutbound`, V0.1).
// ---------------------------------------------------------------------------

/** Mekanizma işaretçisi kanallar (elle yükleme/giriş). OTA adı değildir. */
export const NON_MESSAGING_CHANNELS = ["ics", "manual"] as const;

/**
 * Prisma where-fragment: sağlayıcı üzerinden mesajlanabilir rezervasyon. Gönderici ve
 * önizleme sorguları bunu `...` ile yayar — parite yapısal.
 */
export const PROVIDER_MESSAGEABLE_RESERVATION_WHERE = {
  sourceReference: { not: null },
  calendarSourceId: null,
  channel: { notIn: [...NON_MESSAGING_CHANNELS] },
} satisfies Prisma.ReservationWhereInput;

/** Aynı karar, satır üzerinde (bellek içi; SQL fragment'iyle doğruluk tablosu test-pinli). */
export function reservationMessagingCapable(r: {
  sourceReference: string | null;
  calendarSourceId: string | null;
  channel: string;
}): boolean {
  if (r.sourceReference === null) return false;
  if (r.calendarSourceId !== null) return false;
  return !(NON_MESSAGING_CHANNELS as readonly string[]).includes(r.channel);
}

/** İç thread (QR concierge): dönüş kanalı yok, sağlayıcıya çıkmaz. Kural tek yerde: INTERNAL_THREAD_PREFIX. */
export function isInternalThread(externalReservationId: string | null | undefined): boolean {
  return typeof externalReservationId === "string" && externalReservationId.startsWith(INTERNAL_THREAD_PREFIX);
}

/** Prisma where-fragment: sağlayıcı thread'i olan konuşma (iç thread hariç). */
export const PROVIDER_THREAD_CONVERSATION_WHERE = {
  externalReservationId: { not: null },
  NOT: { externalReservationId: { startsWith: INTERNAL_THREAD_PREFIX } },
} satisfies Prisma.ConversationWhereInput;
