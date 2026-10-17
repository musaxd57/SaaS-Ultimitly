import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// ÖRÜNTÜ HAFIZASI — sinyallerden ("Hot water: 4 signals / 118 days → recurring").
// Deterministik: mülk × kategori, pencere içindeki NEGATİF sinyal sayısı ≥ eşik → kind=pattern,
// source=signal_pattern, sourceRef=kategori (idempotent upsert), evidence = sinyal id'leri,
// observedAt = son sinyalin GERÇEK zamanı, lastConfirmedAt = hesap anı (gerçek), confidence
// sayıyla artar (0.6 → 0.9, tavan). Eşiğin altına düşen örüntü retired olur (silinmez).
// LLM yok; metin yok (başlık kategori+sayı+gün).
// ---------------------------------------------------------------------------

export const PATTERN_MIN_SIGNALS = 3;
export const PATTERN_WINDOW_DAYS = 180;

export interface PatternResult {
  upserted: number;
  retired: number;
}

export async function refreshPatternMemory(organizationId: string, propertyId?: string, now: Date = new Date()): Promise<PatternResult> {
  const out: PatternResult = { upserted: 0, retired: 0 };
  const since = new Date(now.getTime() - PATTERN_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.signal.findMany({
    where: { organizationId, ...(propertyId ? { propertyId } : {}), sentiment: "negative", occurredAt: { gte: since, lte: now } },
    select: { id: true, propertyId: true, category: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  const groups = new Map<string, { propertyId: string; category: string; ids: string[]; first: Date; last: Date }>();
  for (const s of rows) {
    const key = `${s.propertyId}:${s.category}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(s.id);
      g.last = s.occurredAt;
    } else groups.set(key, { propertyId: s.propertyId, category: s.category, ids: [s.id], first: s.occurredAt, last: s.occurredAt });
  }
  const active = new Set<string>();
  for (const g of groups.values()) {
    if (g.ids.length < PATTERN_MIN_SIGNALS) continue;
    active.add(`${g.propertyId}:${g.category}`);
    const days = Math.max(1, Math.ceil((g.last.getTime() - g.first.getTime()) / 86_400_000));
    const confidence = Math.min(0.9, 0.6 + 0.1 * (g.ids.length - PATTERN_MIN_SIGNALS));
    const data = {
      kind: "pattern",
      category: g.category,
      title: `${g.category}: ${g.ids.length} sinyal / ${days} gün`,
      body: null,
      evidenceJson: JSON.stringify(g.ids.map((id) => ({ type: "signal", id }))),
      confidence,
      observedAt: g.last,
      effectiveAt: g.first,
      lastConfirmedAt: now,
      status: "active",
    };
    await prisma.propertyMemory.upsert({
      where: { propertyId_source_sourceRef: { propertyId: g.propertyId, source: "signal_pattern", sourceRef: g.category } },
      create: { organizationId, propertyId: g.propertyId, source: "signal_pattern", sourceRef: g.category, ...data },
      update: data,
    });
    out.upserted++;
  }
  // Eşiğin altına düşen (pencereden çıkan) örüntüler retired — tarihçe kalır.
  const stale = await prisma.propertyMemory.findMany({
    where: { organizationId, ...(propertyId ? { propertyId } : {}), source: "signal_pattern", status: "active" },
    select: { id: true, propertyId: true, sourceRef: true },
  });
  for (const p of stale) {
    if (active.has(`${p.propertyId}:${p.sourceRef}`)) continue;
    await prisma.propertyMemory.update({ where: { id: p.id }, data: { status: "retired" } });
    out.retired++;
  }
  return out;
}
