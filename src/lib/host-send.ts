import "server-only";

import type { Message } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { sendOnChannel, isDefinitiveSendFailure } from "@/lib/messaging";
import { resolveOrgChannelCredential } from "@/lib/channels";
import { claimOutboundSend, releaseOutboundSend, claimOutboundRequest, releaseOutboundRequest, shortenOutboundRequest } from "@/lib/outbound-claim";
import { durableOutboxEnabledFor } from "@/lib/outbox/flag";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { kickOutboxDrain } from "@/lib/outbox/worker";
import { applyHostCommitmentsAuto } from "@/lib/guest-commitments-auto";
import { reportError } from "@/lib/report-error";

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
  /**
   * Kalıcı kuyruk: kabul edildi (henüz teslim DEĞİL); `deduped` = aynı mesaj zaten kuyrukta. `deliveryStatus` kuyruk satırının ŞU ANKİ
   * durumu (yeni satır "pending"; tekilleşen tekrarda satır gönderilmiş / başarısız olmuş olabilir — Codex 11-05: arayüz HTTP kodundan
   * değil bu açık durumdan karar verir).
   */
  | { status: "queued"; message: Message | null; deduped: boolean; deliveryStatus: string }
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
  if (durableOutboxEnabledFor(input.organizationId) && !isInternal && conversation.externalReservationId) {
    // 🚨 Codex 11-05 (43fb93e incelemesi P2): istek kimliği iki yolda da AYNI talebe bağlanır (`claimOutboundRequest`). Bu kimlikle
    // DOĞRUDAN gönderim yapıldıysa / sürüyorsa (anahtar iki deneme arasında açıldı) kuyruğa ikinci kopya yazılmaz. Önceki kuyruk denemesinin
    // talebi engel değildir — kuyruk satırı anahtarla zaten tekilleşir (aşağıdaki içerik denetimi dahil).
    let ownRequestClaim = false;
    if (input.strictIdempotency) {
      const req = await claimOutboundRequest(id, input.idempotencyKey, "queue");
      if (req.result === "unavailable") return { status: "claim_unavailable" };
      if (req.result === "held" && req.by !== "queue") return { status: "duplicate" };
      ownRequestClaim = req.result === "claimed";
    }
    let enq: Awaited<ReturnType<typeof enqueueOutbound>>;
    try {
      enq = await enqueueOutbound({
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
    } catch (err) {
      // Kuyruğa yazılamadı → hiçbir şey gönderilmeyecek: talep tutulursa (anahtar kapanınca) doğrudan yolun yeniden denemesi 24 sa kilitlenirdi.
      if (ownRequestClaim) await releaseOutboundRequest(id, input.idempotencyKey);
      throw err;
    }
    // (Codex r2 #3 + r3) İstek kimlikli dedupe-hit'te PAYLOAD eşleşmesi ŞART — gövde VE aiAssisted: aynı kimliği farklı gövdeyle
    // kullanmak yeni mesajı YUTAR; aynı gövde + farklı aiAssisted ise AI-kredisi metriğini yanlış bırakır.
    let deliveryStatus = "pending";
    if (enq.deduped) {
      const existing = await prisma.messageOutbox.findUnique({ where: { id: enq.outboxId }, select: { body: true, messageId: true, status: true } });
      deliveryStatus = existing?.status ?? "pending";
      if (input.strictIdempotency) {
        const existingMsg = existing?.messageId
          ? await prisma.message.findUnique({ where: { id: existing.messageId }, select: { aiAssisted: true } })
          : null;
        if (existing && (existing.body !== input.body || (existingMsg != null && existingMsg.aiAssisted !== input.aiAssisted))) {
          return { status: "idempotency_conflict" };
        }
      }
    }
    // Hızlı uyandırma (kurucu 10-16): satır COMMIT oldu → aynı süreçte boşaltma turu başlar; 2 dakikalık senkron yedek yol kalır.
    if (!enq.deduped) kickOutboxDrain();
    const message = await prisma.message.findUnique({ where: { id: enq.messageId } });
    return { status: "queued", message, deduped: enq.deduped, deliveryStatus };
  }

  // 🚨 Codex 11-04 P1: gönderim BAŞLAMADAN önceki iş durumu. Sağlayıcı cevabı beklenirken yeni misafir mesajı gelebilir, başka bir yönetici
  // konuşmayı Sorunlu / Tamamlandı yapabilir — tamamlama bunları "Cevaplandı" diye EZMEZ (kuyruk yolunun `markConversationDelivered` kuralı).
  // Çapa gönderimden ÖNCEKİ an: gönderimden SONRA yazılan mesaj satırının zamanı çapa olamaz.
  const pressedAt = new Date();
  const before = await prisma.conversation.findUnique({ where: { id }, select: { status: true } });

  // 🚨 Codex 11-05 (43fb93e incelemesi P2): bu istek kimliği KUYRUĞA yazılmışsa (anahtar açıkken; sonra kapatıldı) doğrudan GÖNDERİLMEZ —
  // satır hâlâ teslim edilecek (anahtar kapalıyken de satır varsa işçi boşaltır). Kuyruk satırı kalıcıdır: istek talebinin 24 saatinden
  // uzun yaşar, önce ona bakılır. Cevap kuyruk yolunun tekilleştirme cevabıyla aynı (içerik denetimi dahil).
  if (input.strictIdempotency && !isInternal) {
    const queued = await queuedRequestResult(input);
    if (queued) return queued;
  }

  // Duplicate guard (claim-then-send, like auto-reply): a double-click / browser retry with the SAME text must not reach the
  // guest twice. Keyed on the RAW typed body so both duplicates map to the same claim even when translate is on.
  const claimed = await claimOutboundSend(id, input.claimBody);
  if (claimed === "duplicate") return { status: "duplicate" };
  if (claimed === "unavailable") return { status: "claim_unavailable" };
  // İstek kimliği talebi (`claimOutboundRequest`): aynı kimlikle ikinci gönderim / kuyruk satırı oluşmaz — yanıtı kaybolan başarılı gönderimin
  // geç tekrarı ve araya giren anahtar değişikliği dahil.
  if (input.strictIdempotency) {
    const req = await claimOutboundRequest(id, input.idempotencyKey, "direct");
    if (req.result !== "claimed") {
      await releaseOutboundSend(id, input.claimBody);
      // Başka bir deneme (doğrudan ya da eşzamanlı kuyruk denemesi) bu kimliği tutuyor → "az önce gönderildi / hâlâ gönderiliyor".
      return req.result === "unavailable" ? { status: "claim_unavailable" } : { status: "duplicate" };
    }
  }
  let outcome: Awaited<ReturnType<typeof sendOnChannel>>;
  try {
    outcome = await sendOnChannel(conversation, input.body, token ?? undefined);
  } catch (err) {
    // Fırlatılan hata da BELİRSİZDİR (mesaj gitmiş olabilir): gövde talebi süresini doldurur, istek talebi de aynı 2 dk'ya iner.
    if (input.strictIdempotency) await shortenOutboundRequest(id, input.idempotencyKey);
    throw err;
  }
  if (!outcome.ok) {
    // DEFINITIVE provider rejection (HTTP 4xx incl. 429; not 408) → nothing was delivered → release so the same text is
    // retryable now. Anything else (timeout / network / 5xx) is AMBIGUOUS — the message MAY have reached the guest despite the
    // error — so the claim stays held for its TTL and the caller tells the user to CHECK the thread before resending.
    if (isDefinitiveSendFailure(outcome.error)) {
      await releaseOutboundSend(id, input.claimBody);
      if (input.strictIdempotency) await releaseOutboundRequest(id, input.idempotencyKey);
      return { status: "failed_definitive", error: outcome.error };
    }
    // Belirsiz: istek talebi gövde talebiyle aynı 2 dk'ya iner — "kontrol edip yeniden gönder" penceresi eskisi gibi.
    if (input.strictIdempotency) await shortenOutboundRequest(id, input.idempotencyKey);
    return { status: "failed_ambiguous" };
  }

  const now = new Date();
  // Koşullu tamamlama: durum gönderim başındakiyle AYNIYSA ve o andan sonra misafir yazmadıysa "Cevaplandı"; `lastMessageAt` yalnız ileri.
  const completeStatus = () =>
    prisma.conversation.updateMany({
      where: {
        id,
        ...(before ? { status: before.status } : {}),
        // Senkronun içeri aldığı satırın `createdAt`'i SAĞLAYICI zamanıdır (gönderimden önce yazılmış ama gönderim sırasında içeri alınmış
        // misafir mesajı onu kaçırırdı — sert inceleme 11-04): içeri alınma anı (`ingestedAt`) da çapaya bakar.
        messages: { none: { direction: "inbound", OR: [{ createdAt: { gt: pressedAt } }, { ingestedAt: { gt: pressedAt } }] } },
      },
      data: { status: "answered" },
    });
  const advanceLastMessageAt = () => prisma.conversation.updateMany({ where: { id, lastMessageAt: { lt: now } }, data: { lastMessageAt: now } });
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
      completeStatus(),
      advanceLastMessageAt(),
    ]);
  } catch (err) {
    // Delivery already succeeded; a dedupe-hit on the new @@unique([conversationId, externalId]) means a concurrent sync
    // imported this very reply first. Adopt the existing row and still mark answered.
    if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
    // Q2 (Haiku 10-17): senkron bu satırı kanalın "otomasyon" rolüyle yazdıysa (sağlayıcı API ile gideni öyle etiketleyebilir) yazar
    // otomatik mesaj olurdu → ev sahibinin cevabı "cevap değil" sayılır, konuşma yeniden açılırdı. Sağlayıcı kimliği BİZİM gönderimimizin
    // yanıtından geliyor → yazar ev sahibine düzeltilir (yalnız otomasyon yazılmış satır; başka yazar korunur).
    if (outcome.providerMessageId) {
      await prisma.message.updateMany({
        where: { conversationId: id, externalId: outcome.providerMessageId, authorType: "automation" },
        data: { authorType: "host", channelSenderRole: null, senderName: input.senderName, aiAssisted: input.aiAssisted },
      });
    }
    message = await prisma.message.findFirst({
      where: { conversationId: id, externalId: outcome.providerMessageId ?? undefined },
    });
    await completeStatus();
    await advanceLastMessageAt();
  }
  // Söz → görev OTOMATİK (kurucu 10-17 gece): teslim edilmiş ev sahibi mesajındaki söz HEMEN söz + görev olur (senkron turunu beklemez).
  // En iyi çaba: hata gönderimi etkilemez (mesaj zaten misafire ulaştı), sonraki senkron turu yeniden dener. Anahtar kapalıyken sorgusuz.
  // Saat: mesaj satırının zamanı `now`dan SONRA olabilir (satır işlemde yazıldı; ayrıca veritabanı saati) — eski `now` ile okuma yeni mesajı
  // "henüz yazılmamış" sayıp atlardı. En geç olan alınır.
  try {
    const at = new Date(Math.max(Date.now(), message?.createdAt?.getTime() ?? 0));
    await applyHostCommitmentsAuto(input.organizationId, id, at);
  } catch (err) {
    await reportError("commitment-auto-send", err);
  }
  return { status: "sent", message };
}

/**
 * Bu istek kimliğinin KUYRUK satırı varsa kuyruk yolunun tekilleştirme cevabı (içerik farklıysa çakışma), yoksa null. Kuyruk yolunun
 * kendi denetimiyle aynı ölçüt: gövde VE aiAssisted eşleşmeli (Codex r2 #3 + r3).
 */
async function queuedRequestResult(input: HostSendInput): Promise<HostSendResult | null> {
  const existing = await prisma.messageOutbox.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
    select: { body: true, messageId: true, status: true },
  });
  if (!existing) return null;
  const message = existing.messageId ? await prisma.message.findUnique({ where: { id: existing.messageId } }) : null;
  if (existing.body !== input.body || (message != null && message.aiAssisted !== input.aiAssisted)) return { status: "idempotency_conflict" };
  return { status: "queued", message, deduped: true, deliveryStatus: existing.status };
}
