import "server-only";

import { prisma } from "@/lib/db";
import {
  buildConversationState,
  conversationStateEnabled,
  STATE_DECISION_WINDOW,
  type ConversationStateSummary,
  type StateMessage,
} from "./conversation-state";

// ---------------------------------------------------------------------------
// Konuşma Anlama Durumu v1 dilim B — yükleyici. Bayrak kapalıyken HİÇ sorgu atmaz (istem bayt bayt aynı).
// Karar kayıtları ve yaşam döngüsü damgaları KİRACI kapsamlı okunur (`organizationId`), karar kayıtları yalnız cevap
// yüzeylerinden (kanal `auto_reply` + QR `guest_chat`): `alerts` yüzeyi kelime ağının kararıdır — etiketleri konu adı
// olmaz (↑`conversation-state.ts`). Asla fırlatmaz: okunamazsa durum YOK (cevap akışı durmaz; blok yazılmaz = bugünkü
// davranış).
// ---------------------------------------------------------------------------

const STATE_SURFACES = ["auto_reply", "guest_chat"];

/** Henüz kaydedilmemiş (cevabıyla birlikte yazılacak) misafir mesajının yer tutucu kimliği — karar kaydı sorgusuna girmez. */
const PENDING_GUEST_MESSAGE_ID = "pending-guest-message";

export async function loadConversationState(input: {
  organizationId: string;
  /** Konuşmanın tamamı ya da sonundan kesintisiz pencere, `(createdAt, id)` artan. */
  messages: readonly StateMessage[];
  /** Otomatik bilgilendirme damgaları bu rezervasyondan okunur (yoksa yaşam döngüsü satırı yazılmaz). */
  reservationId?: string | null;
}): Promise<ConversationStateSummary | undefined> {
  if (!conversationStateEnabled()) return undefined;
  try {
    const guestIds = input.messages
      .filter((m) => m.direction === "inbound" && m.id !== PENDING_GUEST_MESSAGE_ID)
      .slice(-STATE_DECISION_WINDOW)
      .map((m) => m.id);
    const [decisions, lifecycle] = await Promise.all([
      guestIds.length === 0
        ? []
        : prisma.riskEvent.findMany({
            where: { organizationId: input.organizationId, surface: { in: STATE_SURFACES }, triggerId: { in: guestIds } },
            select: { triggerId: true, surface: true, finalDecision: true, reason: true, riskType: true, kbEvidenceJson: true },
          }),
      input.reservationId
        ? prisma.reservation.findFirst({
            where: { id: input.reservationId, property: { organizationId: input.organizationId } },
            select: { welcomeSentAt: true, checkinSentAt: true, checkoutSentAt: true },
          })
        : null,
    ]);
    return buildConversationState({ messages: input.messages, decisions, lifecycle });
  } catch {
    return undefined;
  }
}

/** Mesajları yüklü olmayan yüzey (QR) için: konuşmanın SON penceresi, `(createdAt, id)` sırasıyla. */
export const STATE_MESSAGE_WINDOW = 200;

export async function loadConversationStateForConversation(input: {
  organizationId: string;
  conversationId: string;
  reservationId?: string | null;
  /**
   * Cevaplanan misafir mesajı henüz kaydedilmediyse (QR: mesaj cevabıyla birlikte yazılır) sayıma katılır. Kanal ve gelen
   * kutusunda mesaj zaten kayıtlıdır → "son giden mesajdan sonraki misafir mesajı" üç yüzeyde aynı anlamı taşır.
   */
  pendingGuestMessage?: boolean;
}): Promise<ConversationStateSummary | undefined> {
  if (!conversationStateEnabled()) return undefined;
  try {
    const recent = await prisma.message.findMany({
      where: { conversationId: input.conversationId, conversation: { property: { organizationId: input.organizationId } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: STATE_MESSAGE_WINDOW,
      select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
    });
    const messages: StateMessage[] = recent.reverse();
    if (input.pendingGuestMessage) {
      messages.push({ id: PENDING_GUEST_MESSAGE_ID, direction: "inbound", senderName: "", body: "" });
    }
    return await loadConversationState({
      organizationId: input.organizationId,
      messages,
      reservationId: input.reservationId,
    });
  } catch {
    return undefined;
  }
}
