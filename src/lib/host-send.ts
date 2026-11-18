import "server-only";

import type { Message } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { sendOnChannel, isDefinitiveSendFailure } from "@/lib/messaging";
import { resolveOrgChannelCredential, resolveOutboundRoute, deliveryOutcomeOfRoute } from "@/lib/channels";
import type { LocalDeliveryOutcome } from "@/lib/delivery-outcome";
import {
  claimOutboundSend,
  releaseOutboundSend,
  claimOutboundRequest,
  releaseOutboundRequest,
  extendOutboundRequest,
  newClaimOwner,
} from "@/lib/outbound-claim";
import { durableOutboxEnabledFor } from "@/lib/outbox/flag";
import { enqueueOutbound, SupersededRowRevivedError } from "@/lib/outbox/enqueue";
import { kickOutboxDrain } from "@/lib/outbox/worker";
import { applyHostCommitmentsAuto } from "@/lib/guest-commitments-auto";
import { reportError } from "@/lib/report-error";
import { notAutomationMessageWhere } from "@/lib/message-author";
import { undeliveredOutboundIds } from "@/lib/operator-replies";
import { operationRetryKey } from "@/lib/outbox/operation-key";

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
  /**
   * S1 (kurucu kararı 11-11): anahtar bir İŞLEMİN kimliği (yapay zekâ önerisinin onayı: konuşma + önerinin üretildiği andaki konuşma sonu).
   * Aynı işlem ikinci kez gelirse — başka yöneticiden, başka sekmeden, bir iki kelimesi farklı bir öneri metniyle de olsa — yeni gönderim
   * AÇILMAZ: var olan gönderimin durumu döner (içerik farkı "çakışma" sayılmaz; ilk onay geçerlidir). `anchorCreatedAt` o konuşma sonunun
   * anı: ondan SONRA gerçek bir cevap yazılmışsa (başka biri cevapladı, yapay zekâ cevapladı) öneri artık geçersizdir → gönderilmez.
   */
  operation?: { anchorCreatedAt: Date };
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
  /** S1: önerinin üretildiği andan sonra konuşmaya gerçek bir cevap yazılmış — öneri geçersiz, hiçbir şey gönderilmedi. */
  | { status: "already_answered" }
  /** Çift gönderim kalkanı okunamadı. */
  | { status: "claim_unavailable" }
  /** Kanal KESİN reddetti (hiçbir şey teslim edilmedi; kalkan bırakıldı, aynı metin hemen yeniden denenebilir). */
  | { status: "failed_definitive"; error: string | undefined }
  /** Sonuç BELİRSİZ (zaman aşımı / ağ / 5xx): mesaj ulaşmış OLABİLİR, kalkan tutulur. */
  | { status: "failed_ambiguous" }
  /**
   * Kanal KABUL etti ve kaydedildi (`message` yalnız eşzamanlı senkronun satırı bulunamazsa null — teslim yine gerçekleşti). Yalnız dış
   * kanala giden gönderim (Codex 11-17 C1: eskiden kanala hiç gitmeyen cevap da "sent" dönüyordu).
   */
  | { status: "sent"; message: Message | null }
  /**
   * Dış kanal YOK — yalnız kaydedildi (Codex 11-17 C1). `local_only`: hedefi olmayan (elle açılmış) konuşma, misafire hiçbir kanaldan
   * gitmedi; `qr_visible`: iç QR sohbeti, misafir sohbet sayfasında görür. Kayıt, konuşma durumu ve söz → görev bugünkü "sent" yoluyla
   * BİREBİR aynı (ürün kararı S-1…S-4 bekliyor); değişen yalnız dışarıya taşınan sonuç.
   */
  | { status: "recorded"; message: Message | null; delivery: LocalDeliveryOutcome };

