import "server-only";

import { sendMessage, type SendResult } from "@/lib/hospitable";
import { classifySendResult, type SendResultKind } from "@/lib/outbox/state";
import type { OutboundAdapter, OutboundCredential, OutboundDestination, OutboundSendResult } from "./outbound";

// ---------------------------------------------------------------------------
// HOSPITABLE GİDEN-MESAJ ADAPTÖRÜ (V0.1) — geçici köprü sağlayıcısı.
//
// 🚨 `sendMessage`'ın (Hospitable HTTP istemcisi) src/ içindeki TEK çağıranı
// bu dosyadır (`tests/unit/core-channel-independence.test.ts` pinler). Çekirdek
// `@/lib/hospitable`'ı import etmez; etmesi gereken tek şey `@/lib/channels`.
//
// Tek atış (`{ retries: 0 }`): POST /messages İDEMPOTENT DEĞİL. İstemci içi bir
// retry, aslında ulaşmış (yanıtı kaybolmuş) bir mesajı ikinci kez teslim eder →
// misafire çift mesaj. Belirsiz sonucun sahibi ÇAĞIRANDIR (durable outbox
// reconcile/review; satır içi yol claim'i tutar) — "çift mesaj, nadir sessiz
// kayıptan kötüdür" değişmezi. Eski `messaging.ts:58` ve `worker.ts:113`
// satırlarının BİREBİR argüman sözleşmesi buraya taşındı (shadow-compare pinli).
// ---------------------------------------------------------------------------

/**
 * Sağlayıcının KENDİ hata şeklinden tipli sınıf. Önce sayısal HTTP durumu (yeni,
 * `SendResult.status`); yoksa (ağ hatası / eski çağıran) metin regex'i ile aynı
 * sonuç (`classifySendResult`). Parite `outbound-classification-parity.test.ts`
 * ile her durum için pinli — ikisi ayrışamaz.
 */
export function classifyHospitableOutcome(r: SendResult): SendResultKind {
  if (r.ok) return "definitive_success";
  const status = r.status;
  if (typeof status === "number") {
    if (status === 429) return "rate_limited";
    if (status === 402) return "blocked";
    if (status >= 400 && status < 500 && status !== 408) return "definitive_failure";
    return "ambiguous";
  }
  return classifySendResult({ ok: r.ok, error: r.error });
}

export const hospitableOutboundAdapter: OutboundAdapter = {
  provider: "hospitable",
  capabilities: new Set<"messages.send">(["messages.send"]),
  async send(
    destination: OutboundDestination,
    body: string,
    credential: OutboundCredential,
  ): Promise<OutboundSendResult> {
    // 🚨 KİMLİK BİLGİSİ YOKSA AĞA ÇIKILMAZ ve sonuç DEFINITIVE'dir (V0.2 uyum kiti
    // bulgusu). İstemci token'sız çağrıda ağa çıkmadan fırlatır ama HTTP durumu
    // olmadığı için adaptör bunu "ambiguous" (teslim edilmiş olabilir) sayıyordu —
    // hiçbir şey gönderilmemişken. Belirsizlik reconcile/review yolunu boşa
    // çalıştırır; gerçek şu: kesin olarak GÖNDERİLMEDİ. Ulaşılabilirlik: worker
    // token'sız satırı zaten park eder, satır içi yollar token'ı önce kontrol eder;
    // burada yalnız env fallback'i de (kurucu legacy yolu) yoksa devreye girer.
    // Env fallback V0.3'te kaldırılacak (credential → connection).
    if (!credential.token && !process.env.HOSPITABLE_API_TOKEN) {
      return { ok: false, kind: "definitive_failure", error: "no credential for provider hospitable (nothing sent)", providerMessageId: null, retryAfterSec: null };
    }
    const r = await sendMessage(destination.externalReservationId, body, credential.token, { retries: 0 });
    return {
      ok: r.ok,
      kind: classifyHospitableOutcome(r),
      error: r.error ?? null,
      providerMessageId: r.id ?? null,
      retryAfterSec: r.retryAfterSec ?? null,
    };
  },
};
