import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { undeliveredFilterActive } from "./presence";
import { NOT_DELIVERED_STATUSES } from "./state";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Kuyrukta terminal ve misafire KESİNLİKLE ulaşmamış (iptal / başarısız / engellenmiş) giden mesajların kimlikleri — verilen konuşmalarda
 * (talimat 09-07 §5: bunlar cevap / bağlam sayılmaz). TEK kaynak: selam sayımı ve konuşma evresi (`operator-replies.ts`), S1 gönderim
 * kapısı (`host-send.ts`) ve "ev sahibi yazdı" türetmesi (öğe defteri + karar kartı, Codex 11-17 C2) aynı listeyi okur.
 *
 * Maliyet kuralı (`presence.ts`): kuyruk hiç kullanılmadıysa ek sorgu YOK. Belirsiz gönderim (`review` / `ambiguous`) listede DEĞİL — ulaşmış
 * olabilir. `Message` ile kuyruk satırı arasında ilişki yok; bağ `messageId`. Konuşma kimlikleri çağıranın kiracı kapsamlı sorgusundan gelir.
 */
export async function undeliveredOutboundMessageIds(conversationIds: readonly string[], db: Db = prisma): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  // Anahtar kapatıldıktan sonra da (kuyrukta satır kaldıysa) süzgeç açık kalır (Opus F3).
  if (!(await undeliveredFilterActive())) return [];
  const rows = await db.messageOutbox.findMany({
    where: { conversationId: { in: [...conversationIds] }, status: { in: [...NOT_DELIVERED_STATUSES] }, messageId: { not: null } },
    select: { messageId: true },
  });
  return rows.map((r) => r.messageId).filter((id): id is string => Boolean(id));
}
