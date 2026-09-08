import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// BAŞLANGIÇ HAFIZASI — KnowledgeBaseItem'dan (kurucu: "the existing KnowledgeBaseItem flow is
// the starting point for Property Memory"). Kaynağı AÇIK: source=kb_item, sourceRef=kb.id,
// evidence=[{kb_item,id}], observedAt = KB'nin GERÇEK updatedAt'i (şimdi değil — sahte zaman yok),
// confidence=1 (host'un kendi beyanı). İdempotent (unique propertyId+source+sourceRef).
// Pasif kalem → hafıza retired (silinmez; tarihçe). Geçmiş mesaj/rezervasyondan GERİYE DÖNÜK
// sinyal/hafıza üretilmez (sahte event yok).
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  created: number;
  updated: number;
  retired: number;
}

export async function bootstrapMemoryFromKnowledgeBase(organizationId: string, propertyId?: string): Promise<BootstrapResult> {
  const out: BootstrapResult = { created: 0, updated: 0, retired: 0 };
  const items = await prisma.knowledgeBaseItem.findMany({
    where: { property: { organizationId }, ...(propertyId ? { propertyId } : {}) },
    select: { id: true, propertyId: true, category: true, title: true, content: true, isActive: true, updatedAt: true },
  });
  for (const kb of items) {
    const existing = await prisma.propertyMemory.findUnique({
      where: { propertyId_source_sourceRef: { propertyId: kb.propertyId, source: "kb_item", sourceRef: kb.id } },
      select: { id: true, title: true, body: true, category: true, observedAt: true, status: true },
    });
    if (!kb.isActive) {
      if (existing && existing.status !== "retired") {
        await prisma.propertyMemory.update({ where: { id: existing.id }, data: { status: "retired" } });
        out.retired++;
      }
      continue;
    }
    const data = {
      kind: "fact",
      category: kb.category,
      title: kb.title,
      body: kb.content,
      evidenceJson: JSON.stringify([{ type: "kb_item", id: kb.id }]),
      confidence: 1,
      observedAt: kb.updatedAt,
      lastConfirmedAt: kb.updatedAt,
      status: "active",
    };
    if (!existing) {
      await prisma.propertyMemory.create({
        data: { organizationId, propertyId: kb.propertyId, source: "kb_item", sourceRef: kb.id, ...data },
      });
      out.created++;
      continue;
    }
    const changed =
      existing.title !== data.title ||
      existing.body !== data.body ||
      existing.category !== data.category ||
      existing.observedAt.getTime() !== data.observedAt.getTime() ||
      existing.status !== "active";
    if (changed) {
      await prisma.propertyMemory.update({ where: { id: existing.id }, data });
      out.updated++;
    }
  }
  return out;
}
