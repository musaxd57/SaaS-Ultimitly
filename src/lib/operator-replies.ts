import { prisma } from "@/lib/db";

/**
 * SELAM TEKRARI — "misafire daha önce cevap verdik mi" TEK KURAL (kanal oto-yanıtı, gelen kutusu önerisi, QR). Konuşmanın
 * TAMAMINDA misafirin gördüğü giden mesaj sayısı: sistem olayı ve gövdesiz satır cevap değildir (misafir onları görmez).
 * Yüklü mesaj penceresi DEĞİL, veritabanı sayımı — pencere bir gösterim tavanıdır, gerçeğin kaynağı değil.
 */
export const PRIOR_OPERATOR_REPLY_WHERE = { direction: "outbound", systemEventType: null, NOT: { body: "" } } as const;

export function countPriorOperatorReplies(conversationId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId, ...PRIOR_OPERATOR_REPLY_WHERE } });
}
