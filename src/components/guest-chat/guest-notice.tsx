import { BrandMark } from "@/components/brand";

/**
 * MİSAFİRİN GÖRDÜĞÜ "SOHBET AÇIK DEĞİL" EKRANI (kurucu, 2026-09-11:
 * "Bozuk/kapalı QR → misafir dairede ham 404 görüyor ve tek düğme onu B2B
 * landing sayfasına götürüyor. düzelt bunu görsel olarak çok iyi UI şeyi yap").
 *
 * 🚨 ÖLÇÜLEN KUSUR: beş ayrı koşul (global anahtar kapalı · token bilinmiyor ·
 * mülk silinmiş · QR panelden kapatılmış · abonelik bitmiş) `notFound()` ile
 * ürünün B2B 404'üne düşüyordu. O sayfanın İKİ çıkışı da `/` idi, yani
 * dairedeki QR'ı okutan misafir Lixus'un SATIŞ SİTESİNE (fiyat kartları,
 * "Ücretsiz dene") iniyordu. Misafir bizim müşterimiz değil, müşterimizin
 * misafiri.
 *
 * 🚨 TEK METİN, BEŞ KOŞUL — BİLİNÇLİ. Ekran hangi sebeple kapalı olduğunu
 * SÖYLEMEZ: "bu token yok" ile "bu QR kapatıldı"yı ayırmak, token uzayını
 * taranabilir kılardı (numaralandırma koruması). Misafir için de fark yok —
 * yapabileceği tek şey aynı.
 *
 * 🚨 DIŞ BAĞLANTI YOK. Ne landing, ne kayıt, ne fiyat. Misafire verilebilecek
 * TEK doğru yönlendirme ev sahibidir; bizim onun iletişim bilgisini bu sayfada
 * göstermeye yetkimiz de yok (halka açık, kimliksiz yüzey).
 *
 * Mülk adı ASLA yazılmaz (host'un özel etiketi, halka açık sayfa).
 */
export function GuestNotice({
  title,
  body,
  hint,
}: {
  title: string;
  body: string;
  hint?: string;
}) {
  return (
    // `min-h-dvh`: mobil tarayıcı çubuğu altında `100vh` içeriği kırpıyor.
    <div className="flex min-h-dvh flex-col bg-background px-5 py-10">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <BrandMark className="size-8" />
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {hint ? (
          <p className="mt-5 rounded-xl border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <p className="mx-auto mt-8 text-center text-[11px] text-muted-foreground">
        Lixus AI Misafir Asistanı
      </p>
    </div>
  );
}
