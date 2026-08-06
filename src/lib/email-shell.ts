// ---------------------------------------------------------------------------
// KİMLİK E-POSTALARININ ORTAK GÖRSEL KABUĞU
//
// Dört kimlik e-postası (doğrulama · şifre sıfırlama bağlantısı · sıfırlama
// kodu · değiştirme kodu) daha önce her biri kendi HTML'ini elle kuruyordu;
// dördü de birbirinden hafifçe farklıydı ve `esc` yardımcısı iki dosyada
// kopyalanmıştı. Tek kabuk: aynı marka, aynı hiyerarşi, tek yerden değişir.
//
// 📧 E-POSTA HTML'İ WEB HTML'İ DEĞİLDİR — buradaki kısıtlar bilinçli:
//  · Layout TABLO ile kurulur. Flexbox/grid Outlook'ta çalışmaz.
//  · Stil YALNIZ inline. `<style>` blokları Gmail'de büyük ölçüde budanır.
//  · GÖRSEL YOK. Logo dosyası çekmek yerine yazı-marka kullanılıyor: e-posta
//    istemcilerinin çoğu uzak görselleri VARSAYILAN OLARAK ENGELLER, yani
//    kırık bir logo kutusu iyi tipografiden daha kötü görünür. Ayrıca uzak
//    görsel, e-postanın açılıp açılmadığını sızdıran bir izleme pikselidir.
//  · CSS değişkeni / `oklch()` / modern renk fonksiyonu YOK — hex.
// ---------------------------------------------------------------------------

/** HTML'e gömülecek her DEĞİŞKEN değer bundan geçer (ad, kod, URL). */
export function escapeHtml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

type IdentityEmailOptions = {
  /** Kart başlığı — tek satırda okunur olmalı. */
  heading: string;
  /** Başlığın altındaki açıklama. HTML KABUL EDER (çağıran kaçışlamaktan sorumlu). */
  intro: string;
  /** Büyük buton. Yoksa çizilmez. */
  action?: { label: string; url: string };
  /**
   * Kod bloğu (6-8 hane). Yoksa çizilmez.
   *
   * ⚠️ Blok `id="lixus-code"` taşır ve bu bir SÖZLEŞMEDİR, süs değil: testler
   * kodu e-postadan bu id ile ayıklar. Eskiden `letter-spacing:4px` ile
   * eşleşiyorlardı, yani tamamen KOZMETİK bir stil değişikliği beş güvenlik
   * testini birden kırdı. Kanca stilden ayrık tutuldu ki tasarım serbestçe
   * değişebilsin.
   */
  code?: string;
  /** Kod bloğunun üstündeki tek satırlık yönerge. */
  codeCaption?: string;
  /** Kartın altındaki gri açıklama. HTML KABUL EDER. */
  footnote: string;
};

/**
 * Ortak kart. Açık gri zemin üzerinde beyaz kart, üstte yazı-marka, altta
 * gri dipnot — tek sütun, 480px, mobilde de aynı.
 */
export function identityEmailShell(o: IdentityEmailOptions): string {
  const button = o.action
    ? `
              <tr><td style="padding:28px 0 4px">
                <a href="${escapeHtml(o.action.url)}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;display:inline-block">${escapeHtml(o.action.label)}</a>
              </td></tr>`
    : "";

  const codeCaption = o.code && o.codeCaption
    ? `
              <tr><td style="padding:26px 0 0;color:#475569;font-size:15px;line-height:1.6">${o.codeCaption}</td></tr>`
    : "";

  const code = o.code
    ? `
              <tr><td style="padding:12px 0 4px">
                <div id="lixus-code" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:6px;text-indent:3px;color:#0f172a">${escapeHtml(o.code)}</div>
              </td></tr>`
    : "";

  // ⚠️ Kod bloğundaki `text-indent:3px` SÜS DEĞİL, bir düzeltmedir:
  // `letter-spacing` boşluğu HER karakterden sonra koyar — sonuncusu dahil — ve
  // `text-align:center` o görünmez son boşluğu da genişliğe sayar. Sonuç, görünen
  // rakamların gerçek merkezden yarım boşluk (6/2 = 3px) SOLA kayması. Aynı
  // miktarda indent kaymayı geri alır. Aralık 8px'ten 6px'e indirildi: 8 haneli
  // bir kodda 8px rakamları tek tek okutuyordu, 6px'te blok gibi okunuyor ve
  // elle kopyalaması kolaylaşıyor. Değerler BİRBİRİNE BAĞLI — aralığı
  // değiştiren indent'i de yarısına ayarlamalı.
  // ⚠️ Dış tablo `width="100%"`, iç tablo sabit 480 — Outlook'un tek güvenilir
  // ortalama yolu budur (`margin:0 auto` orada çalışmaz).
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%">
      <tr><td align="center" style="padding-bottom:20px">
        <span style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-0.2px">Lixus<span style="color:#64748b"> AI</span></span>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:36px 32px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;text-align:center">
          <tr><td style="font-size:21px;font-weight:700;color:#0f172a;line-height:1.35">${escapeHtml(o.heading)}</td></tr>
          <tr><td style="padding-top:12px;color:#475569;font-size:15px;line-height:1.65">${o.intro}</td></tr>${button}${codeCaption}${code}
        </table>
      </td></tr>
      <tr><td style="padding-top:20px;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#64748b;font-size:13px;line-height:1.6;text-align:center">${o.footnote}</td></tr>
    </table>
  </td></tr>
</table>`;
}

/** Buton çalışmazsa diye ham bağlantı — dipnotta kullanılır. */
export function plainLinkFallback(url: string): string {
  return `Buton çalışmazsa bu bağlantıyı tarayıcınıza yapıştırın:<br><span style="word-break:break-all;color:#475569">${escapeHtml(url)}</span>`;
}
