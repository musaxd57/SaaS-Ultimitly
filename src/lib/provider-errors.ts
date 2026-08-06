import "server-only";

// ---------------------------------------------------------------------------
// DIŞ SAĞLAYICI HATASI → MÜŞTERİ METNİ (denetim, 08-06)
//
// 🚨 KAPATILAN SIZINTI: altı Hospitable rotası `err.message`'ı DOĞRUDAN
// müşteriye döndürüyordu ve o metin `hospitable.ts`'te şöyle kuruluyor:
//     `Hospitable API hatası (HTTP ${res.status}): ${body.slice(0, 200)}`
// Yani host'un Gelen Kutusu'nda şunu görebiliyordu:
//     Hospitable API hatası (HTTP 402): {"message":"Subscription not active"}
// Ham İNGİLİZCE sağlayıcı JSON'u + HTTP kodu. Hem korkutucu hem anlaşılmaz hem
// de gereksiz iç bilgi. (Nuve'nin aboneliği bugün 402 → CANLIDA görülebilir.)
//
// ⚠️ HAM METİN KAYBOLMUYOR: bu fonksiyon YALNIZ müşteriye giden metni üretir.
// Çağıran, hatayı her zamanki gibi `reportError`/log'a HAM hâliyle vermeye
// devam eder — teşhis kabiliyeti aynen korunur.
//
// ⚠️ Metinler DURUMA göre ayrışır çünkü müşterinin YAPACAĞI ŞEY farklı:
// 402'de abonelik yenilenir, 401/403'te bağlantı yeniden kurulur, 429'da
// beklenir, 5xx'te sonra denenir. Tek bir "bir hata oldu" metni bu ayrımı
// yok eder ve host'u destek yazmaya iter.
// ---------------------------------------------------------------------------

/** HTTP durumundan müşteri cümlesi. `null` = bu durum için özel bir metnimiz yok. */
function byStatus(status: number | undefined, retryAfterSec?: number): string | null {
  if (status === 402) {
    // ⚠️ `lib/api.ts:122` ile BİREBİR aynı cümle — aynı durum, tek metin.
    return "Hospitable aboneliğiniz aktif değil. Kanal senkronizasyonu için aboneliğinizi yenileyin.";
  }
  if (status === 401 || status === 403) {
    return (
      "Hospitable bağlantı yetkiniz geçersiz görünüyor. " +
      "Ayarlar bölümünden hesabınızı yeniden bağlayın."
    );
  }
  if (status === 404) {
    return "İlgili kayıt Hospitable tarafında bulunamadı. Rezervasyon silinmiş veya arşivlenmiş olabilir.";
  }
  if (status === 429) {
    const ne = retryAfterSec && retryAfterSec > 0 ? `${Math.max(1, Math.ceil(retryAfterSec / 60))} dakika` : "birkaç dakika";
    return `Hospitable istek sınırına ulaşıldı. Lütfen ${ne} sonra tekrar deneyin.`;
  }
  if (status && status >= 500) {
    return "Hospitable şu anda yanıt vermiyor. Lütfen kısa bir süre sonra tekrar deneyin.";
  }
  return null;
}

/**
 * Aynı çeviri, girdisi HATA NESNESİ değil HATA METNİ olan yollar için
 * (`sendOnChannel` bir `SendOutcome.error` STRING'i döndürüyor).
 *
 * 🚨 İÇ METİN DEĞİŞTİRİLEMEZ: `isDefinitiveSendFailure` (messaging.ts) tam olarak
 * o string'i `/HTTP (4\d\d)/` ile AYRIŞTIRIYOR ve claim'in geri alınıp
 * alınmayacağına ona göre karar veriyor. Bu yüzden burada string'i ÜRETEN yere
 * dokunulmuyor; yalnız MÜŞTERİYE GÖSTERİLEN metin türetiliyor. Aynı regex
 * kullanılıyor ki iki okuma birbirinden ayrışmasın.
 */
export function providerErrorMessageFromText(error: string | null | undefined, fallback: string): string {
  const m = /HTTP (\d{3})/.exec(error ?? "");
  return (m ? byStatus(Number(m[1])) : null) ?? fallback;
}

/** Hospitable/ağ hatasını müşteriye gösterilebilir Türkçe bir cümleye çevirir. */
export function providerErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;

  if (err.name === "HospitableError") {
    const status = (err as { status?: number }).status;
    const mapped = byStatus(status, (err as { retryAfterSec?: number }).retryAfterSec);
    if (mapped) return mapped;
    // Statüsüz ya da tanımadığımız statülü HospitableError: ağa hiç çıkılamadı
    // (fetch fırladı / timeout) ya da beklenmedik bir kod geldi.
    return "Hospitable'a şu anda ulaşılamıyor. Lütfen kısa bir süre sonra tekrar deneyin.";
  }

  // ⚠️ TANIMADIĞIMIZ HATA → çağıranın kendi cümlesi. `err.message`'a ASLA
  // düşülmez: Prisma/Node/OpenAI hataları da buraya gelebilir ve onların
  // metinleri iç tablo adları, dosya yolları, model adları taşır.
  return fallback;
}
