// ---------------------------------------------------------------------------
// Doğrulama e-postası YENİDEN İSTEME penceresi — YAPRAK modül (istemci bileşenleri de içe aktarır; `email-verify.ts` `node:crypto`
// kullandığı için tarayıcıya giremez). Sunucunun sessiz penceresi (U12, kurucu 10-22) ve formların bekleme sayacı TEK sabitten.
// ---------------------------------------------------------------------------

/** Yeniden gönderme yolu: son bu kadar süre içinde üretilmiş geçerli bağlantı varsa yenisi üretilmez (U12, kurucu 10-22). */
export const VERIFY_RESEND_QUIET_MS = 10 * 60 * 1000;

/**
 * "Tekrar gönder"e basıldıktan sonra gösterilen metin (Tur 7 T7-AUTH-1, kurucu onayı 11-05 — Codex'in önerdiği metin). Sunucu aynı 200'ü
 * hesabın varlığına bakmadan döndürür ve son 10 dakikada bağlantı gittiyse yenisini göndermez — "gönderildi" demek yalan olurdu.
 * "10 dakika" yukarıdaki sabitle pinli (`verify-resend-window.test.ts`).
 */
export const VERIFY_RESEND_REQUESTED_TEXT =
  "Talebiniz alındı. Doğrulama e-postası için gelen kutunuzu ve spam klasörünü kontrol edin. Yeniden istemek için 10 dakika bekleyin.";
