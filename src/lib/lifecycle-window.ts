/**
 * Giriş bilgisi (kapı kodu taşıyabilir) varıştan en çok bu kadar gün önce gider. TEK KAYNAK: aday seçimi, son talep
 * (kuyruksuz yol) ve kuyruk işçisinin gönderim anı vetosu aynı pencereyi kullanır (Y4, 10-14 inceleme).
 */
export const CHECKIN_LEAD_DAYS = 4;

/**
 * Çıkış mesajının gün içi aralığı ([başlangıç, bitiş) saat, işletmenin saatiyle, çıkış GÜNÜ). TEK KAYNAK: gönderici (`sendDueCheckouts`)
 * yalnız bu aralıkta aday seçer; "otomatik gönderim durduruldu" yüklemi (`booking-conflict-auto-send.ts`) bitiş saatini okur; kuyruk işçisi
 * (`outbox/worker.ts` `checkoutNotYetDue`) ertelenen satırı başlangıç saatine kurar, gönderim anı vetosu (`lifecycleVeto`) bitiş saatinden
 * sonra çıkış gününde bekleyen satırı `window_passed` ile iptal eder (kurucu 11-20 öğlen A3: "12:00 sabah hatırlatmasının son saati").
 */
export const CHECKOUT_SEND_START_HOUR = 8;
export const CHECKOUT_SEND_END_HOUR = 12;
