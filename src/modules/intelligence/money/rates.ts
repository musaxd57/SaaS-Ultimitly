import "server-only";

import { prisma } from "@/lib/db";
import { isValidRate, MONEY_CURRENCIES, RATE_MAX, type MoneyCurrency, type NightlyRateRange } from "./impact";

// ---------------------------------------------------------------------------
// EV SAHİBİNİN TİPİK GECELİK FİYAT ARALIĞI — mülk hafızasında bir İNSAN kaydı (09-24, migration YOK).
//
// `PropertyMemory` zaten "insan" kaynağını (`source: "human"`) ve kanıt/gözlem/son geçerlilik alanlarını
// taşıyor (değişmez 13): aralık `observedAt` = girildiği an, `expiresAt` = bayatlık sınırı, `humanOverride*`
// = kim girdi. Benzersiz anahtar (propertyId, source, sourceRef) → mülk başına TEK satır, upsert.
// KB eşitlemesi ve örüntü yenilemesi yalnız KENDİ kaynaklarına dokunur (`kb_item` / `signal_pattern`).
//
// 🚨 YAPAY ZEKÂYA GİTMEZ: bu kayıt hiçbir istem/cevap yolunda okunmaz (mekanik pin: `src/lib/ai` ve misafir
// rotası bu modülü ve `nightly_rate_range` anahtarını içermez). Misafire fiyat söylemek ayrı bir üründür.
// Kiracı kapsamı her sorguda `organizationId` ile (değişmez 16).
// ---------------------------------------------------------------------------

export const NIGHTLY_RATE_SOURCE = "human";
export const NIGHTLY_RATE_SOURCE_REF = "nightly_rate_range";
const STALE_DAYS_FOR_EXPIRY = 180;

interface StoredRate {
  low: number;
  high: number;
  currency: MoneyCurrency;
}

function parseStored(body: string | null): StoredRate | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as Partial<StoredRate>;
    if (typeof v.low !== "number" || typeof v.high !== "number") return null;
    if (!(MONEY_CURRENCIES as readonly string[]).includes(v.currency as string)) return null;
    return { low: v.low, high: v.high, currency: v.currency as MoneyCurrency };
  } catch {
    return null;
  }
}

/** Org kapsamında, verilen mülklerin geçerli aralıkları (geçersiz/eksik kayıt haritaya girmez). */
export async function loadNightlyRates(
  organizationId: string,
  propertyIds: readonly string[],
): Promise<Map<string, NightlyRateRange>> {
  const out = new Map<string, NightlyRateRange>();
  if (propertyIds.length === 0) return out;
  const rows = await prisma.propertyMemory.findMany({
    where: {
      organizationId,
      propertyId: { in: [...propertyIds] },
      source: NIGHTLY_RATE_SOURCE,
      sourceRef: NIGHTLY_RATE_SOURCE_REF,
      status: "active",
    },
    select: { propertyId: true, body: true, observedAt: true },
  });
  for (const r of rows) {
    const s = parseStored(r.body);
    if (!s) continue;
    const rate: NightlyRateRange = { ...s, enteredAt: r.observedAt };
    if (isValidRate(rate)) out.set(r.propertyId, rate);
  }
  return out;
}

/** Tek mülkün aralığı (mülk sayfası formu için). */
export async function getNightlyRate(organizationId: string, propertyId: string): Promise<NightlyRateRange | null> {
  return (await loadNightlyRates(organizationId, [propertyId])).get(propertyId) ?? null;
}

export type NightlyRateInput = { low: number; high: number; currency: MoneyCurrency };

/** Girdi doğrulaması (rota ve testler aynı kuralı kullanır). */
export function validateNightlyRateInput(v: unknown): NightlyRateInput | null {
  if (!v || typeof v !== "object") return null;
  const x = v as Record<string, unknown>;
  const low = typeof x.low === "number" ? x.low : Number.NaN;
  const high = typeof x.high === "number" ? x.high : Number.NaN;
  const currency = x.currency;
  if (!Number.isInteger(low) || !Number.isInteger(high)) return null;
  if (low <= 0 || high <= low || high > RATE_MAX) return null;
  if (typeof currency !== "string" || !(MONEY_CURRENCIES as readonly string[]).includes(currency)) return null;
  return { low, high, currency: currency as MoneyCurrency };
}

/**
 * Aralığı yaz (upsert) ya da kaldır (`null` → satır `retired`; tarihçe silinmez). Mülkün bu org'a ait olduğunu
 * ÇAĞIRAN doğrular; burada da `organizationId` yazılır. Dönüş: yazılan aralık ya da null.
 */
export async function setNightlyRate(
  organizationId: string,
  propertyId: string,
  userId: string,
  input: NightlyRateInput | null,
  now: Date = new Date(),
): Promise<NightlyRateRange | null> {
  const where = { propertyId_source_sourceRef: { propertyId, source: NIGHTLY_RATE_SOURCE, sourceRef: NIGHTLY_RATE_SOURCE_REF } };
  if (input === null) {
    await prisma.propertyMemory.updateMany({
      where: { organizationId, propertyId, source: NIGHTLY_RATE_SOURCE, sourceRef: NIGHTLY_RATE_SOURCE_REF },
      data: { status: "retired" },
    });
    return null;
  }
  const expiresAt = new Date(now.getTime() + STALE_DAYS_FOR_EXPIRY * 86_400_000);
  const data = {
    kind: "fact",
    category: "pricing",
    title: "Gecelik fiyat aralığı",
    body: JSON.stringify(input),
    evidenceJson: "[]",
    confidence: 1,
    observedAt: now,
    lastConfirmedAt: now,
    expiresAt,
    humanOverrideAt: now,
    humanOverrideUserId: userId,
    status: "active",
  };
  await prisma.propertyMemory.upsert({
    where,
    create: { organizationId, propertyId, source: NIGHTLY_RATE_SOURCE, sourceRef: NIGHTLY_RATE_SOURCE_REF, ...data },
    update: data,
  });
  return { ...input, enteredAt: now };
}
