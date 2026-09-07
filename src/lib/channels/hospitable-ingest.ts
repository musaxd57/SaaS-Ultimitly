import "server-only";

import {
  HospitableError,
  listMessages as hospitableListMessages,
  listProperties as hospitableListProperties,
  listReservations as hospitableListReservations,
  type HospitableMessage,
  type HospitableReservation,
} from "@/lib/hospitable";
import {
  IngestError,
  canonicalDate,
  canonicalStr,
  type CanonicalMessage,
  type CanonicalProperty,
  type CanonicalReservation,
  type CanonicalReservationStatus,
  type IngestAdapter,
  type IngestCredential,
  type ReservationWindow,
} from "./ingest";

// ---------------------------------------------------------------------------
// HOSPITABLE INGEST ADAPTÖRÜ (V0.6) — sağlayıcı payload'ını canonical'a çevirir.
//
// `@/lib/hospitable` istemcisinin OKUMA fonksiyonlarının src/ içindeki TEK çağıranı
// bu dosyadır (outbound için `hospitable-outbound.ts` emsali; pin
// `core-channel-independence.test.ts`). Normalizasyon (`toChannel`,
// `mapReservationStatus`, `isTerminalStay`, `isGuestMessage`, `senderFullName`,
// `reservationGuestName`) hospitable-sync.ts'ten buraya taşındı — semantik BİREBİR
// (V0.6 davranış-koruyan; conformance kiti + hospitable-sync testleri pinler).
//
// Adaptör DEDUPE YAPMAZ, SIRALAMAZ, çıkarım yapmaz (sözleşme başlığı, ingest.ts).
// Hata: HospitableError.status → tipli IngestError.kind; metin token taşımaz.
// Kimlik bilgisi yoksa (token yok, env yok) ağa çıkılmaz.
// ---------------------------------------------------------------------------

const PROVIDER = "hospitable" as const;

/** Map a Hospitable platform string onto our channel label (hospitable-sync ile aynı). */
export function toChannel(platform: unknown): string {
  const p = String(platform ?? "").toLowerCase();
  if (p.includes("airbnb")) return "airbnb";
  if (p.includes("booking")) return "booking";
  if (p.includes("homeaway") || p.includes("vrbo")) return "vrbo";
  if (p === "direct" || p === "manual" || p === "website") return "direct";
  return p || "other";
}

export function mapReservationStatus(reservation: HospitableReservation): CanonicalReservationStatus {
  const rawStatus =
    `${reservation.status ?? ""} ${reservation.reservation_status?.current?.category ?? ""}`.toLowerCase();
  return rawStatus.includes("cancel") ||
    rawStatus.includes("declin") ||
    rawStatus.includes("expired") ||
    rawStatus.includes("not_possible") ||
    rawStatus.includes("denied")
    ? "cancelled"
    : rawStatus.includes("pending") || rawStatus.includes("request")
      ? "pending"
      : rawStatus.includes("complete") ||
          rawStatus.includes("checked_out") ||
          rawStatus.includes("past")
        ? "completed"
        : "confirmed";
}

/** A guest message is inbound; host/owner/automated messages are outbound. */
function isGuestMessage(m: HospitableMessage): boolean {
  const role = `${m.sender_type ?? ""} ${m.sender_role ?? ""}`.toLowerCase();
  return role.includes("guest");
}

function senderFullName(m: HospitableMessage): string | null {
  const sender = m.sender as { full_name?: string; first_name?: string } | undefined;
  return canonicalStr(sender?.full_name) ?? canonicalStr(sender?.first_name);
}

/** Guest name from the (included) reservation.guest record, if present. */
function reservationGuestName(reservation: HospitableReservation): string | null {
  const g = reservation.guest;
  if (!g) return null;
  const full = canonicalStr(g.full_name) ?? canonicalStr(g.name);
  if (full) return full;
  const composed = [canonicalStr(g.first_name), canonicalStr(g.last_name)].filter(Boolean).join(" ").trim();
  return composed.length ? composed : null;
}

