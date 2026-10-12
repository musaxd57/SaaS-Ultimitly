import "server-only";

import { prisma } from "@/lib/db";
import { formatErrorForLog, redactSensitive } from "@/lib/redact";
import { currentCorrelation, isCorrelationId, isShortCorrelationId, newCorrelationId } from "@/lib/correlation";

// ---------------------------------------------------------------------------
// KALICI, YALNIZ-EKLE OLAY GÜNLÜĞÜ (kurucu kararı 10-10 §5: "güvenlik olarak çok gelişmiş olmalıyız, unutma"). TEK yazıcı `logEvent`.
//  · Ne yazılır: her istek DEĞİL — yalnız anlamlı olaylar (ödeme zinciri adımları, hatalar). Olay adı KAPALI KÜME; ek alanlar yalnız
//    izinli anahtarlardan ve yalnız kimlik / kod / sayı / mantıksal biçiminde (serbest metin, e-posta, ad, telefon, parola, jeton YAZILAMAZ —
//    biçime uymayan değer düşer, düşen alan sayısı `_dropped` olarak kalır).
//  · Bütünlük: uygulama yalnız EKLER; veritabanı tetikleyicisi UPDATE'i reddeder (migration 63). Silme yalnız saklama süpürgesi
//    (`pruneOperationalEvents`, 90 gün) ve hesap silme (işletmeye bağlı satırlar kademeli silinir).
//  · Hacim: işletme başına dakikada 120, sistem olayları (işletmesiz) dakikada 600 satır — tavan aşılınca satır yazılmaz (log seli tabloyu
//    şişirmesin). Satır başı veri 2.000 karakter.
//  · Asla fırlatmaz: günlük yazılamaması ödemeyi / isteği bozmaz.
//  · Okuma yalnız operatör ekranından (`api/admin/events`; süper-admin + 2FA, bürünmede yasak, denetim kaydı, hız sınırı).
// ---------------------------------------------------------------------------

/** Olay adı → seviye (kapalı küme; yeni olay buraya eklenmeden yazılamaz). */
export const OPERATIONAL_EVENTS = {
  "request.failed": "error",
  "error.reported": "error",
  "billing.consent.created": "info",
  "billing.checkout.pending": "info",
  "billing.webhook.received": "info",
  "billing.webhook.duplicate": "info",
  "billing.webhook.processed": "info",
  "billing.webhook.failed": "error",
  "billing.webhook.unlinked": "warn",
  "billing.subscription.applied": "info",
  "billing.invoice.recorded": "info",
  "billing.paddle.request": "info",
  "billing.paddle.request_failed": "warn",
} as const;
export type OperationalEventName = keyof typeof OPERATIONAL_EVENTS;

type ValueKind = "id" | "code" | "number" | "boolean";
/** İzinli veri anahtarları ve biçimleri. Kimlik / kod biçimi boşluk, "@", "+" taşımaz → e-posta / ad / telefon / cümle sığmaz. */
const DATA_KEYS: Record<string, ValueKind> = {
  context: "code",
  plan: "code",
  status: "code",
  eventType: "code",
  reason: "code",
  resource: "code",
  method: "code",
  providerCode: "code",
  currency: "code",
  consentId: "id",
  providerEventId: "id",
  subscriptionRef: "id",
  transactionRef: "id",
  providerRequestId: "id",
  httpStatus: "number",
  amountMinor: "number",
  count: "number",
};
const ID_SHAPE = /^[A-Za-z0-9_:.-]{1,80}$/;
const CODE_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_DATA_CHARS = 2_000;

export type EventData = Partial<Record<keyof typeof DATA_KEYS, string | number | boolean | null | undefined>>;

/** İzinli anahtar + biçim süzgeci (saf; testte doğrudan sınanır). Biçime uymayan değer DÜŞER; düşen sayısı `_dropped`. */
export function sanitizeEventData(data: Record<string, unknown> | undefined): Record<string, string | number | boolean> | null {
  if (!data) return null;
  const out: Record<string, string | number | boolean> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const kind = DATA_KEYS[key];
    let ok = false;
    if (kind === "number") ok = typeof value === "number" && Number.isSafeInteger(value);
    else if (kind === "boolean") ok = typeof value === "boolean";
    else if (kind === "id" || kind === "code") {
      ok = typeof value === "string" && (kind === "id" ? ID_SHAPE : CODE_SHAPE).test(value) && redactSensitive(value) === value;
    }
    if (ok) out[key] = value as string | number | boolean;
    else dropped++;
  }
  if (dropped > 0) out._dropped = dropped;
  return Object.keys(out).length > 0 ? out : null;
}

