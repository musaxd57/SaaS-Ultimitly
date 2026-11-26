// ---------------------------------------------------------------------------
// "Yenileme iptal edildi" bildirimi (kurucu 10-17): ödenmiş dönem sürerken kullanıcı paketini o tarihe kadar kullanır. Tarih işletmenin
// saat diliminde, uzun biçimde ("17 Kasım 2026"). Ayarlar sayfasından saf fonksiyona çıkarıldı (gece-4 S2-10: kenar durumları sınanmıyordu).
// Bildirim yalnız: iptal dönem sonuna planlı + erişim açık + dönem sonu biliniyor ve henüz gelmedi.
// ---------------------------------------------------------------------------

export function cancelNoticeDate(
  ent: { cancelAtPeriodEnd: boolean; active: boolean; periodEnd: Date | null },
  timeZone: string,
  locale: string,
  now: Date = new Date(),
): string | null {
  if (!ent.cancelAtPeriodEnd || !ent.active || !ent.periodEnd || ent.periodEnd.getTime() <= now.getTime()) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone }).format(ent.periodEnd);
}
