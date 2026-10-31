import { IngestError, type IngestAdapter } from "../ingest";
import type { OutboundAdapter, OutboundSendResult } from "../outbound";
import type { WebhookVerdict } from "../capabilities";

// ---------------------------------------------------------------------------
// AIRBNB DIRECT — BOŞ SÖZLEŞME ADAPTÖRÜ (kurucu talimatı: "endpoint'leri olmayacak ama
// Lixus'un Airbnb'den ne beklediği belli olacak").
//
// 🚨 AĞA ASLA ÇIKMAZ: bu dosya `fetch`, HTTP modülü, ortam değişkeni ya da veritabanı
// kullanmaz ve kimlik bilgisini OKUMAZ (mekanik pin). Airbnb sandbox'ı, resmî doküman ve
// kimlik bilgisi olmadan tahminî uç nokta/yük/imza şeması yazmak değişmez 18 ihlalidir.
// 🚨 KAYDEDİLMEZ: `index.ts` bu adaptörleri kayıt defterine koymaz ve tip sistemi de
// koyamaz (kayıt defteri yalnız CANLI sağlayıcı kümesi `OutboundProvider`ı kabul eder).
// Yanlışlıkla kaydedilse bile boş yetenek kümesi yüzünden `dispatchOutbound` reddeder.
// Her çağrı KAPALI başarısız olur: gönderim `definitive_failure` (hiçbir şey gönderilmedi),
// okuma `IngestError("unsupported")`, webhook reddedilir — asla sessiz "başarı" yok.
// ---------------------------------------------------------------------------

const PROVIDER = "airbnb_direct" as const;
const WHY = "airbnb_direct: yetenek sözleşmede ilan edildi (planned), uygulanmadı — ağa çıkılmadı";

export const airbnbDirectOutboundAdapter: OutboundAdapter<typeof PROVIDER> = {
  provider: PROVIDER,
  capabilities: new Set(),
  async send(): Promise<OutboundSendResult> {
    return { ok: false, kind: "definitive_failure", error: `${WHY} (messages.send)`, providerMessageId: null, retryAfterSec: null };
  },
};

function unsupported(capability: string): Promise<never> {
  return Promise.reject(new IngestError(PROVIDER, "unsupported", `${WHY} (${capability})`));
}

export const airbnbDirectIngestAdapter: IngestAdapter<typeof PROVIDER> = {
  provider: PROVIDER,
  capabilities: new Set(),
  listProperties: () => unsupported("properties.read"),
  listReservations: () => unsupported("reservations.read"),
  listMessages: () => unsupported("messages.read"),
};

/** Webhook doğrulaması uygulanana kadar HER istek reddedilir — kabul eden sahte doğrulayıcı YOK. */
export function verifyAirbnbDirectWebhook(): WebhookVerdict {
  return { ok: false, reason: "not_implemented" };
}
