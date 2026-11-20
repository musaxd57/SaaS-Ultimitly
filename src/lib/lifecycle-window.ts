/**
 * Giriş bilgisi (kapı kodu taşıyabilir) varıştan en çok bu kadar gün önce gider. TEK KAYNAK: aday seçimi, son talep
 * (kuyruksuz yol) ve kuyruk işçisinin gönderim anı vetosu aynı pencereyi kullanır (Y4, 10-14 inceleme).
 */
export const CHECKIN_LEAD_DAYS = 4;

/**
 * Çıkış mesajı yalnız çıkış GÜNÜ, işletmenin saatiyle bu aralıkta gider ([başlangıç, bitiş) saat). TEK KAYNAK: gönderici
 * (`sendDueCheckouts`), "otomatik gönderim durduruldu" yüklemi (`booking-conflict-auto-send.ts`) ve kuyruk işçisinin çıkış ertelemesi
 * (`outbox/worker.ts` `checkoutNotYetDue`) aynı sınırı okur — çıkış günü öğleden sonra artık gönderilecek bir çıkış mesajı yoktur.
 */
export const CHECKOUT_SEND_START_HOUR = 8;
export const CHECKOUT_SEND_END_HOUR = 12;
