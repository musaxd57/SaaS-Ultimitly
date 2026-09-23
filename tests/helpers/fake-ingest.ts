import {
  IngestError,
  type CanonicalMessage,
  type CanonicalProperty,
  type CanonicalReservation,
  type IngestAdapter,
  type IngestCredential,
  type ReservationWindow,
} from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// ORTAK INGEST FAKE'İ (V0.6) — "sağlayıcı tarafını" modeller: hangi token hangi
// mülkü görür (kiracı sınırı), mülk başına rezervasyonlar, rezervasyon başına
// mesajlar, programlanmış hata modları, sayfalama, istek sayacı.
//
// 🚨 GERÇEKÇİLİK VARSAYIMLARI — gerçek Hospitable ingest adaptörüne karşı
// `tests/unit/ingest-adapter-conformance.test.ts` (fetch stub) ile pinli:
//   1. Sağlayıcı DEDUPE YAPMAZ: aynı rezervasyon/mesaj listede iki kez gelirse
//      adaptör ikisini de aktarır (tekilleştirme çekirdeğin işi).
//   2. Sağlayıcı SIRALAMAZ / sıra garanti etmez: mesajlar geldikleri sırayla
//      aktarılır; kronoloji çekirdeğin işi.
//   3. Kiracı sınırı: token'ın görmediği mülk → BOŞ liste (⚠️ canlıda
//      gözlenmedi; stub varsayımı — adaptör ne dönerse onu aktarır).
//   4. 401/403 → auth_revoked · 402 → blocked (abonelik pasif; 09-23'e kadar
//      gerçek adaptör onu `unknown`a atıyordu) · 429 → rate_limited · 5xx/ağ →
//      outage · 404 → not_found; kimlik bilgisi yoksa ağa çıkılmaz → no_credential.
//   5. Sayfalar birleştirilir (gerçek istemci `meta.last_page`/`links.next`).
//   6. Gövdesiz mesaj body=null olarak aktarılır (çekirdek sayar, atlar).
//   7. Hata metni token taşımaz.
// ---------------------------------------------------------------------------

export type FakeIngestBehaviour =
  | { mode: "ok" }
  | { mode: "reject"; status: 401 | 402 | 403 | 404 }
  | { mode: "rate_limit"; retryAfterSec: number }
  | { mode: "outage"; status?: 500 | 503 }
  | { mode: "network" };

export interface RawFakeReservation extends Omit<CanonicalReservation, "guest"> {
  guest: CanonicalReservation["guest"];
}

export class FakeIngestProvider {
  /** token → görebildiği mülk id'leri (kiracı sınırı). */
  private access = new Map<string, Set<string>>();
  private properties = new Map<string, CanonicalProperty>();
  private reservationsByProperty = new Map<string, CanonicalReservation[]>();
  private messagesByReservation = new Map<string, CanonicalMessage[]>();
  private behaviour: FakeIngestBehaviour = { mode: "ok" };
  readonly requests: { op: string; token: string | undefined; arg?: string }[] = [];

  reset(): void {
    this.access.clear();
    this.properties.clear();
    this.reservationsByProperty.clear();
    this.messagesByReservation.clear();
    this.behaviour = { mode: "ok" };
    this.requests.length = 0;
  }

  behave(b: FakeIngestBehaviour): void {
    this.behaviour = b;
  }

  /** Mülkü kaydet ve token'a görünür yap. */
  addProperty(token: string, externalId: string, name: string | null = null): void {
    this.properties.set(externalId, { externalId, name });
    if (!this.access.has(token)) this.access.set(token, new Set());
    this.access.get(token)!.add(externalId);
  }

  /** Rezervasyonu mülke ekle — listedeki sıra ve tekrarlar AYNEN korunur (varsayım 1–2). */
  addReservation(propertyExternalId: string, r: CanonicalReservation): void {
    const list = this.reservationsByProperty.get(propertyExternalId) ?? [];
    list.push(r);
    this.reservationsByProperty.set(propertyExternalId, list);
  }

  setReservations(propertyExternalId: string, rs: CanonicalReservation[]): void {
    this.reservationsByProperty.set(propertyExternalId, [...rs]);
  }

  setMessages(reservationExternalId: string, ms: CanonicalMessage[]): void {
    this.messagesByReservation.set(reservationExternalId, [...ms]);
  }

  lastToken(): string | undefined {
    return this.requests[this.requests.length - 1]?.token;
  }

  private gate(op: string, cred: IngestCredential, arg?: string): void {
    if (!cred.token && !process.env.HOSPITABLE_API_TOKEN) {
      throw new IngestError(cred.provider, "no_credential", "kimlik bilgisi yok — ağa çıkılmadı");
    }
    this.requests.push({ op, token: cred.token, arg });
    const b = this.behaviour;
    switch (b.mode) {
      case "ok":
        return;
      case "reject":
        throw new IngestError(
          cred.provider,
          b.status === 404 ? "not_found" : b.status === 402 ? "blocked" : "auth_revoked",
          `sağlayıcı reddetti (HTTP ${b.status})`,
          b.status,
        );
      case "rate_limit":
        throw new IngestError(cred.provider, "rate_limited", "hız sınırı (HTTP 429)", 429, b.retryAfterSec);
      case "outage":
        throw new IngestError(cred.provider, "outage", `sağlayıcı arızası (HTTP ${b.status ?? 503})`, b.status ?? 503);
      case "network":
        throw new IngestError(cred.provider, "outage", "sağlayıcıya ulaşılamadı");
    }
  }

  private visible(cred: IngestCredential): Set<string> {
    const token = cred.token ?? process.env.HOSPITABLE_API_TOKEN ?? "";
    return this.access.get(token) ?? new Set();
  }

  adapter(): IngestAdapter {
    const provider = "hospitable" as const;
    return {
      provider,
      capabilities: new Set(["properties.read", "reservations.read", "messages.read"] as const),
      listProperties: async (cred) => {
        this.gate("properties", cred);
        return [...this.visible(cred)].map((id) => this.properties.get(id)!).filter(Boolean);
      },
      listReservations: async (cred, w: ReservationWindow) => {
        this.gate("reservations", cred, w.propertyExternalId);
        if (!this.visible(cred).has(w.propertyExternalId)) return []; // varsayım 3
        return [...(this.reservationsByProperty.get(w.propertyExternalId) ?? [])];
      },
      listMessages: async (cred, reservationExternalId) => {
        this.gate("messages", cred, reservationExternalId);
        return [...(this.messagesByReservation.get(reservationExternalId) ?? [])];
      },
    };
  }
}

/** Kısa fikstür yardımcıları. */
export function canonicalReservation(over: Partial<CanonicalReservation> & { externalId: string }): CanonicalReservation {
  return {
    code: null,
    channel: "airbnb",
    status: "confirmed",
    arrivalDate: new Date("2026-06-01T00:00:00Z"),
    departureDate: new Date("2026-06-05T00:00:00Z"),
    guest: { externalId: "g-1", name: "Alex Guest", email: null, phone: null },
    totalAmount: null,
    currency: null,
    conversationExternalId: null,
    conversationLanguage: null,
    lastMessageAt: null,
    terminal: false,
    ...over,
  };
}

export function canonicalMessage(over: Partial<CanonicalMessage> & { externalId: string | null }): CanonicalMessage {
  return {
    direction: "inbound",
    senderName: "Alex Guest",
    body: `mesaj ${over.externalId ?? "?"}`,
    createdAt: new Date("2026-05-30T09:00:00Z"),
    ...over,
  };
}
