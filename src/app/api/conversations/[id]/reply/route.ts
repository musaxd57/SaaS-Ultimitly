import { NextResponse } from "next/server";
import { providerErrorMessageFromText } from "@/lib/provider-errors";
import { prisma } from "@/lib/db";
import { conversationReplySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { UNRECOGNIZED_FIELD_MESSAGE } from "@/lib/zod-tr";
import { sendHostMessage } from "@/lib/host-send";
import { deliveryOutcomeOfOutboxStatus } from "@/lib/outbox/state";
import { suggestionOperationKey } from "@/lib/outbox/operation-key";
import { createHash } from "crypto";
import { recordReplyDraftLink } from "@/lib/reply-draft/service";
import { reportError } from "@/lib/report-error";
import { INTERNAL_RECORD_CODE, INTERNAL_RECORD_NO_SEND_TEXT, isInternalRecord } from "@/lib/internal-record";

// Only owner/manager may send guest-facing replies (withManage). Staff are read +
// task updates; the inbound-message and status routes stay open for their triage.
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // Each reply sends to the channel. Throttle per conversation so a stuck client
  // or abuse can't spam the guest.
  // 🚨 ANAHTAR ORG KAPSAMLI (09-23, güvenlik ajanı): kota sahiplik kontrolünden ÖNCE
  // tüketiliyor ve anahtar yalnız konuşma kimliğiydi → BAŞKA bir kiracının kullanıcısı bu
  // kimlikle (404 alarak) istek atıp SAHİBİN cevap kotasını tüketebiliyordu. Org öneki
  // her kiracıya kendi kovasını verir; sıra (ucuz kota → DB) korunur.
  const limited = await rateLimit(`reply:${session.organizationId}:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      id: true,
      channel: true,
      guestIdentifier: true,
      externalReservationId: true,
    },
  });
  if (!conversation) return notFound();

  // 🚨 ALICISI OLMAYAN KAYDA CEVAP YAZILMAZ (kurucu 11-18 akşam: "'Gönder' yalnız gerçek bir alıcı varsa görünür"; `internal-record.ts`).
  // Eskiden hedefsiz (elle açılmış) konuşmaya yazılan cevap "kaydedildi, gönderilmedi" diye saklanıyordu — cevap gibi görünen ama kimseye
  // gitmeyen bir satır. Arayüz bu kayıtta yazma kutusu göstermez; eski sekmeden gelen istek açık bir ret alır ve HİÇBİR şey yazılmaz
  // (ekip kaydı için iç not var). Demo hesabı muaf (yüklemin içinde).
  if (isInternalRecord(conversation, session.organizationId)) {
    return NextResponse.json({ error: INTERNAL_RECORD_NO_SEND_TEXT, code: INTERNAL_RECORD_CODE }, { status: 409 });
  }

  const rawData = await readJsonCappedOrNull(req);
  const parsed = conversationReplySchema.safeParse(rawData);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  // 🚨 ÇEVİRİYLE GÖNDERİM KALDIRILDI (Codex 11-17 G3). Bu rota eskiden `translateTo` alanını kabul edip ev sahibinin metnini modele
  // çevirtiyor ve çıktıyı ÖNİZLEMESİZ, ev sahibinin kendi sözü gibi misafire gönderiyordu (çıktıya içerik denetimi yok; satır "ev sahibi
  // yazdı" diye kaydediliyor, söz algılayıcısı modelin eklediği cümleden görev açabiliyordu). Arayüzde bu alanı gönderen yok. Alan gelirse
  // istek REDDEDİLİR — sessizce yok saymak yanlış olurdu: istemci çevrildi sanıp çevrilmemiş metni gönderirdi (Codex #30'un fail-closed
  // ilkesi; 20 karakterden uzun değer eskiden tam da böyle yok sayılıyordu). Değere bakılmaz: alanın VARLIĞI reddedilir. Çeviri ileride
  // ürün olarak istenirse önizlemeli akışla gelir (çevir → ev sahibine göster → gösterilen metni gönder).
  if (rawData !== null && typeof rawData === "object" && Object.prototype.hasOwnProperty.call(rawData, "translateTo")) {
    return badRequest({ translateTo: UNRECOGNIZED_FIELD_MESSAGE });
  }

  // Credit AI-assisted approvals in reports: set by the client when the host
  // clicks "Onayla ve gönder" on an AI draft (vs typing a manual reply).
  const aiAssisted = rawData?.aiAssisted === true;

  const replyBody = parsed.data.body;

  // Teslim + kayıt TEK çekirdekten (`host-send.ts`; karar kartı da aynı yolu kullanır). Durum kodları ve metinler burada.
  // Kalıcı kuyruk tekilleştirme (Codex 07-23): istemcinin mesaj başına requestId'si öncelikli — çift tık ya da ağ yeniden
  // denemesi aynı kimliği kullanır, zaman kovası sınırına bölünemez. Yedek (eski istemci / kimlik yok): gövde özeti + 2 dk kova.
  const digest = createHash("sha256").update(parsed.data.body).digest("base64url").slice(0, 24);
  // 🚨 S1 (kurucu kararı 11-11): YAPAY ZEKÂ ÖNERİSİNİN ONAYI tek bir İŞLEMDİR — kimliği sekmenin ürettiği istek kimliği değil, "bu konuşma +
  // önerinin üretildiği andaki konuşma sonu"dur. İki yönetici aynı öneriyi ayrı sekmelerde (dakikalar arayla da) onaylarsa aynı kimliğe
  // düşer: tek mesaj gider, ikinci onay var olan gönderimin durumunu alır. Eskiden her sekme kendi kimliğini ürettiği için iki mesaj
  // gidiyordu (doğrudan yolda yalnız 2 dakikalık aynı-metin engeli vardı). Konuşma sonu istemciden gelir ama sunucu DOĞRULAR (bu konuşmanın
  // mesajı mı); elle yazılan cevap bu kuralın dışındadır (ev sahibi aynı mesaja bilerek ikinci cevap yazabilir).
  let operation: { anchorCreatedAt: Date } | undefined;
  let operationKey: string | null = null;
  if (aiAssisted && parsed.data.anchorMessageId) {
    const anchor = await prisma.message.findFirst({
      where: { id: parsed.data.anchorMessageId, conversationId: id },
      select: { id: true, createdAt: true },
    });
    if (!anchor) return badRequest({ anchorMessageId: "Geçersiz mesaj kimliği" });
    operation = { anchorCreatedAt: anchor.createdAt };
    operationKey = suggestionOperationKey(id, anchor.id);
  }
  const idempotencyKey =
    operationKey ??
    (parsed.data.requestId ? `manual:${id}:req:${parsed.data.requestId}` : `manual:${id}:${digest}:${Math.floor(Date.now() / 120_000)}`);
  const sent = await sendHostMessage({
    organizationId: session.organizationId,
    conversation,
    body: replyBody,
    claimBody: parsed.data.body,
    senderName: parsed.data.senderName || session.name,
    aiAssisted,
    idempotencyKey,
    strictIdempotency: Boolean(operationKey ?? parsed.data.requestId),
    ...(operation ? { operation } : {}),
  });
  // Taslak ↔ gönderilen metin bağı (kurucu 11-13, GÖLGE): gönderim BAŞARILI olduktan sonra, kendi try/catch'iyle — hatası gönderimin
  // sonucunu asla değiştirmez. Misafire giden metinle kıyaslanır; kodun kurduğu cevap ("code") kıyaslanmaz.
  const linkDraft = async (messageId: string | undefined) => {
    if (!messageId || parsed.data.draftUse === "code") return;
    try {
      await recordReplyDraftLink({
        organizationId: session.organizationId,
        conversationId: id,
        sentMessageId: messageId,
        sentBody: replyBody,
        draftUse: parsed.data.draftUse === "seeded" ? "seeded" : parsed.data.draftUse === "approved" || aiAssisted ? "approved" : null,
      });
    } catch (err) {
      void reportError("reply-draft.link", err);
    }
  };
  // Codex 11-17 C1: her BAŞARILI yanıt `delivery` taşır (kapalı küme `delivery-outcome.ts`) — HTTP kodu teslim demek değildir (kanala bağlı
  // olmayan konuşmanın kaydı da 201'dir). Arayüz duyuruyu bu alandan seçer; HTTP kodları ve mesaj alanları değişmedi (geriye uyum).
  switch (sent.status) {
    case "not_connected":
      return NextResponse.json(
        { error: "Kanal hesabınız bağlı değil — mesaj gönderilemiyor. Ayarlar'dan bağlantınızı kurun." },
        { status: 502 },
      );
    case "idempotency_conflict":
      // 409 = "id'yi yeniden üret" (client payload değişince zaten yeni UUID basar).
      return NextResponse.json(
        { error: "Bu istek kimliği farklı bir içerikle kullanılmış — lütfen tekrar gönderin." },
        { status: 409 },
      );
    case "queued":
      await linkDraft(sent.message?.id);
      // 202 = accepted/queued (NOT yet delivered — the UI shows "sıraya alındı"); a dedupe-hit is a 200 no-op (the identical
      // message is already queued/sent). `delivery` = kuyruk satırının ŞU ANKİ durumu (Codex 11-05): tekilleşen 200 "gönderildi"
      // demek DEĞİLDİR — arayüz duyuruyu HTTP kodundan değil bundan seçer.
      return NextResponse.json(
        {
          ...sent.message,
          delivery: deliveryOutcomeOfOutboxStatus(sent.deliveryStatus),
          outbox: { status: "queued", deduped: sent.deduped, delivery: sent.deliveryStatus },
        },
        { status: sent.deduped ? 200 : 202 },
      );
    case "duplicate":
    // S1: öneri üretildikten sonra konuşma cevaplanmış (başka bir yönetici onayladı / elle yazdı / yapay zekâ cevapladı) → gönderilmez.
    // Metin var olan cümle (yeni metin yok); istemci bu cevapta konuşmayı yeniler, güncel hâli görünür.
    case "already_answered":
      return NextResponse.json(
        { error: "Bu mesaj az önce gönderildi veya hâlâ gönderiliyor." },
        { status: 409 },
      );
    case "claim_unavailable":
      return NextResponse.json(
        { error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin." },
        { status: 503 },
      );
    case "failed_definitive":
      // 🚨 HAM SAĞLAYICI METNİ MÜŞTERİYE GİTMEZ (08-06): `providerErrorMessageFromText` aynı metni durum-özel bir Türkçe
      // cümleye çevirir; ham metin log/Sentry yolunda aynen durur.
      return NextResponse.json(
        {
          error: providerErrorMessageFromText(sent.error, "Mesaj gönderilemedi. Lütfen kısa bir süre sonra tekrar deneyin."),
        },
        { status: 502 },
      );
    case "failed_ambiguous":
      return NextResponse.json(
        { error: "Gönderim doğrulanamadı — mesaj ulaşmış olabilir. Tekrar göndermeden önce konuşmayı kontrol edin.", ambiguous: true },
        { status: 502 },
      );
    case "sent":
      await linkDraft(sent.message?.id);
      return jsonOk({ ...sent.message, delivery: "channel_accepted" }, 201);
    // Kanala çıkmadı, yalnız kaydedildi (hedefsiz konuşma ya da iç QR): kayıt yaratıldığı için 201; "gönderildi" iddiası `delivery`de değil.
    case "recorded":
      await linkDraft(sent.message?.id);
      return jsonOk({ ...sent.message, delivery: sent.delivery }, 201);
    default: {
      const unhandled: never = sent;
      throw new Error(`unhandled host send result: ${JSON.stringify(unhandled)}`);
    }
  }
});

