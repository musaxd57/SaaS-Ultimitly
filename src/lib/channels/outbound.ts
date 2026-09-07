import "server-only";

import type { SendResultKind } from "@/lib/outbox/state";

// ---------------------------------------------------------------------------
// OUTBOUND DISPATCH SINIRI (V0.1 — Channel Independence, ilk dilim)
//
// Bu modül ÇEKİRDEK ile SAĞLAYICI arasındaki tek giden-mesaj sınırıdır.
// Çekirdek (automation · outbox worker · reply rotası) buradan yalnız ÜÇ şeyi
// bilir: rota (`resolveOutboundRoute`), gönderim (`dispatchOutbound`) ve
// tipli sonuç (`OutboundSendResult.kind`). Hangi HTTP istemcisinin çağrıldığı,
// hata metninin biçimi, tek-atış kuralı — hepsi adaptörün içindedir.
//
// 🚨 DAVRANIŞ KORUNUR (V0.1 sözleşmesi, kod-doğrulandı 09-07):
//   · Bugün `externalReservationId` taşıyan HER hedef Hospitable'a gider; sağlayıcı
//     seçimi bir CONNECTION özelliği olmalıydı ama connection tablosu yok (V0.3).
//     Bu yüzden karar `resolveOutboundRoute` içinde TEK yerde, açıkça "hospitable"
//     olarak verilir — eskiden iki dosyada (messaging.ts + worker.ts) ÖRTÜK olarak
//     verilen aynı karar.
//   · `qr-chat:` öneki = iç thread (QR concierge; misafir anonim web ziyaretçisi,
//     dönüş kanalı yok) → LOCAL. Kural eskiden yalnız `sendOnChannel`daydı; worker
//     `defaultSend` bakmıyordu (ulaşılmaz: enqueue yolları iç thread'i kuyruğa
//     almaz). Artık tek yerde ve iki yol için de geçerli.
//   · Boş hedef → LOCAL (manuel/e-posta thread'i; eski `{ok:true, skipped:true}`).
//   · Kimlik bilgisi (`token`) ÇAĞIRAN tarafından çözülür ve OLDUĞU GİBİ iletilir —
//     `undefined` dahil (istemcinin env fallback'i, kurucu org'un legacy yolu).
//     Fail-closed'a çevirmek V0.3'ün (credential → connection) işi; burada davranış
//     birebir.
//
// ⚠️ V0 ÖRNEK ADLARI MEKANİK UYGULANMADI: "ChannelConnection", "capabilities
// registry", "delivery receipts" burada YOK. V0.1 yalnız dispatch'i gerçekleştirir;
// capability seti tek üyeli (`messages.send`) ve şimdilik yalnız "bu adaptör
// gönderebilir mi" sorusuna cevap verir (iCal adaptörü V0.2+'da gönderemez).
// ---------------------------------------------------------------------------

/** Kapalı sağlayıcı kümesi. Yeni sağlayıcı = yeni adaptör + bu union'a bir üye. */
export type OutboundProvider = "hospitable";

/** İç (QR concierge) thread'lerin `externalReservationId` öneki — tek kaynak. */
export const INTERNAL_THREAD_PREFIX = "qr-chat:";

export interface OutboundDestination {
  provider: OutboundProvider;
  /** Sağlayıcının konuşma/rezervasyon kimliği (Hospitable: reservation UUID). */
  externalReservationId: string;
}

export type OutboundRoute =
  | { kind: "local"; reason: "no_destination" | "internal_thread" }
  | { kind: "external"; destination: OutboundDestination };

/**
 * Hedefi çöz: dışarı gidecek mi, gidecekse hangi sağlayıcıya. Saf fonksiyon;
 * `ChannelTarget`, `OutboxRow` ve `Conversation` seçimleri aynı alanı taşır.
 */
export function resolveOutboundRoute(target: { externalReservationId?: string | null }): OutboundRoute {
  const ext = target.externalReservationId;
  if (!ext) return { kind: "local", reason: "no_destination" };
  if (ext.startsWith(INTERNAL_THREAD_PREFIX)) return { kind: "local", reason: "internal_thread" };
  return { kind: "external", destination: { provider: "hospitable", externalReservationId: ext } };
}

export interface OutboundCredential {
  provider: OutboundProvider;
  /** Sağlayıcı erişim token'ı; çağıran çözer (`getOrgHospitableToken`). */
  token: string | undefined;
}

export type OutboundCapability = "messages.send";

/**
 * Tipli gönderim sonucu. `kind` ADAPTÖR tarafından, sağlayıcının KENDİ hata
 * şeklinden üretilir (Hospitable: HTTP durum kodu). Çekirdek `error` metnini
 * regex'lemek zorunda değildir; metin yalnız teşhis/geriye-uyum içindir.
 */
export interface OutboundSendResult {
  ok: boolean;
  kind: SendResultKind;
  error?: string | null;
  providerMessageId?: string | null;
  /** 429'da sağlayıcının Retry-After'ı (saniye). */
  retryAfterSec?: number | null;
}

export interface OutboundAdapter {
  readonly provider: OutboundProvider;
  readonly capabilities: ReadonlySet<OutboundCapability>;
  /** TAM OLARAK BİR sağlayıcı denemesi (tek atış). Asla fırlatmaz. */
  send(destination: OutboundDestination, body: string, credential: OutboundCredential): Promise<OutboundSendResult>;
}

const registered = new Map<OutboundProvider, OutboundAdapter>();
const overrides = new Map<OutboundProvider, OutboundAdapter>();

export function registerOutboundAdapter(adapter: OutboundAdapter): void {
  registered.set(adapter.provider, adapter);
}

export function getOutboundAdapter(provider: OutboundProvider): OutboundAdapter | null {
  return overrides.get(provider) ?? registered.get(provider) ?? null;
}

/** Test kancası: kayıtlı adaptörün ÜSTÜNE geçici bir sahte koy (null = kaldır). */
export function __setOutboundAdapterForTest(provider: OutboundProvider, adapter: OutboundAdapter | null): void {
  if (adapter) overrides.set(provider, adapter);
  else overrides.delete(provider);
}

/**
 * Tek gönderim: adaptörü seç, yeteneği ve kimlik-bilgisi/sağlayıcı eşleşmesini
 * doğrula, adaptöre devret. Hiçbir dalda fırlatmaz — kuyruk worker'ı ve satır
 * içi yollar sonucu `kind` üzerinden sınıflandırır.
 */
export async function dispatchOutbound(
  destination: OutboundDestination,
  body: string,
  credential: OutboundCredential,
): Promise<OutboundSendResult> {
  const adapter = getOutboundAdapter(destination.provider);
  if (!adapter) {
    return { ok: false, kind: "definitive_failure", error: `no outbound adapter registered for provider "${destination.provider}"` };
  }
  if (!adapter.capabilities.has("messages.send")) {
    return { ok: false, kind: "definitive_failure", error: `provider "${destination.provider}" cannot send messages` };
  }
  if (credential.provider !== destination.provider) {
    // Bir sağlayıcının kimlik bilgisi başka bir sağlayıcıya ASLA taşınmaz.
    return { ok: false, kind: "definitive_failure", error: "credential provider does not match destination provider" };
  }
  return adapter.send(destination, body, credential);
}
