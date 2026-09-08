import "server-only";

import { prisma } from "@/lib/db";
import { isAiReadableReviewState } from "@/lib/kb-review";

// ---------------------------------------------------------------------------
// BAŞLANGIÇ HAFIZASI — KnowledgeBaseItem'dan (kurucu: "the existing KnowledgeBaseItem flow is
// the starting point for Property Memory"). Kaynağı AÇIK: source=kb_item, sourceRef=kb.id,
// evidence=[{kb_item,id}], observedAt = KB'nin GERÇEK updatedAt'i (şimdi değil — sahte zaman yok),
// confidence=1 (host'un kendi beyanı). İdempotent (unique propertyId+source+sourceRef).
// Pasif kalem → hafıza retired; SİLİNMİŞ kalem (KB DELETE hard delete'tir) → hafıza retired
// (silinmez; tarihçe). Geçmiş mesaj/rezervasyondan GERİYE DÖNÜK sinyal/hafıza üretilmez.
//
// ÇAĞRILMA YOLU (V1 ürün akışı): (1) her zamanlanmış geçişte org başına (`runIntelligencePass`)
// — yeniden çalıştırma güvenli, değişmeyen kalem yazılmaz; (2) KB yazma rotaları (POST/PATCH/
// DELETE/copy) yazdıktan hemen sonra mülk kapsamında (`refreshPropertyMemoryBestEffort`) —
// host'un gördüğü hafıza KB ile anında tutarlı. Toplu okuma: kalem sayısı kadar sorgu DEĞİL,
// kapsam başına iki findMany + yalnız değişen satıra yazma.
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  created: number;
  updated: number;
  retired: number;
}

export async function bootstrapMemoryFromKnowledgeBase(organizationId: string, propertyId?: string): Promise<BootstrapResult> {
  const out: BootstrapResult = { created: 0, updated: 0, retired: 0 };
  const scope = propertyId ? { propertyId } : {};
  const [items, existingRows] = await Promise.all([
    prisma.knowledgeBaseItem.findMany({
      where: { property: { organizationId }, ...scope },
      select: {
        id: true,
        propertyId: true,
        category: true,
        title: true,
        content: true,
        isActive: true,
        reviewState: true,
        updatedAt: true,
      },
    }),
    // Kiracı + (varsa) mülk kapsamı: başka org'un / mülkün hafızasına dokunulmaz.
    prisma.propertyMemory.findMany({
      where: { organizationId, source: "kb_item", ...scope },
      select: { id: true, propertyId: true, sourceRef: true, title: true, body: true, category: true, observedAt: true, status: true },
    }),
  ]);
  const key = (pid: string, ref: string) => `${pid}:${ref}`;
  const existing = new Map(existingRows.map((r) => [key(r.propertyId, r.sourceRef), r]));
  const seen = new Set<string>();

  for (const kb of items) {
    const k = key(kb.propertyId, kb.id);
    seen.add(k);
    const ex = existing.get(k);
    // TASLAK MÜLK GERÇEĞİ DEĞİLDİR (A1, 09-08). Hafıza "bu mülk hakkında bilinen
    // şey" demektir ve `confidence: 1` ile "host'un kendi beyanı" diye yazılır;
    // henüz onaylanmamış bir ÇIKARIMI oraya koymak, ürünün en güvendiği katmana
    // doğrulanmamış metin sokmak olurdu. Pasif kalemle aynı dala düşürülüyor:
    // onaya düşen bir kalem hafızada da `retired` olur, silinmez (tarihçe).
    if (!kb.isActive || !isAiReadableReviewState(kb.reviewState)) {
      if (ex && ex.status !== "retired") {
        await prisma.propertyMemory.update({ where: { id: ex.id }, data: { status: "retired" } });
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
    if (!ex) {
      await prisma.propertyMemory.create({
        data: { organizationId, propertyId: kb.propertyId, source: "kb_item", sourceRef: kb.id, ...data },
      });
      out.created++;
      continue;
    }
    const changed =
      ex.title !== data.title ||
      ex.body !== data.body ||
      ex.category !== data.category ||
      ex.observedAt.getTime() !== data.observedAt.getTime() ||
      ex.status !== "active";
    if (changed) {
      await prisma.propertyMemory.update({ where: { id: ex.id }, data });
      out.updated++;
    }
  }

  // KB kalemi artık YOK (hard delete) → hafıza retired. Yalnız kapsamdaki (org/mülk) satırlar.
  for (const [k, ex] of existing) {
    if (seen.has(k) || ex.status === "retired") continue;
    await prisma.propertyMemory.update({ where: { id: ex.id }, data: { status: "retired" } });
    out.retired++;
  }
  return out;
}
