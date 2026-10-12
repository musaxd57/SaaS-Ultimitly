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

/**
 * İzinli veri anahtarları → değer biçimi. Kimlikler ANAHTAR BAŞINA kalıpla (Paddle `sub_` / `txn_` / `evt_`, onay kaydı cuid, istek kimliği
 * onaltılık); kodlar kısa kod biçimi. Hiçbir metin değerinde boşluk, "@", "+" ya da 7+ haneli rakam dizisi olamaz → e-posta, ad soyad,
 * telefon, TC kimlik numarası, cümle SIĞMAZ (Haiku güvenlik incelemesi 10-12: tek biçim kuralı rakam dizisini ve "Ayse-Yilmaz"ı geçiriyordu).
 */
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DATA_KEYS: Record<string, RegExp | "number" | "boolean"> = {
  context: CODE,
  plan: CODE,
  status: CODE,
  eventType: CODE,
  reason: CODE,
  resource: CODE,
  method: /^[A-Z]{3,7}$/,
  providerCode: CODE,
  currency: /^[A-Z]{3}$/,
  consentId: /^c[a-z0-9]{7,40}$/,
  providerEventId: /^evt_[A-Za-z0-9_]{1,64}$/,
  subscriptionRef: /^sub_[A-Za-z0-9_]{1,64}$/,
  transactionRef: /^txn_[A-Za-z0-9_]{1,64}$/,
  providerRequestId: /^[0-9a-f-]{8,64}$/,
  httpStatus: "number",
  amountMinor: "number",
  count: "number",
};
const LONG_DIGITS = /\d{7,}/;
const MAX_DATA_CHARS = 2_000;

export type EventData = Partial<Record<keyof typeof DATA_KEYS, string | number | boolean | null | undefined>>;

/** İzinli anahtar + biçim süzgeci (saf; testte doğrudan sınanır). Biçime uymayan değer DÜŞER; düşen sayısı `_dropped`. */
export function sanitizeEventData(data: Record<string, unknown> | undefined): Record<string, string | number | boolean> | null {
  if (!data) return null;
  const out: Record<string, string | number | boolean> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const kind = Object.hasOwn(DATA_KEYS, key) ? DATA_KEYS[key] : undefined;
    let ok = false;
    if (kind === "number") ok = typeof value === "number" && Number.isSafeInteger(value);
    else if (kind === "boolean") ok = typeof value === "boolean";
    else if (kind instanceof RegExp) {
      ok = typeof value === "string" && kind.test(value) && !LONG_DIGITS.test(value) && redactSensitive(value) === value;
    }
    if (ok) out[key] = value as string | number | boolean;
    else dropped++;
  }
  if (dropped > 0) out._dropped = dropped;
  return Object.keys(out).length > 0 ? out : null;
}

// Dakikalık yazma tavanı (süreç içi; tek kopya çalışıyoruz — yatay ölçekte kopya başına). ÖDEME olayları AYRI bütçede: hata seli ödeme
// izini boğamaz (Haiku güvenlik incelemesi 10-12: anonim 500'ler sistem kovasını doldurunca "bağlanamayan ödeme" satırı iz bırakmadan
// düşüyordu). Aynı bağlamdan gelen hata dakikada en fazla 5 satır (tablo şişmesin). Düşen satır sayılır ve dakikada bir konsola yazılır.
const WINDOW_MS = 60_000;
const CAPS = { orgBilling: 300, orgOther: 120, systemBilling: 1_200, systemOther: 120, errorPerContext: 5 } as const;
const windows = new Map<string, { start: number; count: number }>();
let dropped = 0;
let droppedSince = 0;

function take(key: string, cap: number, now: number): boolean {
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

function underCap(event: OperationalEventName, organizationId: string | null, context: unknown, now: number): boolean {
  const billing = event.startsWith("billing.");
  const owner = organizationId ?? "__system";
  const cap = organizationId ? (billing ? CAPS.orgBilling : CAPS.orgOther) : billing ? CAPS.systemBilling : CAPS.systemOther;
  const ok =
    (event !== "error.reported" || take(`ctx:${owner}:${String(context)}`, CAPS.errorPerContext, now)) &&
    take(`${owner}:${billing ? "billing" : "other"}`, cap, now);
  if (!ok) {
    dropped++;
    if (now - droppedSince >= WINDOW_MS) {
      console.warn(`[event-log] tavan nedeniyle yazılmayan olay: ${dropped}`);
      dropped = 0;
      droppedSince = now;
    }
  }
  return ok;
}

/** Yalnız test: dakikalık tavanı sıfırla. */
export function __resetEventLogLimits(): void {
  windows.clear();
  dropped = 0;
  droppedSince = 0;
}

/** Günlük yazımı ödeme / istek yolunu bekletmez: veritabanı takılırsa en fazla bu kadar beklenir (yazım arka planda sürer). */
const WRITE_TIMEOUT_MS = 1_500;

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
    if (!Object.hasOwn(OPERATIONAL_EVENTS, event)) return correlationId;
    const level = OPERATIONAL_EVENTS[event];
    const organizationId = opts.organizationId !== undefined ? opts.organizationId : (ctx?.organizationId ?? null);
    if (!underCap(event, organizationId, data?.context, Date.now())) return correlationId;
    const clean = sanitizeEventData(data as Record<string, unknown> | undefined);
    const dataJson = clean ? JSON.stringify(clean).slice(0, MAX_DATA_CHARS) : null;
    const write = prisma.operationalEvent.create({ data: { correlationId, organizationId, event, level, dataJson } });
    write.catch(() => {}); // zaman aşımından sonra düşen yazım işlenmemiş ret olmasın
    await Promise.race([write, new Promise<void>((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS).unref?.())]);
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
