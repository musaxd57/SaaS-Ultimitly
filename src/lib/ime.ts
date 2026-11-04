/**
 * IME (Japonca / Çince / Korece …) aday penceresi açıkken basılan Enter ADAY SEÇER — "Enter gönderir" yüzeyleri onu gönderme saymamalı
 * (ajan turu 11-04: misafir QR sohbetinde mesaj yarım gidiyordu). İki işaret birlikte: `isComposing` çoğu tarayıcıda yeter; Safari masaüstü
 * bileşimi bitiren Enter'da `isComposing` false verip `keyCode 229` gönderir. Saf; istemci bileşenleri kullanır.
 */
export function isImeComposing(e: { nativeEvent: { isComposing?: boolean }; keyCode?: number }): boolean {
  return e.nativeEvent.isComposing === true || e.keyCode === 229;
}
