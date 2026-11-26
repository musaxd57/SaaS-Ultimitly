// ---------------------------------------------------------------------------
// REZERVASYON API YANITI — QR PIN / CİHAZ BAĞLAMA DURUMU ÇIKARILIR (gece denetimi 09-28, kodda doğrulandı).
//
// `api/reservations` (GET liste, POST oluşturma) ve `api/reservations/[id]` (PATCH) satırı `select`siz döndürüyordu: QR
// sohbetinin PIN özeti (`chatPinHash`, sunucu sırrıyla HMAC), cihaz bağlama özeti (`chatBoundHash`, cihaz sırrının sha256'sı),
// PIN kilit sayacı / süresi ve acil e-posta iç kimliği JSON'a giriyordu. İkisi de tek başına kimlik bilgisi DEĞİL (doğrulama
// çerezdeki düz sırrı özetleyip kıyaslar), ama tarayıcıya hiç inmemesi gereken iç durum; arayüz bu uçları kullanmıyor (kod-
// doğrulandı). Mülk API'sinin `stripPropertySecrets` kuralının ikizi. YAPRAK modül: rota dosyaları yalnız rota alanlarını export
// edebilir.
// ---------------------------------------------------------------------------

/** Yanıttan çıkarılan alanlar — QR PIN / cihaz bağlama iç durumu. */
export const RESERVATION_INTERNAL_FIELDS = [
  "chatPinHash",
  "chatBoundHash",
  "chatPinFailedCount",
  "chatPinLockedUntil",
  "qrEscalationEmailMessageId",
] as const;

export function stripReservationInternals<T extends Record<string, unknown>>(row: T): Omit<T, (typeof RESERVATION_INTERNAL_FIELDS)[number]> {
  const rest: Record<string, unknown> = { ...row };
  for (const f of RESERVATION_INTERNAL_FIELDS) delete rest[f];
  return rest as Omit<T, (typeof RESERVATION_INTERNAL_FIELDS)[number]>;
}
