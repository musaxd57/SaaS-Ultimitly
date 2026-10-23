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
  type GuestParty,
  type IngestAdapter,
  type IngestCredential,
  type IngestErrorKind,
  type ReservationWindow,
  sourcePlatformOf,
} from "./ingest";
import type { ChannelSenderRole } from "@/lib/message-author";

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

/**
 * 🚨 Bilinmeyen durum bugün "confirmed" sayılır (V0.6 semantiği, BİLİNÇLİ korunuyor — gerçek durum sözlüğü canlı veriden doğrulanmadan
 * varsayılanı değiştirmek onaylı misafirlerin giriş mesajını durdurabilir; karar: `docs/SABAH-KARARLARI-2026-09-28.md` K7). Ama AÇIKÇA
 * olumsuz / soru değerleri onaylı sayılmaz (09-27 güvenlik denetimi: "not accepted" reddedilmiş talep, boşluklu "not possible" ve
 * "inquiry" "confirmed" oluyordu → sır kapısı açılıyor, modelsiz giriş bilgisi mesajı kapı koduyla gidebiliyordu).
 */
export function mapReservationStatus(reservation: HospitableReservation): CanonicalReservationStatus {
  const rawStatus =
    `${reservation.status ?? ""} ${reservation.reservation_status?.current?.category ?? ""}`.toLowerCase();
  return rawStatus.includes("cancel") ||
    rawStatus.includes("declin") ||
    rawStatus.includes("expired") ||
    rawStatus.includes("not_possible") ||
    rawStatus.includes("not possible") ||
    rawStatus.includes("not accept") ||
    rawStatus.includes("not_accept") ||
    rawStatus.includes("denied")
    ? "cancelled"
    : rawStatus.includes("pending") || rawStatus.includes("request") || rawStatus.includes("inquir")
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

/*
 * L5 (kurucu 10-17): GÖNDEREN ROLÜ — sağlayıcının kendi otomasyonu (şablon / zamanlanmış mesaj / sağlayıcı yapay zekâsı) insan ev sahibinden
 * AYRILIR. ⚠️ Sağlayıcı alan değerleri canlı hesapta DOĞRULANMADI (belge bu ortamdan açılamıyor; kurucu org 402): eşleme yalnız AÇIK işarete
 * bakar — alan yoksa NULL (bugünkü davranış), tanınmayan değer "unknown" (okuyucular bugünkü gibi ev sahibi sayar; yalnız kesin otomasyon
 * ayrılır). Değer kümeleri kesin eşitlik (alt dize değil): "ai" ya da "bot" bir rol adının İÇİNDE geçince otomasyon sanılmaz.
 * Doğrulama adımı: canlı hesapta `GET /api/hospitable/diagnostics` → `messages.senderFields` (değer sıklığı + eşleme sonucu) ve
 * `channelSenderRoles` (saklanan rol dağılımı) okunur; bir şablon mesajı gönderilip satırı bulunur → kümeler güncellenir.
 */
const AUTOMATION_ROLE_VALUES: ReadonlySet<string> = new Set([
  "automation",
  "automated",
  "automatic",
  "auto",
  "autopilot",
  "scheduled",
  "system",
  "bot",
  "ai",
]);
const HUMAN_HOST_ROLE_VALUES: ReadonlySet<string> = new Set([
  "host",
  "co_host",
  "co-host",
  "cohost",
  "teammate",
  "team_member",
  "owner",
  "manager",
  "property_manager",
]);

/** Alan VAR ama metin değil (dizi / sayı / nesne) — tanınmayan biçim: rol "unknown" olur, sessizce "yok" sayılmaz (Haiku 10-17). */
const ODD_VALUE = Symbol("odd");
function roleToken(v: unknown): string | null | typeof ODD_VALUE {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() ? v.trim().toLowerCase() : null;
  return ODD_VALUE;
}
/** Otomasyon bayrağı: gerçek `true`, metin "true" ya da 1 (sağlayıcı biçimi doğrulanmadı — açık işaretin bütün biçimleri). */
function flagSet(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === "string" && v.trim().toLowerCase() === "true");
}

export function senderRoleOf(m: HospitableMessage): ChannelSenderRole | null {
  if (isGuestMessage(m)) return "guest";
  const tokens = [roleToken(m.sender_type), roleToken(m.sender_role)].filter((v) => v !== null);
  const roles = tokens.filter((v): v is string => typeof v === "string");
  const source = roleToken(m.source);
  if (
    flagSet(m.automated) ||
    flagSet(m.is_automated) ||
    roles.some((r) => AUTOMATION_ROLE_VALUES.has(r)) ||
    (typeof source === "string" && AUTOMATION_ROLE_VALUES.has(source))
  ) {
    return "automation";
  }
  if (!tokens.length) return null;
  return roles.length === tokens.length && roles.every((r) => HUMAN_HOST_ROLE_VALUES.has(r)) ? "host" : "unknown";
}