export async function sendHostMessage(rawInput: HostSendInput): Promise<HostSendResult> {
  // S1: işlem kimlikli onayda anahtar, işlemin ŞU ANKİ gönderimine çözülür (önceki gönderim misafire kesinlikle ulaşmadıysa yenisi).
  const resolved = rawInput.operation ? await currentOperation(rawInput.organizationId, rawInput.idempotencyKey) : null;
  const input: HostSendInput = resolved ? { ...rawInput, idempotencyKey: resolved.key } : rawInput;
  const { conversation } = input;
  const id = conversation.id;
  // Deliver on the guest's channel FIRST — don't persist a reply that never reached the guest (Airbnb/Booking via Hospitable,
  // or WhatsApp). Use this org's own Hospitable token (multi-tenant). Internal QR-concierge threads have no external channel,
  // so they don't need (and must not require) a Hospitable connection — the reply is just recorded.
  // Rota BİR KEZ çözülür (Codex 11-17 C1): dış kanala çıkmayacak gönderimin sonucu ("kaydedildi") buradan belli olur — `sendOnChannel` aynı
  // saf çözümle `skipped` döner, ama o alan "QR mi, hedef yok mu" ayrımını taşımaz.
  const localDelivery = deliveryOutcomeOfRoute(resolveOutboundRoute(conversation));
  const isInternal = localDelivery === "qr_visible";
  const token = (await resolveOrgChannelCredential(input.organizationId))?.token ?? null;
  if (!isInternal && conversation.externalReservationId && !token) return { status: "not_connected" };
  // Bu DENEMENİN jetonu (mesaj M1, Codex 11-10): aldığı talepleri yalnız kendisi bırakır / uzatır — süresi dolmuş eski bir denemenin geç
  // temizliği, aynı metni / isteği almış yeni denemenin talebini silemez.
  const attempt = newClaimOwner();

  // ── Durable Outbox (flag ON): record the Message + its send INTENT atomically and let the worker deliver it, instead of the
  // synchronous deliver-then-persist below. Falls through to the proven claim-then-send when the flag is OFF (default) or the
  // thread is internal (nothing to deliver). ──
  if (durableOutboxEnabledFor(input.organizationId) && !isInternal && conversation.externalReservationId) {
    // 🚨 Codex 11-05 (43fb93e incelemesi P2): istek kimliği iki yolda da AYNI talebe bağlanır (`claimOutboundRequest`). Bu kimlikle
    // DOĞRUDAN gönderim yapıldıysa / sürüyorsa (anahtar iki deneme arasında açıldı) kuyruğa ikinci kopya yazılmaz. Önceki kuyruk denemesinin
    // talebi engel değildir — kuyruk satırı anahtarla zaten tekilleşir (aşağıdaki içerik denetimi dahil).
    let ownRequestClaim = false;
    if (input.strictIdempotency) {
      const req = await claimOutboundRequest(id, input.idempotencyKey, "queue", attempt);
      if (req.result === "unavailable") return { status: "claim_unavailable" };
      if (req.result === "held" && req.by !== "queue") return { status: "duplicate" };
      ownRequestClaim = req.result === "claimed";
    }
    // Kuyruk yolu gövde (metin) talebi ALMAZ — bilinçli (Codex 07-23 kararı, testle pinli): niyet istemcinin istek kimliğindedir; farklı
    // kimlikle gelen aynı metin ev sahibinin BİLEREK yaptığı ikinci gönderimdir. (İki ekip üyesinin aynı taslağı aynı anda onaylaması
    // ayrı kimlik taşır → iki mesaj; bunun nasıl ele alınacağı kurucu sorusu — `docs/INCELEME-2026-11-11-codex-bulgulari.md` M1.)
    // S1: işlem kimlikli onay — bu işlemin kuyruk satırı zaten varsa onun durumu döner; yoksa ve konuşma bu arada cevaplanmışsa yeni
    // gönderim açılmaz. (İki eşzamanlı onay ikisi de buradan geçerse kuyruğun tekil anahtarı birini tekilleştirir — aşağıda.)
    if (input.operation) {
      const existing = await queuedRequestResult(input);
      if (existing) {
        if (ownRequestClaim) await releaseOutboundRequest(id, input.idempotencyKey, attempt);
        return existing;
      }
      if (await repliedSince(id, input.operation.anchorCreatedAt)) {
        if (ownRequestClaim) await releaseOutboundRequest(id, input.idempotencyKey, attempt);
        return { status: "already_answered" };
      }
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
        ...(resolved?.supersedes ? { supersedes: resolved.supersedes } : {}),
      });
    } catch (err) {
      // Kuyruğa yazılamadı → hiçbir şey gönderilmeyecek: talep tutulursa (anahtar kapanınca) doğrudan yolun yeniden denemesi 24 sa kilitlenirdi.
      if (ownRequestClaim) await releaseOutboundRequest(id, input.idempotencyKey, attempt);
      // S1: yerine yenisini açacağımız "gönderilemedi" satırı tam bu arada elle yeniden kuyruğa alındı → işlemin gönderimi YİNE o satır.
      // Yeni satır açılmadı; işlemin güncel gönderiminin durumu döner (ikinci mesaj yok).
      if (err instanceof SupersededRowRevivedError) {
        const current = await currentOperation(rawInput.organizationId, rawInput.idempotencyKey);
        return (await queuedRequestResult({ ...input, idempotencyKey: current.key })) ?? { status: "duplicate" };
      }
      throw err;
    }
    // (Codex r2 #3 + r3) İstek kimlikli dedupe-hit'te PAYLOAD eşleşmesi ŞART — gövde VE aiAssisted: aynı kimliği farklı gövdeyle
    // kullanmak yeni mesajı YUTAR; aynı gövde + farklı aiAssisted ise AI-kredisi metriğini yanlış bırakır.
    let deliveryStatus = "pending";
    if (enq.deduped) {
      const existing = await prisma.messageOutbox.findUnique({ where: { id: enq.outboxId }, select: { body: true, messageId: true, status: true } });
      deliveryStatus = existing?.status ?? "pending";
      // İşlem kimliğinde içerik farkı çakışma DEĞİLDİR (S1): ikinci onayın metni gönderilmez, ilk gönderimin durumu döner.
      if (input.strictIdempotency && !input.operation) {
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
  const claimed = await claimOutboundSend(id, input.claimBody, attempt);
  if (claimed === "duplicate") return { status: "duplicate" };
  if (claimed === "unavailable") return { status: "claim_unavailable" };
  // İstek kimliği talebi (`claimOutboundRequest`): aynı kimlikle ikinci gönderim / kuyruk satırı oluşmaz — yanıtı kaybolan başarılı gönderimin
  // geç tekrarı ve araya giren anahtar değişikliği dahil.
  if (input.strictIdempotency) {
    const req = await claimOutboundRequest(id, input.idempotencyKey, "direct", attempt);
    if (req.result !== "claimed") {
      await releaseOutboundSend(id, input.claimBody, attempt);
      // Başka bir deneme (doğrudan ya da eşzamanlı kuyruk denemesi) bu kimliği tutuyor → "az önce gönderildi / hâlâ gönderiliyor".
      return req.result === "unavailable" ? { status: "claim_unavailable" } : { status: "duplicate" };
    }
  }
  // S1: işlem kimlikli onay — talepler alındıktan SONRA (eşzamanlı iki onay ikisi birden geçemesin) konuşma bu arada cevaplanmış mı diye
  // bakılır. Cevaplandıysa (ilk onay 24 saatten eskiyse talebi düşmüş olabilir; ya da başka biri elle / yapay zekâ cevapladı) gönderilmez.
  if (input.operation && (await repliedSince(id, input.operation.anchorCreatedAt))) {
    await releaseOutboundSend(id, input.claimBody, attempt);
    await releaseOutboundRequest(id, input.idempotencyKey, attempt);
    return { status: "already_answered" };
  }
  // Fırlatılan hata / çöken süreç BELİRSİZDİR: iki talep de doğduğu 2 dk'da kalır (uzatma yalnız kesin başarıda).
  const outcome = await sendOnChannel(conversation, input.body, token ?? undefined);
  if (!outcome.ok) {
    // DEFINITIVE provider rejection (HTTP 4xx incl. 429; not 408) → nothing was delivered → release so the same text is
    // retryable now. Anything else (timeout / network / 5xx) is AMBIGUOUS — the message MAY have reached the guest despite the
    // error — so the claim stays held for its TTL and the caller tells the user to CHECK the thread before resending.
    if (isDefinitiveSendFailure(outcome.error)) {
      await releaseOutboundSend(id, input.claimBody, attempt);
      if (input.strictIdempotency) await releaseOutboundRequest(id, input.idempotencyKey, attempt);
      return { status: "failed_definitive", error: outcome.error };
    }
    // Belirsiz: istek talebi doğduğu 2 dk'da kalır — "kontrol edip yeniden gönder" penceresi eskisi gibi.
    // 🚨 İşlem kimlikli onayda (S1, Opus incelemesi 11-11) talep başarıdaki gibi UZATILIR: mesaj ulaşmış olabilir ve senkron onu henüz
    // içeri almamış (ya da kanal rolüyle "otomatik mesaj" yazmış) olabilir — o durumda "konuşma cevaplandı mı" kontrolü onu görmez ve
    // ikinci yöneticinin 2 dakika sonraki onayı aynı öneriyi körlemesine yeniden gönderirdi. "Onayla ve gönder" bu işlem için kapanır;
    // ev sahibi konuşmayı kontrol edip gerekirse metni kutuya alarak (ayrı, açık işlem) yeniden gönderir.
    if (input.operation) await extendOutboundRequest(id, input.idempotencyKey, attempt);
    return { status: "failed_ambiguous" };
  }
  // KESİN başarı: istek talebi 24 saate uzar (yanıtı kaybolan başarılı gönderimin geç tekrarı ikinci mesaj olmaz). Uzatılamazsa bir kez daha
  // denenir; yine olmazsa raporlanır — delik görünür olsun (Opus 11-05 N5).
  if (input.strictIdempotency) {
    const extended = (await extendOutboundRequest(id, input.idempotencyKey, attempt)) || (await extendOutboundRequest(id, input.idempotencyKey, attempt));
    if (!extended) void reportError("host-send.extend-request-claim", new Error("request claim not extended after confirmed delivery"));
  }

  // Başarılı yolun sonucu: dış kanal kabul ettiyse "sent", hiç kanala çıkmadıysa "recorded" (C1).
  const deliveredResult = (message: Message | null): HostSendResult =>
    localDelivery ? { status: "recorded", message, delivery: localDelivery } : { status: "sent", message };
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
          // Cevabın "yazıldığı an" = gönder'e basılan an (mesaj A25, Codex 11-10): satır teslimden SONRA yazılıyor, zamanı kayıt anı oluyordu →
          // gönderim sürerken içeri alınan misafir mesajı (ev sahibi onu görmeden yazdı) satır sırasında cevaptan önce düşüp sonraki senkronda
          // "Cevaplandı" sayılıyordu (`lateGuestMessages` içeri alınma anını cevabın zamanıyla kıyaslar).
          createdAt: pressedAt,
        },
      }),
      completeStatus(),
      advanceLastMessageAt(),
    ]);
  } catch (err) {
    // 🚨 Opus 11-05 N5: teslim KESİN — sonraki kayıt hatası "tekrar deneyin" (500) gibi görünmemeli. Ev sahibi aynı kimlikle birkaç dakika
    // sonra yeniden basardı; talepler 2 dk'da düşmüşse (uzatma da aynı arızada yazılamamış olabilir) misafire İKİNCİ mesaj giderdi ("çift
    // mesaj, nadir sessiz kayıptan kötüdür"). Hata raporlanır, sonuç "gönderildi" — satır sonraki senkronla sağlayıcıdan gelir.
    if (!isUniqueViolation(err, ["conversationId", "externalId"])) {
      void reportError("host-send.persist-after-delivery", err);
      return deliveredResult(null);
    }
    // Delivery already succeeded; a dedupe-hit on the new @@unique([conversationId, externalId]) means a concurrent sync
    // imported this very reply first. Adopt the existing row and still mark answered.
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
  return deliveredResult(message);
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
  // İşlem kimliğinde (S1) içerik farkı çakışma değildir: ilk onayın gönderimi geçerlidir, durumu döner.
  if (!input.operation && (existing.body !== input.body || (message != null && message.aiAssisted !== input.aiAssisted))) return { status: "idempotency_conflict" };
  return { status: "queued", message, deduped: true, deliveryStatus: existing.status };
}

