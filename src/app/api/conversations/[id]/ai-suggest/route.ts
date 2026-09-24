import { prisma } from "@/lib/db";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";
import { aiSuggestSchema } from "@/lib/validators";
import { suggestReply } from "@/lib/ai";
import { getAdjacency } from "@/lib/turnover";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { GUEST_NAME_FALLBACK, fillGuestPlaceholdersInItems, guestFirstNameOf } from "@/lib/kb-placeholders";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";
import { vetoAvailability } from "@/lib/ai/availability-claims";
import { availabilityPolicyFor, hostOfferForGate } from "@/lib/automation";

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // Paid AI feature: blocked once the trial lapses (dormant-safe until enforced).
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // Each suggestion calls OpenAI ($). Throttle per user to cap spend on abuse.
  const limited = await rateLimit(`ai-suggest:${session.userId}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  // (Günlük org bütçesi BİLEREK burada DEĞİL — org kapsamı ve mesaj
  // doğrulamasından sonra tüketiliyor, ↓aşağıda. 08-01'de taşındı; taşımadan
  // kalan yetim yorum 08-05'te silindi ki kimse buraya çağrıyı "geri
  // koymasın".)
  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    include: {
      property: true,
      reservation: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) return notFound();

  const parsed = aiSuggestSchema.safeParse((await readJsonCappedOrNull(req)) ?? {});
  const tone = parsed.success ? parsed.data.tone : "warm";

  const lastInbound = [...conversation.messages]
    .reverse()
    .find((m) => m.direction === "inbound");
  if (!lastInbound) {
    return badRequest({ _: "Öneri üretmek için bir misafir mesajı gerekli" });
  }

  // KOTA, ORG KAPSAMI VE MESAJ DOĞRULAMASINDAN SONRA (denetim, 08-01).
  // Eskiden en başta tüketiliyordu: org içindeki bir kullanıcı, 404 dönen ya
  // da boş konuşma id'leriyle dakikada 20 istek atarak sahibin günlük kotasını
  // TEK bir model çağrısı üretmeden bitirebiliyordu. Kota dolunca misafire
  // giden oto-yanıt da durduğu için bu, iç bir gürültüyü misafir kaybına
  // çeviriyordu.
  const budget = await consumeDailyAiBudget(session.organizationId);
  if (!budget.ok) return tooManyRequests(budget.retryAfter, dailyBudgetMessage(budget));

  // Tek yol `ai/kb-fetch.ts`: tavan + kaç kalemin düştüğü oradan gelir.
  const { items: kbRaw, dropped: kbDropped } = await fetchKnowledgeBaseForPrompt({
    propertyId: conversation.propertyId,
    isActive: true,
  });
  // Resolve any {isim}/{daire} placeholder (e.g. in the welcome template) before
  // the KB reaches the model, so a literal "{isim}" can never appear in the
  // suggestion. Single source: @/lib/kb-placeholders (four surfaces share it).
  // Inbox path: the counterpart IS the reservation holder → real first name.
  const kb = fillGuestPlaceholdersInItems(kbRaw, {
    guestFirstName: guestFirstNameOf(conversation.guestIdentifier) ?? GUEST_NAME_FALLBACK,
    propertyName: conversation.property.name,
  });

  // Same learned style profile the auto-reply pass uses, for consistent voice.
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { aiStyleProfile: true, lateCheckoutOfferText: true },
  });

  // Turnover context (neighbouring bookings) for early-checkin/late-checkout.
  const adjacency = conversation.reservation
    ? await getAdjacency(
        conversation.propertyId,
        conversation.reservation.arrivalDate,
        conversation.reservation.departureDate,
      )
    : null;

  // RAG dilim 1 (09-09): SORUYA GÖRE SEÇİM — oto-yanıt ve QR ile aynı seçici,
  // bayrak kapalıyken kimlik (`kbSel.items === kb`, `droppedItems === 0`).
  const kbSel = await retrieveKbForPrompt({
    items: kb,
    guestMessage: lastInbound.body,
    stayTimes: { checkIn: conversation.property.checkInTime, checkOut: conversation.property.checkOutTime },
    redactNames: [conversation.guestIdentifier, conversation.reservation?.guestName],
    history: conversation.messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
    })),
  });

  const result = await suggestReply({
    guestMessage: lastInbound.body,
    property: {
      name: conversation.property.name,
      checkInTime: conversation.property.checkInTime,
      checkOutTime: conversation.property.checkOutTime,
      address: conversation.property.address,
      city: conversation.property.city,
    },
    reservation: conversation.reservation
      ? {
          guestName: conversation.reservation.guestName,
          arrivalDate: conversation.reservation.arrivalDate,
          departureDate: conversation.reservation.departureDate,
          status: conversation.reservation.status,
          guestCheckoutTime: conversation.reservation.guestCheckoutTime,
        }
      : null,
    knowledgeBase: kbSel.items,
    knowledgeBaseDropped: kbDropped + kbSel.droppedItems,
    knowledgeBaseSelection: kbSel.selection,
    knowledgeBaseNotes: kbSel.notes,
    history: conversation.messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
    })),
    tone,
    language: lastInbound.language || "tr",
    // 🚨 STİL REHBERİ SÜZÜLEREK GEÇER — QR ve kanal yollarıyla PARİTE (08-09 (2)).
    // Rehber host'un KENDİ giden mesajlarından damıtılıyor; host bir gün misafire
    // "Kapı kodu 4590" yazdıysa o satır rehbere sızabilir ve prompt rehberi bir
    // CEVAP KAYNAĞI olarak sunuyor. Süzgeç SATIR bazlı: yalnız sırra benzeyen
    // satır düşer, üslup korunur — yani kayıp yok, çünkü rehber ÜSLUP içindir,
    // içerik değil. Üç yüzeyin üçü de artık aynı süzgeçten geçiyor.
    styleProfile: scrubStyleProfileForPublic(org?.aiStyleProfile),
    adjacency,
    lateCheckoutOfferText: org?.lateCheckoutOfferText,
  });

  await prisma.message.update({
    where: { id: lastInbound.id },
    data: {
      aiSuggestedReply: result.reply,
      aiConfidence: result.confidence,
      aiIntent: result.intent,
    },
  });

  // MÜSAİTLİK UYARISI (09-24): otomatik gönderimi durduran yüklemin AYNISI, aynı girdiyle (son giden
  // mesajdan sonraki cevapsız misafir mesajları; host zaten yazdıysa son misafir mesajı). Taslak
  // takvim iddiası taşıyorsa ya da müsaitlik isteğini ertelemiyorsa host onaylamadan önce görür —
  // yoksa oto-gönderimin durdurduğu iddiayı host tek tıkla misafire gönderebilirdi.
  const lastOut = conversation.messages.map((m) => m.direction).lastIndexOf("outbound");
  const unanswered = conversation.messages
    .slice(lastOut + 1)
    .filter((m) => m.direction === "inbound")
    .map((m) => m.body);
  // Politika girdisi kapıyla AYNI kurucudan (`availabilityPolicyFor`): modelin şema beyanı + mülkün
  // standart saatleri. Bekçi burada KOŞMAZ (host zaten okuyor; ek model çağrısı maliyetine değmez).
  const availabilityCheck = vetoAvailability(
    result.reply,
    unanswered.length > 0 ? unanswered : [lastInbound.body],
    availabilityPolicyFor(result, {
      stayTimes: { checkIn: conversation.property.checkInTime, checkOut: conversation.property.checkOutTime },
      understanding: (await kbSel.understanding)?.stay ?? null,
      understandingFailed: (await kbSel.understandingStatus) === "failed",
      hostOfferText: hostOfferForGate(org?.lateCheckoutOfferText),
    }),
  );

  return jsonOk({ ...result, availabilityCheck });
});
