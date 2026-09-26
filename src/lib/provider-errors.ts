import "server-only";

import { IngestError, type IngestErrorKind } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// DIŞ SAĞLAYICI HATASI → MÜŞTERİ METNİ (denetim, 08-06)
//
// 🚨 KAPATILAN SIZINTI: altı Hospitable rotası `err.message`'ı DOĞRUDAN
// müşteriye döndürüyordu ve o metin `hospitable.ts`'te şöyle kuruluyor:
//     `Hospitable API hatası (HTTP ${res.status}): ${body.slice(0, 200)}`
// Yani host'un Gelen Kutusu'nda şunu görebiliyordu:
//     Hospitable API hatası (HTTP 402): {"message":"Subscription not active"}
// Ham İNGİLİZCE sağlayıcı JSON'u + HTTP kodu. Hem korkutucu hem anlaşılmaz hem
// de gereksiz iç bilgi. (Kurucu org'un aboneliği bugün 402 → CANLIDA görülebilir.)
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

/** 402 cümlesi — `api.ts serverError`ın 409'u da BUNU kullanır (aynı durum, tek metin). */
export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Hospitable aboneliğiniz aktif değil. Kanal senkronizasyonu için aboneliğinizi yenileyin.";

/**
 * Ağa hiç çıkılmadı: kimlik bilgisi yok. `api/hospitable/sync` ön kontrolü AYNI sabiti kullanır.
 * Sağlayıcı adı YOK (kurucu 09-23: arayüzde yalnız Airbnb/Booking/Vrbo; PMS adı görünmez).
 */
export const NOT_CONNECTED_MESSAGE = "Kanal hesabınız bağlı değil. Ayarlar'dan bağlantınızı kurun.";

const UNREACHABLE_MESSAGE = "Hospitable'a şu anda ulaşılamıyor. Lütfen kısa bir süre sonra tekrar deneyin.";

// ---------------------------------------------------------------------------
// SARMALDAN BAĞIMSIZ OKUMA — TEK KAYNAK (09-23 olayı)
//
// 🚨 V0.6 ingest adaptörü `HospitableError`ı `IngestError`a SARIYOR. `err.name ===
// "HospitableError"` / `instanceof HospitableError` diye bakan üç kontrol o günden
// beri adaptörden geçen yolda SESSİZCE ölüydü:
//   · `scheduled-sync` 402 susturması → kurucuya her senkron geçişinde "sistem
//     hatası" e-postası (CANLI OLAY, 09-08 → 09-23),
//   · `api.ts serverError` → aynı 402 → 500 + alarm,
//   · bu dosyanın `providerErrorMessage`ı → elle senkron düğmesi 402'de jenerik
//     metin ("aboneliğinizi yenileyin" yerine).
// Tip sistemi `unknown` bir hatanın hangi sarmalda geleceğini bilemez; bu yüzden
// okuma TEK yerde ve sınıf pinli (`tests/unit/provider-error-wrapper-pin.test.ts`).
//
// ⚠️ ÖRDEK TİPLEMESİ YOK: yalnız TANIDIĞIMIZ iki sağlayıcı hata tipi okunur.
// `status` taşıyan her hata sağlayıcı hatası değildir — OpenAI SDK hatası da
// `status: 402` (kota) taşır ve o "Hospitable aboneliği pasif" DEĞİLDİR; onu
// tanımak gerçek bir arızayı sessizce susturmak olurdu (test-pinli).
// ---------------------------------------------------------------------------

type ProviderErrorView = { status?: number; retryAfterSec?: number; kind?: IngestErrorKind };

function asProviderError(err: unknown): ProviderErrorView | null {
  if (err instanceof IngestError) return err;
  if (err instanceof Error && err.name === "HospitableError") return err as ProviderErrorView;
  return null;
}

/** Sağlayıcı hatasının HTTP durumu — hangi sarmalda gelirse gelsin; tanımadığı hatada `undefined`. */
export function providerErrorStatus(err: unknown): number | undefined {
  return asProviderError(err)?.status;
}

/**
 * "Bu org'un kanal hesabı sağlayıcıda askıda" — beklenen, KALICI, org'un kendi
 * faturasına bağlı; Lixus arızası DEĞİL → alarm e-postası üretmez.
 * Ingest sarmalında TİPLİ sınıf (`blocked`) esastır: başka bir sağlayıcı aynı
 * durumu farklı bir kodla bildirebilir. Ham Hospitable hatasında 402.
 */
export function isChannelSubscriptionInactive(err: unknown): boolean {
  if (err instanceof IngestError) return err.kind === "blocked";
  return providerErrorStatus(err) === 402;
}

/** HTTP durumundan müşteri cümlesi. `null` = bu durum için özel bir metnimiz yok. */
function byStatus(status: number | undefined, retryAfterSec?: number): string | null {
  if (status === 402) return SUBSCRIPTION_INACTIVE_MESSAGE;
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

  if (err instanceof IngestError) {
    // Ağa hiç çıkılmadı — "ulaşılamıyor" YANLIŞ olurdu, sorun bağlantının yokluğu.
    if (err.kind === "no_credential") return NOT_CONNECTED_MESSAGE;
    // Statüsüz `unknown` = adaptör HospitableError OLMAYAN bir hatayı sardı (ör. bizim
    // normalizasyon kodumuzda bir TypeError). Sağlayıcıya ulaşıldığı bile kanıtsız →
    // Hospitable'ı suçlayan bir cümle kurulmaz, çağıranın kendi cümlesi.
    if (err.kind === "unknown" && err.status === undefined) return fallback;
    // Yetenek uygulanmadı / verilmedi: ağa çıkılmadı, sağlayıcıyı ("…'a ulaşılamıyor")
    // suçlayan cümle YANLIŞ olurdu — çağıranın kendi cümlesi.
    if (err.kind === "unsupported") return fallback;
  }

  const pe = asProviderError(err);
  if (pe) {
    const mapped = byStatus(pe.status, pe.retryAfterSec);
    if (mapped) return mapped;
    // Statüsüz ya da tanımadığımız statülü sağlayıcı hatası: ağa hiç çıkılamadı
    // (fetch fırladı / timeout) ya da beklenmedik bir kod geldi.
    return UNREACHABLE_MESSAGE;
  }

  // ⚠️ TANIMADIĞIMIZ HATA → çağıranın kendi cümlesi. `err.message`'a ASLA
  // düşülmez: Prisma/Node/OpenAI hataları da buraya gelebilir ve onların
  // metinleri iç tablo adları, dosya yolları, model adları taşır.
  return fallback;
}