// Dakikalık yazma tavanı (süreç içi; tek kopya çalışıyoruz — yatay ölçekte kopya başına).
const WINDOW_MS = 60_000;
const ORG_PER_MINUTE = 120;
const SYSTEM_PER_MINUTE = 600;
const windows = new Map<string, { start: number; count: number }>();

function underCap(organizationId: string | null, now: number): boolean {
  const key = organizationId ?? "__system";
  const cap = organizationId ? ORG_PER_MINUTE : SYSTEM_PER_MINUTE;
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    if (windows.size > 5_000) windows.clear(); // bellek tavanı
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  if (w.count >= cap) return false;
  w.count++;
  return true;
}

/** Yalnız test: dakikalık tavanı sıfırla. */
export function __resetEventLogLimits(): void {
  windows.clear();
}

/**
 * Olay yaz (asla fırlatmaz). Takip numarası: verilen > süren işlemin numarası > yeni numara. İşletme: verilen > süren işlemin işletmesi.
 * Döner: yazılan satırın takip numarası (yazılamadıysa da numara döner — ekranda gösterilen numara ile aynı kalır).
 */
export async function logEvent(
  event: OperationalEventName,
  data?: EventData,
  opts: { organizationId?: string | null; correlationId?: string } = {},
): Promise<string> {
  const ctx = currentCorrelation();
  const correlationId = opts.correlationId && isCorrelationId(opts.correlationId) ? opts.correlationId : (ctx?.id ?? newCorrelationId());
  try {
    const level = OPERATIONAL_EVENTS[event];
    if (!level) return correlationId;
    const organizationId = opts.organizationId !== undefined ? opts.organizationId : (ctx?.organizationId ?? null);
    if (!underCap(organizationId, Date.now())) return correlationId;
    const clean = sanitizeEventData(data as Record<string, unknown> | undefined);
    const dataJson = clean ? JSON.stringify(clean).slice(0, MAX_DATA_CHARS) : null;
    await prisma.operationalEvent.create({ data: { correlationId, organizationId, event, level, dataJson } });
  } catch (err) {
    // Günlük yazılamadı (ör. işletme az önce silindi → yabancı anahtar). İsteği bozmaz; yalnız konsol (döngü olmasın diye reportError YOK).
    console.warn(`[event-log] ${event} yazılamadı: ${formatErrorForLog(err, 200)}`);
  }
  return correlationId;
}

/** Saklama süresi (gün) — kurucu kararı 10-10 §5 "öneri 90 gün"; ödeme olaylarının muhasebe süresi ayrı karar (faturalar `Invoice`ta kalır). */
export const EVENT_LOG_RETENTION_DAYS = 90;

/** Saklama süpürgesi: süresi dolan satırları sil (saatlik derin geçişte). Döner: silinen satır sayısı. */
export async function pruneOperationalEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EVENT_LOG_RETENTION_DAYS * 86_400_000);
  const res = await prisma.operationalEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}

export interface EventView {
  at: string;
  event: string;
  level: string;
  correlationId: string;
  organizationId: string | null;
  data: Record<string, unknown> | null;
}

/** Operatör araması: tam numara ya da ekrandaki 8 karakterlik kısa numara. Geçersiz biçim → null (arama yapılmaz). */
export async function findEventsByCorrelation(query: string): Promise<{ events: EventView[]; consents: Array<{ id: string; organizationId: string; planCode: string; at: string }> } | null> {
  const q = query.trim().toLowerCase();
  const exact = isCorrelationId(q);
  if (!exact && !isShortCorrelationId(q)) return null;
  const where = exact ? { correlationId: q } : { correlationId: { startsWith: q } };
  const [rows, consents] = await Promise.all([
    prisma.operationalEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500 }),
    prisma.checkoutConsent.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, organizationId: true, planCode: true, createdAt: true },
    }),
  ]);
  return {
    events: rows.map((r) => {
      let data: Record<string, unknown> | null = null;
      try {
        data = r.dataJson ? (JSON.parse(r.dataJson) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      return { at: r.createdAt.toISOString(), event: r.event, level: r.level, correlationId: r.correlationId, organizationId: r.organizationId, data };
    }),
    consents: consents.map((c) => ({ id: c.id, organizationId: c.organizationId, planCode: c.planCode, at: c.createdAt.toISOString() })),
  };
}
