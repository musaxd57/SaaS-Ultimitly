/**
 * Demo (inceleme) hesabı bandı. Hesaptaki her mülk, rezervasyon ve mesaj KURGUSALDIR ve hiçbir
 * kanala bağlı değildir: buradan yazılan cevap bir misafire GİTMEZ (kanal hedefi yok). Band bunu
 * sade dille söyler ki inceleme ekibi "gönderdim ama gitmedi" diye yanılmasın.
 */
export function DemoBanner() {
  return (
    <div
      data-testid="demo-banner"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-center text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
    >
      <span className="font-medium">Örnek hesap</span>
      <span>Mülkler, rezervasyonlar ve mesajlar örnek verilerdir; buradan hiçbir misafire mesaj gönderilmez.</span>
    </div>
  );
}