/**
 * Tanılama (yalnız ALAN DEĞERİ sayımı — mesaj metni / ad YOK): gönderen alanlarının değer sıklığı + bizim eşlememizin sonucu. Canlı hesapta
 * sağlayıcının otomasyonu nasıl işaretlediği buradan okunur ve kümeler güncellenir (L5 doğrulama adımı). Değer kısa bir etiket değilse
 * "(diğer)" yazılır (serbest metin sızmasın).
 */
export function senderFieldCensus(messages: readonly HospitableMessage[]): Record<string, number> {
  const label = (v: unknown): string => {
    if (v === undefined || v === null) return "(yok)";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") return /^[A-Za-z0-9 _.-]{1,40}$/.test(v.trim()) ? v.trim().toLowerCase() : v.trim() ? "(diğer)" : "(boş)";
    return `(${Array.isArray(v) ? "dizi" : typeof v})`;
  };
  const out: Record<string, number> = {};
  for (const m of messages) {
    const key = [
      `sender_type=${label(m.sender_type)}`,
      `sender_role=${label(m.sender_role)}`,
      `source=${label(m.source)}`,
      `automated=${label(m.automated ?? m.is_automated)}`,
      `→ ${senderRoleOf(m) ?? "null"}`,
    ].join(" · ");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
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
      // Hitap adı YALNIZ sağlayıcının ayrı `first_name` alanından (K10-o, 09-28); tam addan bölünerek üretilmez.
      givenName: canonicalStr(g?.first_name),
      email: canonicalStr(g?.email),
      phone: canonicalStr(g?.phone),
    },
    totalAmount: typeof r.total_price === "number" ? r.total_price : null,
    currency: canonicalStr(r.currency),
    conversationExternalId: canonicalStr(r.conversation_id) ?? (r.conversation_id != null ? String(r.conversation_id) : null),
    conversationLanguage: canonicalStr(r.conversation_language),
    lastMessageAt: canonicalDate(r.last_message_at),
    terminal: status === "cancelled" || status === "completed",
    sourcePlatform: sourcePlatformOf(r.platform),
    // Kişi sayıları (migration 86): alan adları gerçek veriyle doğrulanana kadar YAZILMAZ (kurucu: "doğrulayamazsam boş kalır, uydurma yok").
    ...(hospitableGuestCountsEnabled() ? { party: guestPartyOf(r) } : {}),
  };
}

/** Yalnız tam "1" açar. Açmadan önce `scripts/diagnose-hospitable-guest-fields.ts` ile alan ADLARI gerçek yanıtta doğrulanır. */
export function hospitableGuestCountsEnabled(): boolean {
  return process.env.HOSPITABLE_GUEST_COUNTS_ENABLED === "1";
}

/** 0–99 arası tam sayı; başka her şey bilinmiyor (null). */
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99 ? v : null;
}

/**
 * Hospitable rezervasyonunun `guests` nesnesinden sayılar (`adult_count` / `child_count` / `infant_count` / `pet_count`). Nesne ya da alan
 * yoksa / biçimi bozuksa o alan null. Hiçbiri bilinmiyorsa null (yazılacak bir şey yok). Saf.
 */
export function guestPartyOf(r: HospitableReservation): GuestParty | null {
  const g = (r as { guests?: unknown }).guests;
  if (!g || typeof g !== "object") return null;
  const o = g as Record<string, unknown>;
  const party: GuestParty = { adults: count(o.adult_count), children: count(o.child_count), infants: count(o.infant_count), pets: count(o.pet_count) };
  return Object.values(party).some((v) => v !== null) ? party : null;
}

export function normalizeMessage(m: HospitableMessage): CanonicalMessage {
  return {
    externalId: m.id != null && String(m.id).length ? String(m.id) : null,
    direction: isGuestMessage(m) ? "inbound" : "outbound",
    senderName: senderFullName(m),
    body: canonicalStr(m.body),
    createdAt: canonicalDate(m.created_at),
    senderRole: senderRoleOf(m),
  };
}

/**
 * HTTP durumu → tipli sınıf. Giden yöndeki `classifyHospitableOutcome` ile AYNI
 * sözlük (402 iki yönde de `blocked`). 09-23'e kadar 402 burada `unknown`a
 * düşüyordu ve "beklenen durum, alarm verme" dalı her çağıranda ölüydü.
 */
function ingestKindFor(s: number | undefined): IngestErrorKind {
  if (s === undefined) return "outage"; // ağ / zaman aşımı (durum kodu yok)
  if (s === 401 || s === 403) return "auth_revoked";
  if (s === 402) return "blocked"; // abonelik pasif — KALICI, org'un kendi faturası
  if (s === 429) return "rate_limited";
  if (s === 404) return "not_found";
  if (s >= 500) return "outage";
  return "unknown";
}

function toIngestError(err: unknown): IngestError {
  if (err instanceof IngestError) return err;
  if (err instanceof HospitableError) {
    const s = err.status;
    const kind = ingestKindFor(s);
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
