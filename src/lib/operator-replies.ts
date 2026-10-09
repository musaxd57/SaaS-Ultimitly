import { prisma } from "@/lib/db";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import { NOT_DELIVERED_STATUSES } from "@/lib/outbox/state";
import { notAutomationMessageWhere } from "@/lib/message-author";
import { closableAfter } from "@/lib/ai/closing-turn";
import { deriveConversationPhase, PHASE_UNANSWERED_SCAN, type ConversationPhaseState } from "@/lib/ai/conversation-phase";

/**
 * SELAM TEKRARI — "misafire daha önce cevap verdik mi" TEK KURAL (kanal oto-yanıtı, gelen kutusu önerisi, QR). Konuşmanın
 * TAMAMINDA misafirin gördüğü giden mesaj sayısı: sistem olayı ve gövdesiz satır cevap değildir (misafir onları görmez).
 * Yüklü mesaj penceresi DEĞİL, veritabanı sayımı — pencere bir gösterim tavanıdır, gerçeğin kaynağı değil.
 */
export const PRIOR_OPERATOR_REPLY_WHERE = { direction: "outbound", systemEventType: null, NOT: { body: "" } } as const;

/**
 * Kuyrukta terminal ve misafire KESİNLİKLE ulaşmamış (iptal / başarısız / engellenmiş) giden mesajların kimlikleri (talimat 09-07 §5).
 * Kuyruk kapalıyken tablo boştur → sorgu YOK (bugünkü maliyet). `Message` ile kuyruk satırı arasında ilişki yok; bağ `messageId`.
 */
async function undeliveredOutboundIds(conversationId: string): Promise<string[]> {
  if (!durableOutboxEnabled()) return [];
  const rows = await prisma.messageOutbox.findMany({
    where: { conversationId, status: { in: [...NOT_DELIVERED_STATUSES] }, messageId: { not: null } },
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

/** `(createdAt, id)` sırasında bir satırdan SONRA / ÖNCE (eşit zaman damgası `id` ile kırılır — ingest saniye hassasiyetli olabilir). */
function after(row: { createdAt: Date; id: string }) {
  return { OR: [{ createdAt: { gt: row.createdAt } }, { createdAt: row.createdAt, id: { gt: row.id } }] };
}
function before(row: { createdAt: Date; id: string }) {
  return { OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] };
}

/**
 * Talimat 09-07 §6 — YETKİLİ konuşma durumu, KODDA ve konuşmanın TAMAMINDAN (pencereden değil). Sayımlar iki ayrı kural:
 *  · `deliveredReplyCount` = selam kuralı (otomatik şablon mesajı DAHİL — misafir o selamı gördü, `message-author.ts`);
 *  · cevapsız misafir mesajları ve kapanış = son KONUŞMA cevabından sonrası (otomatik şablon mesajı cevap DEĞİLDİR, K7 — pencereyi
 *    sıfırlamaz; Haiku 10-09: aksi hâlde "acil!" → giriş otomasyonu → "Tamam teşekkürler" kapanış görünürdü). Kapanış ayrıca
 *    `closableAfter` ister (misafir yazdıktan sonra bir cevap var ve yapay zekânın son cevabı soru / teklif değil).
 * Sınırlı / indeksli sorgular; cevapsız misafir mesajı en çok `PHASE_UNANSWERED_SCAN` + 1 okunur. Asla fırlatmaz → null.
 * Henüz isteme BAĞLANMADI (talimat: doğrulanmadan etkinleştirilmez; bağlama = kör eval + kurucu onayı).
 */
export async function loadConversationPhase(conversationId: string): Promise<ConversationPhaseState | null> {
  try {
    const excluded = await undeliveredOutboundIds(conversationId);
    const delivered = deliveredReplyWhere(conversationId, excluded);
    const [deliveredReplyCount, lastConversationalReply, lastInteraction] = await Promise.all([
      prisma.message.count({ where: delivered }),
      prisma.message.findFirst({
        where: { ...delivered, AND: [notAutomationMessageWhere()] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true, aiIntent: true },
      }),
      prisma.message.findFirst({
        where: { conversationId, systemEventType: null, NOT: { body: "" }, ...(excluded.length > 0 ? { id: { notIn: [...excluded] } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true },
      }),
    ]);
    const guestWhere = { conversationId, direction: "inbound", systemEventType: null, NOT: { body: "" } };
    const [unanswered, guestBeforeReply] = await Promise.all([
      prisma.message.findMany({
        where: { ...guestWhere, ...(lastConversationalReply ? after(lastConversationalReply) : {}) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { body: true },
        take: PHASE_UNANSWERED_SCAN + 1,
      }),
      lastConversationalReply
        ? prisma.message.findFirst({ where: { ...guestWhere, ...before(lastConversationalReply) }, select: { id: true } })
        : null,
    ]);
    // Kapanış ön şartı (`closing-turn.ts` ile AYNI yüklem): misafir yazdı → cevap → cevapsızlar.
    const closable = lastConversationalReply
      ? closableAfter([
          ...(guestBeforeReply ? [{ direction: "inbound", senderName: "", body: "-" }] : []),
          lastConversationalReply,
          ...unanswered.map((m) => ({ direction: "inbound", senderName: "", body: m.body })),
        ])
      : false;
    return deriveConversationPhase({
      deliveredReplyCount,
      unansweredGuestTexts: unanswered.map((m) => m.body),
      closable,
      lastInteractionAt: lastInteraction?.createdAt ?? null,
    });
  } catch {
    return null;
  }
}
