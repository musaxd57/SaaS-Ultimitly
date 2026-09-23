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
  // 🚨 API YOLU HEDEF OLAMAZ (09-23 saldırgan turu): aynı origin'deki `/api/...` da geçiyordu
  // → saldırganın bağlantısıyla giriş yapan kurban girişin hemen ardından `/api/auth/logout`a
  // (anında çıkış) ya da `/api/account/export`a (veri dökümü + export hakkı yanar) gidiyordu.
  // Giriş sonrası meşru hedef HER ZAMAN bir sayfadır. Yüzde kodlu ve büyük harfli yazım da
  // aynı yola çözüldüğü için karşılaştırma çözülmüş + küçük harfli biçimde yapılır.
  const p = safeDecode(u.pathname).toLowerCase();
  if (p === "/api" || p.startsWith("/api/")) return null;
  return u.pathname + u.search + u.hash;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
