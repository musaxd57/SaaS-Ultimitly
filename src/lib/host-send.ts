import "server-only";

import type { Message } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { sendOnChannel, isDefinitiveSendFailure } from "@/lib/messaging";
import { resolveOrgChannelCredential } from "@/lib/channels";
import { claimOutboundSend, releaseOutboundSend } from "@/lib/outbound-claim";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import { enqueueOutbound } from "@/lib/outbox/enqueue";

// ---------------------------------------------------------------------------
// EV SAHİBİ ADINA GÖNDERİM — TEK ÇEKİRDEK (10-02, Host Karar Motoru ile ayrıştırıldı). `conversations/[id]/reply` (elle cevap /
// onaylanan taslak) ve `conversations/[id]/decisions/[decisionId]` (karar kartı) AYNI yoldan gönderir: önce misafirin kanalına
// teslim, sonra kayıt (ulaşmayan cevap kaydedilmez); kalıcı kuyruk açıkken niyet + mesaj atomik kuyruğa. Davranış cevap rotasıyla
// BİREBİR (tüm durum kodları ve metinler rotada; burası yalnız sonucu tipler — rota testleri bu yolu sınar).
// ---------------------------------------------------------------------------

export interface HostSendInput {
  organizationId: string;
  conversation: { id: string; channel: string; guestIdentifier: string; externalReservationId: string | null };
  /** Misafire giden gövde (isteğe bağlı çeviriden SONRA). */
  body: string;
  /**
   * Çift gönderim kalkanının anahtar metni: yazılan HAM gövde (çeviri açıkken de iki kopya aynı talebe düşsün). Kuyrukta
   * yedek tekilleştirme anahtarı da bundan türer.
   */
  claimBody: string;
  senderName: string;
  aiAssisted: boolean;
  /** Kalıcı kuyruk tekilleştirme anahtarı (kuyruk kapalıyken kullanılmaz). */
  idempotencyKey: string;
  /** Anahtar istemcinin istek kimliğinden mi (aynı kimlik farklı içerikle gelirse 409 — yeni mesajı yutmasın). */
  strictIdempotency: boolean;
}

export type HostSendResult =
  /** Kanal bağlantısı yok (iç QR konuşması değil). */
  | { status: "not_connected" }
  /** Kalıcı kuyruk: kabul edildi (henüz teslim DEĞİL); `deduped` = aynı mesaj zaten kuyrukta. */
  | { status: "queued"; message: Message | null; deduped: boolean }
  /** Aynı istek kimliği farklı içerikle kullanılmış (kuyruk). */
  | { status: "idempotency_conflict" }
  /** Aynı metin az önce gönderildi / hâlâ gönderiliyor. */
  | { status: "duplicate" }
  /** Çift gönderim kalkanı okunamadı. */
  | { status: "claim_unavailable" }
  /** Kanal KESİN reddetti (hiçbir şey teslim edilmedi; kalkan bırakıldı, aynı metin hemen yeniden denenebilir). */
  | { status: "failed_definitive"; error: string | undefined }
  /** Sonuç BELİRSİZ (zaman aşımı / ağ / 5xx): mesaj ulaşmış OLABİLİR, kalkan tutulur. */
  | { status: "failed_ambiguous" }
  /** Teslim edildi ve kaydedildi (`message` yalnız eşzamanlı senkronun satırı bulunamazsa null — teslim yine gerçekleşti). */
  | { status: "sent"; message: Message | null };

