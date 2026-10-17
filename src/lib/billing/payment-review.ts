import "server-only";
import { prisma } from "@/lib/db";
import { NEEDS_REVIEW_PREFIX } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// ÖDEME İNCELEMESİ (yalnız operatör; kurucu 10-16 ödeme S1/S2 "hatayı GÖRÜNÜR kaydet", Opus F5). İncelemeye düşen ödeme olayı
// (`WebhookEvent` `status:"error"`, `error:"needs_review: <kod>"`) yalnız veritabanında duruyordu — alarm e-postası bir kez gelir, sonra
// görünmez. Bu okuma Operasyon Teşhisi'nde listeler: olay kimliği, tür, kod, zaman ve kodun GERÇEK eylemi. Ham yük (müşteri adı / e-posta /
// tutar) TAŞINMAZ. Paddle'dan yeniden gönderim aynı veriyi getirir; yalnız "bağlanamadı" (eylemden sonra) yeniden işlemede işe yarar.
// ---------------------------------------------------------------------------

export type PaymentReviewCode = "invalid_amount" | "missing_currency" | "unlinked" | "org_deleted" | "other";

/** Kodun operatör eylemi (Türkçe, operatöre). */
export const PAYMENT_REVIEW_ACTION: Record<PaymentReviewCode, string> = {
  invalid_amount: "Tutar okunamadı, fatura yazılmadı: Paddle panelinde işlemi kontrol edip faturayı elle kaydedin.",
  missing_currency: "Para birimi yok, fatura yazılmadı: Paddle panelinde işlemi kontrol edip faturayı elle kaydedin.",
  unlinked:
    "Ödeme hiçbir işletmeye bağlanamadı: müşteriyi bulup aboneliği bağlayın (bağladıktan sonra Paddle'dan olayı yeniden gönderin) ya da iadeyi değerlendirin.",
  org_deleted: "Hesap silinmiş: Paddle'da aboneliği iptal edin, son ödemeyi iade için değerlendirin.",
  other: "Bilinmeyen inceleme kodu: olayı Paddle panelinde kontrol edin.",
};

export interface PaymentReviewRow {
  providerEventId: string | null;
  eventType: string | null;
  code: PaymentReviewCode;
  createdAt: Date;
}

function codeOf(error: string | null): PaymentReviewCode {
  const raw = (error ?? "").slice(NEEDS_REVIEW_PREFIX.length).trim();
  return raw === "invalid_amount" || raw === "missing_currency" || raw === "unlinked" || raw === "org_deleted" ? raw : "other";
}

// ---------------------------------------------------------------------------
// PADDLE API ANAHTARI UYARISI (kurucu 10-17 "sakın unutmayalım"). Ödeme olayı DEĞİL → ödeme incelemesine düşmez (Haiku 10-17 gece 2. tur:
// "İncelemede N ödeme olayı · Bilinmeyen inceleme kodu" diye görünüyordu). Kalıcı iz: işlenmiş olay satırı (anahtarsız küçük gövde) →
// Operasyon Teşhisi'nde son 90 günün en yeni uyarısı ayrı satırda (uyarı e-postası kısılsa / düşse de görünür — Opus O18).
// ---------------------------------------------------------------------------

export const PADDLE_API_KEY_ALERT_EVENTS: readonly string[] = ["api_key.expiring", "api_key.expired", "api_key.revoked"];
const API_KEY_ALERT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export function paddleApiKeyAlertPhrase(eventType: string): string {
  return eventType === "api_key.expiring" ? "süresi yakında doluyor" : eventType === "api_key.expired" ? "süresi DOLDU" : "iptal edildi";
}

/** Olay verisinden yalnız ad + bitiş günü (anahtarın kendisi hiçbir yerde okunmaz). */
export function paddleApiKeyFacts(data: unknown): { name: string; expiresOn: string } {
  const d = (data && typeof data === "object" ? data : {}) as { name?: unknown; expires_at?: unknown };
  const name = typeof d.name === "string" && d.name.trim() !== "" ? d.name.trim().slice(0, 80) : "(adsız)";
  const expiresOn =
    typeof d.expires_at === "string" && !Number.isNaN(Date.parse(d.expires_at)) ? new Date(d.expires_at).toISOString().slice(0, 10) : "bilinmiyor";
  return { name, expiresOn };
}

/**
 * Saklanan gövde: anahtarın KENDİSİ (maskeli olsa da) veritabanına YAZILMAZ — yalnız olay kimliği / türü / zamanı ve anahtar kimliği / adı /
 * durumu / bitişi. `redactedAt` + `note` → yeniden teslimde ve 12 ay küçültmesinde "küçültülmüş" sayılır.
 */
export function minimalApiKeyPayload(event: { event_id?: unknown; event_type?: unknown; occurred_at?: unknown; data?: unknown } | null): string {
  const d = (event?.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : null);
  return JSON.stringify({
    event_id: pick(event?.event_id),
    event_type: pick(event?.event_type),
    occurred_at: pick(event?.occurred_at),
    data: { id: pick(d.id), name: pick(d.name), status: pick(d.status), expires_at: pick(d.expires_at) },
    redactedAt: new Date().toISOString(),
    note: "api-key",
  });
}

export interface PaddleApiKeyAlert {
  eventType: string;
  name: string;
  expiresOn: string;
  at: Date;
}

/** Son 90 günün en yeni API anahtarı uyarısı (yoksa null). */
export async function latestPaddleApiKeyAlert(now: Date = new Date()): Promise<PaddleApiKeyAlert | null> {
  const row = await prisma.webhookEvent.findFirst({
    where: {
      provider: "paddle",
      eventType: { in: [...PADDLE_API_KEY_ALERT_EVENTS] },
      createdAt: { gte: new Date(now.getTime() - API_KEY_ALERT_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { eventType: true, payloadJson: true, createdAt: true },
  });
  if (!row?.eventType) return null;
  let data: unknown = null;
  try {
    data = (JSON.parse(row.payloadJson ?? "null") as { data?: unknown } | null)?.data ?? null;
  } catch {
    data = null;
  }
  return { eventType: row.eventType, ...paddleApiKeyFacts(data), at: row.createdAt };
}

export async function paymentReviewSummary(limit = 20): Promise<{ total: number; rows: PaymentReviewRow[] }> {
  const where = { provider: "paddle", status: "error", error: { startsWith: NEEDS_REVIEW_PREFIX } };
  const [total, rows] = await Promise.all([
    prisma.webhookEvent.count({ where }),
    prisma.webhookEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { providerEventId: true, eventType: true, error: true, createdAt: true },
    }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({ providerEventId: r.providerEventId, eventType: r.eventType, code: codeOf(r.error), createdAt: r.createdAt })),
  };
}
