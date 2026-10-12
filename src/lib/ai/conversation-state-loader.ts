import "server-only";

import { prisma } from "@/lib/db";
import {
  conversationStateBlock,
  buildConversationState,
  conversationStateEnabled,
  STATE_DECISION_WINDOW,
  type ConversationStateSummary,
  type StateMessage,
} from "./conversation-state";
import { conversationPhaseFacts } from "./conversation-phase";
import { loadConversationPhase } from "@/lib/operator-replies";

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

/**
 * İstem bu kayıtlardan "KONUŞMA KAYITLARI" bloğu kurdu mu (pencere dışı konu / sayaç = eski hafıza)? Üretim izi tanısı istemle AYNI
 * koşulu kullansın diye burada — `conversation-state` modülünü yalnız istem / tip / yükleyici / anlama girişi içe aktarır (izolasyon pini).
 */
export function conversationRecordsInPrompt(records: Parameters<typeof conversationStateBlock>[0]): boolean {
  return conversationStateBlock(records) !== "";
}

export async function loadConversationState(input: {
  organizationId: string;
  /** Konuşmanın tamamı ya da sonundan kesintisiz pencere, `(createdAt, id)` artan. */
  messages: readonly StateMessage[];
  /** Otomatik bilgilendirme damgaları bu rezervasyondan okunur (yoksa yaşam döngüsü satırı yazılmaz). */
  reservationId?: string | null;
  /** Verilirse YETKİLİ konuşma durumu (aşama, teslim edilen cevap, son cevaptan geçen süre) konuşmanın TAMAMINDAN eklenir. */
  conversationId?: string;
  timeZone?: string;
  /** Zaman bağlamının "şimdi"si: cevaplanan misafir mesajının anı (yeniden işlenen turda işleme anı aralığı şişirmesin — Haiku 10-09). */
  now?: Date;
  /** Henüz kaydedilmemiş, şu an cevaplanan misafir mesajı (QR). */
  pendingGuestText?: string | null;
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
    const summary = buildConversationState({ messages: input.messages, decisions, lifecycle });
    if (input.conversationId && input.timeZone) {
      const phase = await loadConversationPhase(input.conversationId, input.pendingGuestText);
      if (phase) summary.phase = conversationPhaseFacts(phase, input.now ?? new Date(), input.timeZone);
    }
    return summary;
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
  /** Bekleyen mesajın METNİ (aşama / kapanış hükmüne katılır). */
  pendingGuestText?: string | null;
  timeZone?: string;
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
      conversationId: input.conversationId,
      timeZone: input.timeZone,
      pendingGuestText: input.pendingGuestMessage ? input.pendingGuestText : null,
    });
  } catch {
    return undefined;
  }
}