/**
 * Konuşmaya `since` anından SONRA gerçek bir cevap yazılmış mı (giden, otomatik şablon mesajı değil — karşılama / giriş / çıkış mesajı cevap
 * sayılmaz; yapay zekânın ve ekibin cevabı, kuyruktaki bekleyen cevap sayılır). Kuyrukta misafire KESİNLİKLE ulaşmamış (başarısız / iptal /
 * engellenmiş) mesaj cevap DEĞİLDİR — `operator-replies.ts` ile aynı kural (talimat 09-07 §5). S1: önerinin üretildiği andan sonra
 * konuşma cevaplandıysa o önerinin onayı gönderilmez.
 */
async function repliedSince(conversationId: string, since: Date): Promise<boolean> {
  const undelivered = await undeliveredOutboundIds(conversationId);
  const reply = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "outbound",
      createdAt: { gt: since },
      ...notAutomationMessageWhere(),
      ...(undelivered.length > 0 ? { id: { notIn: undelivered } } : {}),
    },
    select: { id: true },
  });
  return reply !== null;
}

/** Bir işlemin en çok bu kadar yeniden denemesi izlenir (her biri bir önceki "gönderilemedi" satırından türer). */
const OPERATION_RETRY_CHAIN_MAX = 20;

/**
 * S1: işlem kimliğinin ŞU ANKİ gönderim anahtarı (+ türediği satır). Bu işlemin kuyruktaki gönderimi misafire KESİNLİKLE ulaşmadıysa (başarısız / iptal)
 * öneri yeniden onaylanabilir — doğrudan yoldaki "kesin ret işlemi kilitlemez" kuralının kuyruk karşılığı. Yeni anahtar o satırdan
 * türer: iki yönetici aynı yeniden denemede yine AYNI anahtara düşer (tek mesaj). Bekleyen, gönderilmiş, sonucu doğrulanamayan ya da
 * abonelik yüzünden bekleyen ("engellendi" — kendiliğinden yeniden gider) gönderim yeniden denenmez: anahtar onun kalır, durumu döner.
 * Kuyruk hiç kullanılmadıysa tek indeksli okuma, sonuç taban anahtar.
 */
async function currentOperation(organizationId: string, baseKey: string): Promise<{ key: string; supersedes: string | null }> {
  let key = baseKey;
  // Anahtarın türediği satır (misafire ulaşmamış son gönderim): kuyruğa yazarken kilitlenip yeniden doğrulanır (`enqueueOutbound`).
  let supersedes: string | null = null;
  for (let i = 0; i < OPERATION_RETRY_CHAIN_MAX; i++) {
    const row = await prisma.messageOutbox.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: key } },
      select: { id: true, status: true },
    });
    if (!row || (row.status !== "failed" && row.status !== "canceled")) return { key, supersedes };
    key = operationRetryKey(baseKey, row.id);
    supersedes = row.id;
  }
  return { key, supersedes };
}