export async function sendHostMessage(input: HostSendInput): Promise<HostSendResult> {
  const { conversation } = input;
  const id = conversation.id;
  // Deliver on the guest's channel FIRST — don't persist a reply that never reached the guest (Airbnb/Booking via Hospitable,
  // or WhatsApp). Use this org's own Hospitable token (multi-tenant). Internal QR-concierge threads have no external channel,
  // so they don't need (and must not require) a Hospitable connection — the reply is just recorded.
  const isInternal = conversation.externalReservationId?.startsWith("qr-chat:") ?? false;
  const token = (await resolveOrgChannelCredential(input.organizationId))?.token ?? null;
  if (!isInternal && conversation.externalReservationId && !token) return { status: "not_connected" };

  // ── Durable Outbox (flag ON): record the Message + its send INTENT atomically and let the worker deliver it, instead of the
  // synchronous deliver-then-persist below. Falls through to the proven claim-then-send when the flag is OFF (default) or the
  // thread is internal (nothing to deliver). ──
  if (durableOutboxEnabled() && !isInternal && conversation.externalReservationId) {
    const enq = await enqueueOutbound({
      organizationId: input.organizationId,
      conversationId: id,
      channel: conversation.channel,
      externalReservationId: conversation.externalReservationId,
      body: input.body,
      senderName: input.senderName,
      authorType: "host",
      messageType: "manual",
      aiAssisted: input.aiAssisted,
      idempotencyKey: input.idempotencyKey,
    });
    // (Codex r2 #3 + r3) İstek kimlikli dedupe-hit'te PAYLOAD eşleşmesi ŞART — gövde VE aiAssisted: aynı kimliği farklı gövdeyle
    // kullanmak yeni mesajı YUTAR; aynı gövde + farklı aiAssisted ise AI-kredisi metriğini yanlış bırakır.
    if (enq.deduped && input.strictIdempotency) {
      const existing = await prisma.messageOutbox.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
        select: { body: true, messageId: true },
      });
      const existingMsg = existing?.messageId
        ? await prisma.message.findUnique({ where: { id: existing.messageId }, select: { aiAssisted: true } })
        : null;
      if (existing && (existing.body !== input.body || (existingMsg != null && existingMsg.aiAssisted !== input.aiAssisted))) {
        return { status: "idempotency_conflict" };
      }
    }
    const message = await prisma.message.findUnique({ where: { id: enq.messageId } });
    return { status: "queued", message, deduped: enq.deduped };
  }

  // Duplicate guard (claim-then-send, like auto-reply): a double-click / browser retry with the SAME text must not reach the
  // guest twice. Keyed on the RAW typed body so both duplicates map to the same claim even when translate is on.
  const claimed = await claimOutboundSend(id, input.claimBody);
  if (claimed === "duplicate") return { status: "duplicate" };
  if (claimed === "unavailable") return { status: "claim_unavailable" };
  const outcome = await sendOnChannel(conversation, input.body, token ?? undefined);
  if (!outcome.ok) {
    // DEFINITIVE provider rejection (HTTP 4xx incl. 429; not 408) → nothing was delivered → release so the same text is
    // retryable now. Anything else (timeout / network / 5xx) is AMBIGUOUS — the message MAY have reached the guest despite the
    // error — so the claim stays held for its TTL and the caller tells the user to CHECK the thread before resending.
    if (isDefinitiveSendFailure(outcome.error)) {
      await releaseOutboundSend(id, input.claimBody);
      return { status: "failed_definitive", error: outcome.error };
    }
    return { status: "failed_ambiguous" };
  }

  const now = new Date();
  let message: Message | null;
  try {
    [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: id,
          direction: "outbound",
          // Host-sent (manual, a one-click-approved AI draft, or a decision card → aiAssisted). authorType is the reliable
          // author; aiAssisted separately flags "AI drafted it".
          authorType: "host",
          senderName: input.senderName,
          body: input.body,
          aiAssisted: input.aiAssisted,
          // Store the provider's message id so the sync re-importing this reply from the channel thread dedups it instead of
          // creating a duplicate row.
          ...(outcome.providerMessageId ? { externalId: outcome.providerMessageId } : {}),
        },
      }),
      prisma.conversation.update({
        where: { id },
        data: { status: "answered", lastMessageAt: now },
      }),
    ]);
  } catch (err) {
    // Delivery already succeeded; a dedupe-hit on the new @@unique([conversationId, externalId]) means a concurrent sync
    // imported this very reply first. Adopt the existing row and still mark answered.
    if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
    message = await prisma.message.findFirst({
      where: { conversationId: id, externalId: outcome.providerMessageId ?? undefined },
    });
    await prisma.conversation.update({ where: { id }, data: { status: "answered", lastMessageAt: now } });
  }
  return { status: "sent", message };
}
