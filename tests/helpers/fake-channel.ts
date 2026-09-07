import type { OutboundAdapter, OutboundCredential, OutboundDestination, OutboundSendResult } from "@/lib/channels";

// ---------------------------------------------------------------------------
// ORTAK SAĞLAYICI FAKE'İ — Channel Layer için (V0.2)
//
// "Sağlayıcı tarafını" modeller: kiracı sahipliği (hangi token hangi
// rezervasyonu görebilir), teslim edilen mesajlar, deneme sayısı ve programlanmış
// hata modları. `adapter()` bunu `OutboundAdapter` sözleşmesine sarar; testler
// `__setOutboundAdapterForTest("hospitable", fake.adapter())` ile takar.
//
// 🚨 GERÇEKÇİLİK VARSAYIMLARI — hepsi gerçek Hospitable adaptörüne karşı
// `tests/unit/outbound-adapter-conformance.test.ts` ile pinli; fake gerçekten
// saparsa o dosya kırmızı olur:
//   1. Sağlayıcı DEDUPE YAPMAZ: aynı gövde iki kez gönderilirse misafire iki kez
//      ulaşır (POST /messages idempotent değil). Tekilleştirme BİZİM işimiz
//      (outbox idempotencyKey, claim-then-send).
//   2. Sahipsiz/bilinmeyen rezervasyon → 404 → definitive_failure (token'ın
//      hesabı o rezervasyonu göremez). Kiracı sınırı sağlayıcıda da vardır.
//   3. 401/403 → auth_revoked (V0.3): kimlik bilgisi reddedildi; deneme tüketilmez,
//      satır bekler, bağlantı yaşam döngüsü (PAT: revoked+disconnect, OAuth: refresh).
//   4. 429 → rate_limited + Retry-After · 402 → blocked · 5xx/408/ağ → ambiguous.
//   5. Zaman aşımı TESLİM ANLAMINA GELEBİLİR (POST vardı, yanıt kayboldu):
//      `timeout(delivered:true)` mesajı teslim listesine yazar VE ambiguous döner.
//      Belirsiz sonuç ASLA kör yeniden gönderilmez — çekirdeğin kanıtlaması gereken
//      şey tam olarak budur.
//   6. Kimlik bilgisi yoksa ağa çıkılmaz → definitive_failure (deneme sayılmaz).
//   7. Hata metni kimlik bilgisini TAŞIMAZ.
// ---------------------------------------------------------------------------

export type FakeBehaviour =
  | { mode: "succeed" }
  | { mode: "reject"; status: 400 | 401 | 403 | 404 | 422 }
  | { mode: "rate_limit"; retryAfterSec: number }
  | { mode: "blocked" }
  | { mode: "outage"; status?: 500 | 502 | 503 }
  | { mode: "status_408" }
  | { mode: "timeout"; delivered: boolean };

export interface FakeDelivery {
  destination: string;
  body: string;
  token: string;
  providerMessageId: string;
}

export interface FakeAttempt {
  destination: string;
  body: string;
  token: string | undefined;
}

const NO_STATUS_ERROR = "Hospitable'a ulaşılamadı: The operation was aborted due to timeout";

export class FakeOutboundProvider {
  /** Rezervasyon → sahibi olan token (kiracı sınırı). */
  private owners = new Map<string, string>();
  private defaultBehaviour: FakeBehaviour = { mode: "succeed" };
  private perDestination = new Map<string, FakeBehaviour>();
  private seq = 0;
  /** Misafire GERÇEKTEN ulaşan mesajlar (sağlayıcı tarafı gerçeği). */
  readonly deliveries: FakeDelivery[] = [];
  /** Sağlayıcıya ulaşan denemeler (ağ çağrıları). */
  readonly attempts: FakeAttempt[] = [];

  registerReservation(externalReservationId: string, ownerToken: string): void {
    this.owners.set(externalReservationId, ownerToken);
  }

