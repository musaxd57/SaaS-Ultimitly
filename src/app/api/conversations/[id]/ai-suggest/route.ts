import { prisma } from "@/lib/db";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";
import { aiSuggestSchema } from "@/lib/validators";
import { suggestReply } from "@/lib/ai";
import { hostVoiceDraft } from "@/lib/ai/host-voice";
import { getAdjacency } from "@/lib/turnover";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { GUEST_NAME_FALLBACK, fillGuestPlaceholdersInItems, guestFirstNameOf } from "@/lib/kb-placeholders";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";
import { loadConversationState } from "@/lib/ai/conversation-state-loader";
import { countPriorOperatorReplies } from "@/lib/operator-replies";
import { vetoAvailability } from "@/lib/ai/availability-claims";
import { availabilityPolicyFor, hostOfferForGate } from "@/lib/automation";
import { runEarlyCheckinWorkflow } from "@/lib/early-checkin/workflow";

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
    select: { aiStyleProfile: true, lateCheckoutOfferText: true, timezone: true },
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
    // Anlama katmanının tarih satırı (yalnız Konuşma Anlama Durumu bayrağı açıkken kullanılır).
    dateContext: { now: new Date(), timeZone: org?.timezone, reservation: conversation.reservation ?? null },
    history: conversation.messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
    })),
  });

  // SELAM TEKRARI — kanal oto-yanıtı ve QR ile AYNI kural (`countPriorOperatorReplies`). Bu yüzey alanı hiç vermiyordu;
  // taslak devam eden konuşmada da yeniden selamlıyordu.
  const priorOperatorReplies = await countPriorOperatorReplies(conversation.id);
  // Konuşma Anlama Durumu v1 dilim B (bayraklı; kapalıyken sorgu yok, istem aynı).
  const conversationRecords = await loadConversationState({
    organizationId: session.organizationId,
    messages: conversation.messages,
    reservationId: conversation.reservation?.id ?? null,
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
    conversationState: { isFirstOperatorReply: priorOperatorReplies === 0, records: conversationRecords },
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
    // "Bugün / yarın" ve konaklama evresi org diliminde (`stay-timeline.ts`) — kanal oto-yanıtıyla parite.
    timeZone: org?.timezone,
  });

  // TASLAK = EV SAHİBİNİN SESİ (09-25, `ai/host-voice.ts`): bu cevap misafire otomatik GİTMEZ, ev sahibi kendi adıyla
  // gönderir → istemin devir kalıbı ("ev sahibiniz görebilir") onun ağzına çevrilir. Aşağıdaki müsaitlik / erken giriş
  // kontrolleri ORİJİNAL metne bakar (erteleme tanıma o kalıba dayanır).
  const hostDraft = hostVoiceDraft(result.reply);
  await prisma.message.update({
    where: { id: lastInbound.id },
    data: {
      aiSuggestedReply: hostDraft,
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
  const guestTexts = unanswered.length > 0 ? unanswered : [lastInbound.body];
  const understood = await kbSel.understanding;
  const policy = availabilityPolicyFor(result, {
    stayTimes: { checkIn: conversation.property.checkInTime, checkOut: conversation.property.checkOutTime },
    understanding: understood?.stay ?? null,
    understandingFailed: (await kbSel.understandingStatus) === "failed",
    hostOfferText: hostOfferForGate(org?.lateCheckoutOfferText),
  });
  const availabilityCheck = vetoAvailability(result.reply, guestTexts, policy);

  // DOĞRULANMIŞ ERKEN GİRİŞ (09-24): istek yalnız erken girişse host'a kontrol listesi + (uygunsa) koddan kurulan
  // onay taslağı. Burada GÖNDERİLMEZ — host "Taslağı kullan" ile kendi gönderir. Bekçi burada koşmaz → saati iki
  // model okumadığı için "otomatik" olamaz; taslak yine doğrulanmış olgulardan kurulur.
  const run =
    availabilityCheck !== null
      ? await runEarlyCheckinWorkflow({
          organizationId: session.organizationId,
          propertyId: conversation.propertyId,
          reservationId: conversation.reservation?.id ?? null,
          now: new Date(),
          guestTexts,
          policy,
          understood,
          detectedLanguage: result.detectedLanguage,
        })
      : null;
  const earlyCheckin = run
    ? {
        status: run.decision.status,
        failed: run.decision.failed,
        approvedTime: run.decision.approvedTime,
        fee: run.decision.fee,
        mode: run.rule?.mode ?? "off",
        draft: run.draft,
        facts: {
          arrivalToday: run.facts.reservation?.arrivalKey === run.facts.todayKey,
          requestedTime: run.facts.requested.time,
          previousCheckout: run.facts.previousSameDay?.checkoutTime ?? null,
          readiness: run.facts.readiness,
          readinessNote: run.facts.readinessNote ?? "none",
          otherOverlaps: run.facts.otherOverlaps,
          previousNightVerifiedVacant: run.facts.previousNightVerifiedVacant,
          departureConfirmed: run.facts.departureConfirmed === true,
          openIssue: run.facts.openIssue === true,
          previousDeclaredCheckout: run.facts.previousDeclaredCheckout ?? null,
          cleaningStarted: run.facts.cleaningStarted === true,
        },
      }
    : null;

  return jsonOk({ ...result, reply: hostDraft, availabilityCheck, earlyCheckin });
});
