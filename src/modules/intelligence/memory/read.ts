import "server-only";

import { prisma } from "@/lib/db";

// Okuma yüzeyi (V1): UI/V2 Exception Feed buradan okur. Kiracı + mülk kapsamlı; yalnız aktif kalemler.
export interface PropertyMemoryView {
  facts: Array<{ id: string; category: string; title: string; body: string | null; observedAt: Date; confidence: number; source: string }>;
  patterns: Array<{ id: string; category: string; title: string; observedAt: Date; confidence: number; evidenceCount: number }>;
  recentSignals: Array<{ id: string; kind: string; category: string; sentiment: string | null; severity: number; occurredAt: Date }>;
}

export async function getPropertyMemory(organizationId: string, propertyId: string, recentLimit = 20): Promise<PropertyMemoryView> {
  const [memories, signals] = await Promise.all([
    prisma.propertyMemory.findMany({
      where: { organizationId, propertyId, status: "active" },
      orderBy: { observedAt: "desc" },
      select: { id: true, kind: true, category: true, title: true, body: true, observedAt: true, confidence: true, source: true, evidenceJson: true },
    }),
    prisma.signal.findMany({
      where: { organizationId, propertyId },
      orderBy: { occurredAt: "desc" },
      take: recentLimit,
      select: { id: true, kind: true, category: true, sentiment: true, severity: true, occurredAt: true },
    }),
  ]);
  const evidenceCount = (json: string): number => {
    try {
      const v: unknown = JSON.parse(json);
      return Array.isArray(v) ? v.length : 0;
    } catch {
      return 0;
    }
  };
  return {
    // Kart "Bilgi Tabanı'ndan N kalem" der → yalnız KB kaynaklı olgular. Ev sahibinin fiyat aralığı gibi insan
    // kayıtları (`source: "human"`, V2) burada listelenmez; kendi formlarında görünür.
    facts: memories
      .filter((m) => m.kind === "fact" && m.source === "kb_item")
      .map(({ id, category, title, body, observedAt, confidence, source }) => ({ id, category, title, body, observedAt, confidence, source })),
    patterns: memories
      .filter((m) => m.kind === "pattern" || m.kind === "risk")
      .map((m) => ({ id: m.id, category: m.category, title: m.title, observedAt: m.observedAt, confidence: m.confidence, evidenceCount: evidenceCount(m.evidenceJson) })),
    recentSignals: signals,
  };
}
