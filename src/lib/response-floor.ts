// ---------------------------------------------------------------------------
// TUTARLI YANIT SÜRESİ — yaprak modül (Tur 7, Codex 11-05 gece: "aynı 200 tek başına hesabın gizlendiğini kanıtlamaz"; OWASP Authentication
// Cheat Sheet: genel yanıtın yanında tutarlı yanıt süresi). Hesaba bağlı iş yapan dal (hesap var / yok, son 10 dakikada bağlantı gitmiş,
// gönderim, kuyruk / sağlayıcı hatası) cevabı en az bu kadar sürede verir → süre farkı dışarıdan okunamaz. Mutlak sabit süre değil: iş
// tabanı AŞARSA (veritabanı yavaş) fark yeniden görünür; asıl savunma yine hız sınırları + sessiz pencere.
// ---------------------------------------------------------------------------

/** `startedAt` (`performance.now()`) anından bu yana `floorMs` dolmadıysa kalanı bekler. */
export async function padResponseTime(startedAt: number, floorMs: number): Promise<void> {
  const wait = floorMs - (performance.now() - startedAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Hesaba bağlı dalların en kısa yanıt süresi. Ölçülen iş (test veritabanı, yedi dal, medyan) 5–19 ms — en hızlısı yalnız GERÇEK hesapta
 * oluşabilen "gönderim hakkı dolu" dalıydı (ayırt edici sinyal); tabanla 303–308 ms. Üretimde ağ üzerinden veritabanıyla onlarca ms — 300 ms
 * hepsini örter, kullanıcı için fark edilmez (düğmeye bir kez basılır). Ölçüm: Tur 7 raporu §6. (Next.js `route.ts` yalnız rota alanlarını
 * dışa aktarır — sabit burada.)
 */
export const RESEND_VERIFY_RESPONSE_FLOOR_MS = 300;