  /** Genel ya da hedef-özel davranış programla. */
  behave(b: FakeBehaviour, destination?: string): void {
    if (destination) this.perDestination.set(destination, b);
    else this.defaultBehaviour = b;
  }

  reset(): void {
    this.owners.clear();
    this.perDestination.clear();
    this.defaultBehaviour = { mode: "succeed" };
    this.deliveries.length = 0;
    this.attempts.length = 0;
    this.seq = 0;
  }

  /** Bu token'ın gördüğü son Authorization değeri (uyum kiti için). */
  lastToken(): string | undefined {
    return this.attempts.at(-1)?.token;
  }

  private deliver(destination: string, body: string, token: string): string {
    const providerMessageId = `fake-msg-${++this.seq}`;
    this.deliveries.push({ destination, body, token, providerMessageId });
    return providerMessageId;
  }

  /** Sağlayıcı tarafı: bir HTTP isteğinin sonucu. */
  private handle(destination: string, body: string, token: string): OutboundSendResult {
    const owner = this.owners.get(destination);
    // Bilinmeyen ya da başka hesabın rezervasyonu → Hospitable 404 (görünmez).
    if (owner === undefined || owner !== token) {
      return { ok: false, kind: "definitive_failure", error: `Hospitable API hatası (HTTP 404): {"message":"Reservation not found"}`, providerMessageId: null, retryAfterSec: null };
    }
    const b = this.perDestination.get(destination) ?? this.defaultBehaviour;
    switch (b.mode) {
      case "succeed":
        return { ok: true, kind: "definitive_success", error: null, providerMessageId: this.deliver(destination, body, token), retryAfterSec: null };
      case "reject":
        return {
          ok: false,
          // Varsayım 3 (V0.3): 401/403 = kimlik bilgisi reddedildi → bağlantı yaşam döngüsü olayı.
          kind: b.status === 401 || b.status === 403 ? "auth_revoked" : "definitive_failure",
          error: `Hospitable API hatası (HTTP ${b.status}): {"message":"rejected"}`,
          providerMessageId: null,
          retryAfterSec: null,
        };
      case "rate_limit":
        return { ok: false, kind: "rate_limited", error: `Hospitable API hatası (HTTP 429): {"message":"Too Many Attempts"}`, providerMessageId: null, retryAfterSec: b.retryAfterSec };
      case "blocked":
        return { ok: false, kind: "blocked", error: `Hospitable API hatası (HTTP 402): {"message":"Subscription not active"}`, providerMessageId: null, retryAfterSec: null };
      case "outage":
        return { ok: false, kind: "ambiguous", error: `Hospitable API hatası (HTTP ${b.status ?? 503}): {"message":"Service Unavailable"}`, providerMessageId: null, retryAfterSec: null };
      case "status_408":
        return { ok: false, kind: "ambiguous", error: `Hospitable API hatası (HTTP 408): {"message":"Request Timeout"}`, providerMessageId: null, retryAfterSec: null };
      case "timeout":
        if (b.delivered) this.deliver(destination, body, token); // POST vardı, yanıt kayboldu
        return { ok: false, kind: "ambiguous", error: NO_STATUS_ERROR, providerMessageId: null, retryAfterSec: null };
    }
  }

  /** `OutboundAdapter` sözleşmesine sarılmış fake. Asla fırlatmaz. */
  adapter(): OutboundAdapter {
    return {
      provider: "hospitable",
      capabilities: new Set<"messages.send">(["messages.send"]),
      send: async (destination: OutboundDestination, body: string, credential: OutboundCredential): Promise<OutboundSendResult> => {
        // Varsayım 6: kimlik bilgisi yoksa ağa çıkılmaz.
        if (!credential.token) {
          return { ok: false, kind: "definitive_failure", error: "no credential for provider hospitable (nothing sent)", providerMessageId: null, retryAfterSec: null };
        }
        this.attempts.push({ destination: destination.externalReservationId, body, token: credential.token });
        return this.handle(destination.externalReservationId, body, credential.token);
      },
    };
  }
}
