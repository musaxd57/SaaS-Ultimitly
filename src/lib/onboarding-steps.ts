// ---------------------------------------------------------------------------
// Başlangıç rehberi adım kararları — SAF (DB yok), panel ve testler aynı kuralı okur.
//
// "Rezervasyonlarınızı bağlayın" adımı (kurucu kararı 10-09, talimat 09-07 kapı 2 "Hospitable olmadan Lixus'un büyük bölümü
// çalışacak"): eskiden YALNIZ kanal (mesajlaşma) bağlantısıyla tamamlanıyordu → yalnız takvim (iCal) bağlayan host rehberi
// hiç bitiremiyordu. Artık kanal bağlantısı YA DA en az bir takvim bağlantısı yeterli; ikisi de rezervasyon getirir.
// ---------------------------------------------------------------------------

export function reservationsConnectedStepDone(input: { channelConnected: boolean; calendarSourceCount: number }): boolean {
  return input.channelConnected || input.calendarSourceCount > 0;
}