export function normalizeReservation(r: HospitableReservation): CanonicalReservation {
  const status = mapReservationStatus(r);
  const g = r.guest;
  return {
    externalId: String(r.id),
    code: canonicalStr(r.code),
    channel: toChannel(r.platform),
    status,
    arrivalDate: canonicalDate(r.arrival_date) ?? canonicalDate(r.check_in),
    departureDate: canonicalDate(r.departure_date) ?? canonicalDate(r.check_out),
    guest: {
      // Falsy guard (not just != null): an empty-string id must never become a shared match key.
      externalId: g?.id ? String(g.id) : null,
      name: reservationGuestName(r),
      email: canonicalStr(g?.email),
      phone: canonicalStr(g?.phone),
    },
    totalAmount: typeof r.total_price === "number" ? r.total_price : null,
    currency: canonicalStr(r.currency),
    conversationExternalId: canonicalStr(r.conversation_id) ?? (r.conversation_id != null ? String(r.conversation_id) : null),
    conversationLanguage: canonicalStr(r.conversation_language),
    lastMessageAt: canonicalDate(r.last_message_at),
    terminal: status === "cancelled" || status === "completed",
  };
}

export function normalizeMessage(m: HospitableMessage): CanonicalMessage {
  return {
    externalId: m.id != null && String(m.id).length ? String(m.id) : null,
    direction: isGuestMessage(m) ? "inbound" : "outbound",
    senderName: senderFullName(m),
    body: canonicalStr(m.body),
    createdAt: canonicalDate(m.created_at),
  };
}

function toIngestError(err: unknown): IngestError {
  if (err instanceof IngestError) return err;
  if (err instanceof HospitableError) {
    const s = err.status;
    const kind =
      s === 401 || s === 403
        ? "auth_revoked"
        : s === 429
          ? "rate_limited"
          : s === 404
            ? "not_found"
            : s !== undefined && s >= 500
              ? "outage"
              : s === undefined
                ? "outage" // ağ / zaman aşımı (durum kodu yok)
                : "unknown";
    // Metin: yalnız sınıf + durum; sağlayıcı gövdesi ve token TAŞINMAZ.
    return new IngestError(PROVIDER, kind, `hospitable ingest ${kind}${s ? ` (HTTP ${s})` : ""}`, s, err.retryAfterSec);
  }
  return new IngestError(PROVIDER, "unknown", "hospitable ingest unknown error");
}

function requireCredential(credential: IngestCredential): void {
  // Kimlik bilgisi yoksa ağa çıkma (outbound V0.2 uyum kiti bulgusuyla aynı kural).
  if (!credential.token && !process.env.HOSPITABLE_API_TOKEN) {
    throw new IngestError(PROVIDER, "no_credential", "kimlik bilgisi yok — ağa çıkılmadı");
  }
}

export const hospitableIngestAdapter: IngestAdapter = {
  provider: PROVIDER,
  capabilities: new Set(["properties.read", "reservations.read", "messages.read"] as const),

  async listProperties(credential): Promise<CanonicalProperty[]> {
    requireCredential(credential);
    try {
      const props = await hospitableListProperties(credential.token);
      return props
        .filter((p) => Boolean(p.id))
        .map((p) => ({ externalId: String(p.id), name: canonicalStr(p.name) ?? canonicalStr(p.public_name) }));
    } catch (err) {
      throw toIngestError(err);
    }
  },

  async listReservations(credential, window: ReservationWindow): Promise<CanonicalReservation[]> {
    requireCredential(credential);
    try {
      const rows = await hospitableListReservations(
        { propertyIds: [window.propertyExternalId], startDate: window.startDate, endDate: window.endDate },
        credential.token,
      );
      // Kimliksiz satır canonical'a giremez (idempotency kapsamı kimlik ister); atlanır.
      return rows.filter((r) => r && r.id).map(normalizeReservation);
    } catch (err) {
      throw toIngestError(err);
    }
  },

  async listMessages(credential, reservationExternalId): Promise<CanonicalMessage[]> {
    requireCredential(credential);
    try {
      const rows = await hospitableListMessages(reservationExternalId, credential.token);
      return rows.map(normalizeMessage);
    } catch (err) {
      throw toIngestError(err);
    }
  },
};
