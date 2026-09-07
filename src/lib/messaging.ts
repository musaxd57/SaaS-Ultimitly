import "server-only";

import { dispatchOutbound, resolveOutboundRoute } from "@/lib/channels";
import type { SendResultKind } from "@/lib/outbox/state";

// ---------------------------------------------------------------------------
// Unified outbound messaging
//
// Delivers a reply on the guest's original channel, hiding the per-channel
// transport from callers (the reply route and the AI auto-reply both use this).
//
// V0.1 (Channel Independence): bu modül artık sağlayıcı istemcisini BİLMEZ.
// Rota (`resolveOutboundRoute`) ve gönderim (`dispatchOutbound`) Channel Layer'da;
// burası yalnız çağıranların alıştığı `SendOutcome` şekline çevirir. Davranış
// birebir: aynı istemci çağrısı, aynı argümanlar, aynı sonuç alanları.
// ---------------------------------------------------------------------------

export interface ChannelTarget {
  channel: string;
  guestIdentifier: string;
  externalReservationId?: string | null;
}

export interface SendOutcome {
  ok: boolean;
  /** True when there was nothing to deliver externally (manual/email thread). */
  skipped?: boolean;
  error?: string;
  /** The provider's id for the just-sent message, when it returned one. Persist
   *  it as the local Message.externalId so when the sync re-imports this same
   *  message from the channel thread it dedups (matches on externalId) instead
   *  of creating a duplicate outbound row attributed to "Ev sahibi". */
  providerMessageId?: string | null;
  /**
   * Typed outcome class from the adapter (V0.1, additive). Callers that still branch
   * on `error` text via isDefinitiveSendFailure keep working; new code can use this.
   */
  kind?: SendResultKind;
}

/**
 * Route an outbound reply to the right transport:
 *   - the registered provider adapter (today: Hospitable — Airbnb / Booking / ...)
 *     when the conversation carries an external destination,
 *   - otherwise a no-op (internal QR-concierge and manual threads have nothing to
 *     deliver — never POST a synthetic id to a provider).
 * The internal-thread rule (`qr-chat:` prefix) lives in ONE place:
 * `resolveOutboundRoute` (Channel Layer). Single-shot delivery is the adapter's
 * contract (POST /messages is non-idempotent; the caller owns the ambiguous outcome).
 */
export async function sendOnChannel(
  target: ChannelTarget,
  body: string,
  token?: string,
): Promise<SendOutcome> {
  const route = resolveOutboundRoute(target);
  if (route.kind === "local") return { ok: true, skipped: true };
  // Multi-tenant: the caller resolved THIS org's credential; it is forwarded as-is
  // (undefined included — the client's legacy env fallback; V0.3 moves credential
  // resolution behind a connection and can then fail closed here).
  const r = await dispatchOutbound(route.destination, body, { provider: route.destination.provider, token });
  return { ok: r.ok, error: r.error ?? undefined, providerMessageId: r.providerMessageId ?? null, kind: r.kind };
}

/**
 * Classify a FAILED send for the claim-then-send rollback decision. DEFINITIVE (the
 * provider rejected the request — HTTP 4xx EXCEPT 408 Request Timeout) means nothing
 * was delivered, so the caller may safely un-claim and retry the same body now.
 * Everything else — a timeout (incl. 408), a network drop, or a 5xx — is AMBIGUOUS:
 * the message MAY have reached the guest despite the error, so the caller MUST NOT
 * re-POST it (that would deliver a duplicate). SINGLE SOURCE OF TRUTH shared by the
 * manual-reply route and the proactive lifecycle senders (welcome/check-in/checkout)
 * so the two can never drift. Matches on the "HTTP <code>" that sendMessage surfaces
 * in `error`; a non-HTTP error (network/abort) has no 4xx and is treated as ambiguous.
 */
export function isDefinitiveSendFailure(error: string | null | undefined): boolean {
  // 🚨 İLK EŞLEŞME ALINIR, `.test()` KULLANILMAZ — GERİ ALMA.
  // `sendMessage` hatayı `"Hospitable API hatası (HTTP <status>): <gövde ilk 200>"`
  // biçiminde kuruyor, yani GERÇEK durum en başta, SAĞLAYICININ HAM GÖVDESİ hemen
  // arkasında. Konumdan bağımsız `.test()` gövdenin içindeki bir `HTTP 4xx`
  // metnini de yakalıyordu:
  //   · 5xx + gövdede "HTTP 404" → yanlışlıkla DEFINITIVE → çağıran claim'i geri
  //     alır → sonraki geçiş aynı mesajı yeniden gönderir → misafire ÇİFT MESAJ.
  //   · 4xx + gövdede "HTTP 408" → yanlışlıkla AMBIGUOUS → claim tutulur →
  //     karşılama/giriş/çıkış mesajı bir daha ASLA denenmez.
  // Kardeş okuyucular zaten ilk eşleşmeyi alıyor (`outbox/state.ts` `.match`,
  // `provider-errors.ts` `.exec`); üçü AYNI girdide aynı sonucu vermek ZORUNDA.
  const status = /HTTP (\d{3})/.exec(error ?? "")?.[1];
  if (!status) return false; // ağ/abort hatası → belirsiz
  return status.startsWith("4") && status !== "408";
}
