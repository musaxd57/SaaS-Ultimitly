// ---------------------------------------------------------------------------
// OTOMATİK MESAJ HANGİ REZERVASYON DURUMUNDA GİDER — TEK KAYNAK (Codex 11-17 D1). YAPRAK modül: hiçbir şey import etmez.
//
// Karşılama ve giriş bilgisi yalnız ONAYLI rezervasyona gider; çıkış mesajı çıkış günü durum "tamamlandı"ya dönmüş olsa da gider.
// Kural eskiden her yerde elle yazılıyordu: gönderici sorguları ve doğrudan yolun son talebi "onaylı" istiyor, kalıcı kuyruğun işçisi ise
// yalnız "iptal değil" diyordu → kuyruğa onaylıyken girip gönderilmeden önce "bekliyor"a dönen rezervasyona giriş bilgisi (kapı kodu
// taşıyabilir) gidiyordu. İki yol aynı kümeyi bu dosyadan okur; "bekliyor" gibi ara durumlar hiçbir türde gönderilebilir değildir.
// ---------------------------------------------------------------------------

export type LifecycleMessageKind = "welcome" | "checkin" | "checkout";

/** Tür → o mesajın gönderilebildiği rezervasyon durumları. */
export const LIFECYCLE_SENDABLE_STATUSES: Readonly<Record<LifecycleMessageKind, readonly string[]>> = {
  welcome: ["confirmed"],
  checkin: ["confirmed"],
  checkout: ["confirmed", "completed"],
};

/** Bu durumdaki rezervasyona bu tür otomatik mesaj gönderilebilir mi. */
export function lifecycleStatusAllows(kind: LifecycleMessageKind, status: string): boolean {
  return LIFECYCLE_SENDABLE_STATUSES[kind].includes(status);
}

/** Sorgu süzgeci parçası (`status: lifecycleStatusWhere("checkin")`): tek durumda düz eşitlik, birden çok durumda `in`. */
export function lifecycleStatusWhere(kind: LifecycleMessageKind): string | { in: string[] } {
  const allowed = LIFECYCLE_SENDABLE_STATUSES[kind];
  return allowed.length === 1 ? (allowed[0] as string) : { in: [...allowed] };
}
