// UX-10 D5 — "Giriş mesajını gönderin" sonuç cümleleri (saf yaprak; istemci + sunucu güvenli). Kurallar: müşteriye giden metin sade, "-in"
// hitabı; belirsiz teslimde "ulaşmış olabilir" (elle cevabın bugünkü cümlesiyle aynı anlam) ve YENİDEN GÖNDER teklif edilmez.

/** Elle gönderimin reddedildiği sebepler (tek kaynak; `automation.ts` `prepareCheckinNow` bunları döner). */
export type CheckinNowRefusal =
  | "paused"
  | "not_found"
  | "already_sent"
  | "not_confirmed"
  | "out_of_window"
  | "no_channel"
  | "erased"
  | "missing"
  | "unfilled"
  | "no_connection"
  | "changed"
  | "queue_owns"
  | "held";

export const CHECKIN_NOW_TEXT: Record<CheckinNowRefusal | "definitive" | "ambiguous" | "rate_limited" | "sent" | "queued", string> = {
  sent: "Giriş mesajı misafirinize gönderildi.",
  queued: "Giriş mesajı gönderim sırasına alındı; birkaç dakika içinde gider.",
  paused: "Otomatik mesajlar şu an durduruldu. Mesajı konuşmadan kendiniz gönderin.",
  not_found: "Bu rezervasyon bulunamadı.",
  already_sent: "Bu misafire giriş mesajı zaten gönderildi.",
  not_confirmed: "Bu rezervasyon artık onaylı değil; mesaj gönderilmedi.",
  out_of_window: "Giriş mesajı yalnız bugün ve sonraki iki gün gelecek misafire buradan gönderilir.",
  no_channel: "Bu rezervasyona buradan mesaj gönderilemiyor (takvimden ya da elle eklendi).",
  erased: "Misafirin verileri silindiği için mesaj gönderilemez.",
  missing: "Bu dairenin giriş mesajı yazılmamış. Önce daire sayfasından yazın.",
  unfilled: "Giriş mesajında doldurulmamış bir alan var. Önce daire sayfasından düzeltin.",
  no_connection: "Kanal bağlantısı yok. Önce bağlantıyı kurun.",
  changed: "Mesaj ya da rezervasyon bu arada değişti. Yeniden bakın.",
  queue_owns: "Bu misafirin giriş mesajı zaten gönderim sırasında.",
  held: "Kanal şu an çok fazla istek aldı. Birkaç dakika sonra tekrar deneyin.",
  definitive: "Gönderilemedi; mesaj misafirinize gitmedi. Birazdan tekrar deneyin.",
  ambiguous: "Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı kontrol edin.",
  rate_limited: "Kanal şu an çok fazla istek aldı; mesaj gitmedi. Birkaç dakika sonra tekrar deneyin.",
};
