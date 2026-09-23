// ---------------------------------------------------------------------------
// GİRİŞ SONRASI YÖNLENDİRME HEDEFİ — saf, istemci+sunucu ortak (09-23 denetimi)
//
// 🚨 AÇIK YÖNLENDİRME ÖLÇÜLDÜ (08-07 düzeltmesinin atlatması): giriş formu `?next=`
// değerini `new URL(next, origin)` ile çözüp ORIGIN'i karşılaştırıyor, sonra
// `pathname + search + hash`i `router.push`a veriyordu. `/.//evil.example/phish`
// origin kontrolünden GEÇER (göreli yol) ama yol normalizasyonu pathname'i
// `//evil.example/phish` yapar ve Next bunu PROTOKOL-GÖRELİ DIŞ adres sayıp siteden
// çıkar. Senaryo: kurban gerçek domainde şifre + 2FA koduyla giriş yapar, ardından
// saldırganın "kodunuzu tekrar girin" sayfasına düşer → 2FA dâhil kimlik avı.
// `/..//evil` ve `https://<bizim-origin>//evil` de aynı sınıftır.
//
// Kural: çözülen hedef BİZİM origin'imizde OLMALI ve yolu TEK `/` ile başlamalı.
// Karakter kara listesi DEĞİL (08-07 dersi: TAB/LF/CR'yi URL ayrıştırıcısı siler) —
// SONUÇ sınanır. Ters bölü özel şemalarda `/`e çevrilir, yani `/\evil` de `//evil`
// olur ve aynı kontrolde düşer.
// ---------------------------------------------------------------------------

/** Güvenli hedef (göreli yol) ya da `null` (→ çağıran varsayılana düşer). */
export function safeRedirectTarget(next: string | null | undefined, origin: string): string | null {
  if (!next) return null;
  let u: URL;
  try {
    u = new URL(next, origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (!u.pathname.startsWith("/") || u.pathname.startsWith("//")) return null;
  return u.pathname + u.search + u.hash;
}
