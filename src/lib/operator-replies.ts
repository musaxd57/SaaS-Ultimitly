import { prisma } from "@/lib/db";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import { UNDELIVERED_TERMINAL_STATUSES } from "@/lib/outbox/state";
import { deriveConversationPhase, PHASE_UNANSWERED_SCAN, type ConversationPhaseState } from "@/lib/ai/conversation-phase";

/**
 * SELAM TEKRARI — "misafire daha önce cevap verdik mi" TEK KURAL (kanal oto-yanıtı, gelen kutusu önerisi, QR). Konuşmanın
 * TAMAMINDA misafirin gördüğü giden mesaj sayısı: sistem olayı ve gövdesiz satır cevap değildir (misafir onları görmez).
 * Yüklü mesaj penceresi DEĞİL, veritabanı sayımı — pencere bir gösterim tavanıdır, gerçeğin kaynağı değil.
 */
export const PRIOR_OPERATOR_REPLY_WHERE = { direction: "outbound", systemEventType: null, NOT: { body: "" } } as const;

/**
 * Kuyrukta terminal ve misafire ULAŞMAMIŞ (iptal / başarısız / engellenmiş / incelemede) giden mesajların kimlikleri (talimat 09-07 §5).
 * Kuyruk kapalıyken tablo boştur → sorgu YOK (bugünkü maliyet). `Message` ile kuyruk satırı arasında ilişki yok; bağ `messageId`.
 */
async function undeliveredOutboundIds(conversationId: string): Promise<string[]> {
  if (!durableOutboxEnabled()) return [];
  const rows = await prisma.messageOutbox.findMany({
    where: { conversationId, status: { in: [...UNDELIVERED_TERMINAL_STATUSES] }, messageId: { not: null } },
    select: { messageId: true },
  });
  return rows.map((r) => r.messageId).filter((id): id is string => Boolean(id));
}

function deliveredReplyWhere(conversationId: string, excluded: readonly string[]) {
  return { conversationId, ...PRIOR_OPERATOR_REPLY_WHERE, ...(excluded.length > 0 ? { id: { notIn: [...excluded] } } : {}) };
}

export async function countPriorOperatorReplies(conversationId: string): Promise<number> {
  const excluded = await undeliveredOutboundIds(conversationId);
  return prisma.message.count({ where: deliveredReplyWhere(conversationId, excluded) });
}

/**
 * Talimat 09-07 §6 — YETKİLİ konuşma durumu, KODDA ve konuşmanın TAMAMINDAN (pencereden değil): aşama, teslim edilmiş cevap sayısı,
 * cevapsız misafir mesajı sayısı, son etkileşim. Sınırlı / indeksli sorgular (`(conversationId, createdAt)`); cevapsız misafir mesajları
 * en çok `PHASE_UNANSWERED_SCAN` satır okunur (sayı tavan üstündeyse kapanış hükmü verilmez). Asla fırlatmaz → null.
 * Henüz isteme BAĞLANMADI (talimat: sözleşmeler doğrulanmadan etkinleştirilmez; bağlama = kör eval + kurucu onayı).
 */
export async function loadConversationPhase(conversationId: string): Promise<ConversationPhaseState | null> {
  try {
    const excluded = await undeliveredOutboundIds(conversationId);
    const where = deliveredReplyWhere(conversationId, excluded);
    const [deliveredReplyCount, lastDelivered, lastInteraction] = await Promise.all([
      prisma.message.count({ where }),
      prisma.message.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }),
      prisma.message.findFirst({
        where: { conversationId, systemEventType: null, NOT: { body: "" }, id: { notIn: [...excluded] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true },
      }),
    ]);
    const unanswered = await prisma.message.findMany({
      where: {
        conversationId,
        direction: "inbound",
        systemEventType: null,
        NOT: { body: "" },
        ...(lastDelivered ? { createdAt: { gt: lastDelivered.createdAt } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { body: true },
      take: PHASE_UNANSWERED_SCAN + 1,
    });
    return deriveConversationPhase({
      deliveredReplyCount,
      unansweredGuestTexts: unanswered.map((m) => m.body),
      lastInteractionAt: lastInteraction?.createdAt ?? null,
    });
  } catch {
    return null;
  }
}
