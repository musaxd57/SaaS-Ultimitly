import type { Prisma, PrismaClient } from "@prisma/client";
import { hostChannelFlagsFromEnv } from "./routing";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * WhatsApp'tan onaylanıp giden cevaplar (ev sahibi soru kanalı, anahtar açıkken). Ev sahibi YALNIZ kendisine sorulan turun sorusunu gördü →
 * bu mesaj konuşmanın öteki açık öğelerini / karar kartlarını "ev sahibi yazdı" ile kapatmaz (karar kartı kuralının aynısı; sert inceleme 10-30
 * A2). Öğeler (`conversation-items/store.ts`) ve karar kartları (`decisions/store.ts`) AYNI listeyi kullanır — iki denetim birbirinden kopmasın.
 * Anahtar kapalıyken sorgu YOK (davranış birebir eski).
 */
export async function hostQuestionResultMessageIds(db: Db, organizationId: string, conversationIds: readonly string[]): Promise<string[]> {
  if (!hostChannelFlagsFromEnv().questions || conversationIds.length === 0) return [];
  const rows = await db.hostQuestion.findMany({
    where: { organizationId, conversationId: { in: [...conversationIds] }, resultMessageId: { not: null } },
    select: { resultMessageId: true },
  });
  return rows.map((r) => r.resultMessageId).filter((v): v is string => v !== null);
}
