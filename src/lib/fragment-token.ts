/**
 * E-posta bağlantısındaki parça (`#t=…`) anahtarı — e-posta doğrulama ve uyarı adresi onayı formlarının TEK okuyucusu. Bozuk yüzde
 * kodlaması ("%", "%E0%A4%A") `decodeURIComponent`i fırlatıyordu (Claude 2. dalga arayüz #7 / #21): adres çubuğu zaten temizlenmiş
 * olduğundan sayfa sonsuz "okunuyor" durumunda kalıyordu. Artık bozuk anahtar "anahtar yok" sayılır, form bilinen hata dalına düşer.
 */
export function fragmentToken(hash: string): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9._~%-]+)(?:&|$)/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}
