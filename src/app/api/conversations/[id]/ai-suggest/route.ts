import { prisma } from "@/lib/db";
import { namesInternalSource } from "@/lib/ai/absence";
import { kbForStayScopeRawAndFilled, styleProfileForPrompt } from "@/lib/guest-chat";
import { aiSuggestSchema } from "@/lib/validators";
import { suggestReply } from "@/lib/ai";
import { hostVoiceDraft } from "@/lib/ai/host-voice";
import { getAdjacency } from "@/lib/turnover";
import { badRequest, jsonOk, notFound, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { NextResponse } from "next/server";
import {
  aiSuggestExceedsLength,
  MESSAGE_TOO_LONG_SUGGEST_TEXT,
} from "@/lib/ai/message-length";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { modelGuestFirstName } from "@/lib/ai/code-greeting";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";
import { conversationStateWindowSufficient, loadConversationState } from "@/lib/ai/conversation-state-loader";
import { extendThread, readThreadTail, threadWindowSufficient } from "@/lib/channel-thread-window";
import { countPriorOperatorReplies } from "@/lib/operator-replies";
import { orgTimezone } from "@/lib/timezone";
import { historyAuthorOf, isAnsweringOutbound } from "@/lib/message-author";
import { kbFactsOf, vetoAvailability } from "@/lib/ai/availability-claims";
import { availabilityPolicyFor, hostOfferForGate } from "@/lib/automation";
import { runEarlyCheckinWorkflow } from "@/lib/early-checkin/workflow";
import { loadPromptInstructions } from "@/lib/history-learn/prompt-instructions";

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
    },
  });
  if (!conversation) return notFound();
  // MADDE 10 (kurucu talimatı bağlam sözleşmesi; kanal oto-yanıtıyla aynı okuyucu `channel-thread-window.ts`): sondan sayfa sayfa,
  // kesit her tüketiciye (istem / anlama / getirme / uzunluk kuralı / konuşma kayıtları) konuşmanın tamamıyla AYNI sonucu verecek
  // kadar. Hiç cevap yoksa konuşmanın tamamı okunur (güvenlik penceresi bütün cevapsız mesajları ister — doğru davranış). Kanalın
  // kapanış / açık iş koşulları burada gereksiz ama zararsızdır (okumayı yalnız uzatır; Haiku 10-12). Sıra `(createdAt, id)` (eşit damgada kesin; eskiden yalnız `createdAt`). Bu yüzeyde süzgeç
  // yok (taslak ev sahibine gider; kanal yolundaki teslim edilmemiş taslak / sondaki otomatik mesaj süzgeci burada uygulanmıyordu).
  let thread = await readThreadTail(conversation.id);
  while (!thread.complete && !(threadWindowSufficient(thread.rows) && conversationStateWindowSufficient(thread.rows))) {
    thread = await extendThread(conversation.id, thread);
  }
  const messages = thread.rows;

  const parsed = aiSuggestSchema.safeParse((await readJsonCappedOrNull(req)) ?? {});
  const tone = parsed.success ? parsed.data.tone : "warm";

  const lastInbound = [...messages]
    .reverse()
    .find((m) => m.direction === "inbound");
  if (!lastInbound) {
    return badRequest({ _: "Öneri üretmek için bir misafir mesajı gerekli" });
  }
  // K10-t (kurucu kararı 09-28): cevapsız misafir mesajlarından biri 8.000 karakteri aşarsa öneri üretilmez — model çağrısı
  // ve kota düşümü YOK, metin kırpılıp modele verilmez; panel bu açıklamayı gösterir (boş kalmaz). Cevap verilen mesajın
  // KENDİSİ de sayılır (09-28 inceleme): rota son GELEN mesaja cevap önerir; arkasından bir giden mesaj varsa o mesaj
  // "cevapsız" kümede değildir ama modele yine TAM gidiyordu.
  if (aiSuggestExceedsLength(messages)) {
    return NextResponse.json({ error: MESSAGE_TOO_LONG_SUGGEST_TEXT }, { status: 422 });
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
  const { items: kbFetched, dropped: kbDropped } = await fetchKnowledgeBaseForPrompt({
    propertyId: conversation.propertyId,
    isActive: true,
  });
  // Resolve any {isim}/{daire} placeholder (e.g. in the welcome template) before
  // the KB reaches the model, so a literal "{isim}" can never appear in the
  // suggestion. Single source: @/lib/kb-placeholders (four surfaces share it).
  // Inbox path: the counterpart IS the reservation holder → real first name.
  // #189: ikame SEÇİMDEN SONRA (`retrieveKbForPrompt` `placeholders`) — seçim ham metinle koşar, misafir adı parça metnini
  // misafire özgü yapıp anlamsal önbelleği soğutmaz. Legacy / geri çekilmede de sonuç kalemleri aynı değerlerle doldurulur.
  const kbPlaceholders = {
    // Anahtar kapalıyken yalnız AD biçimindeki baş kısım: görünen ad misafirin metnidir, ev sahibinin KB kalemine yerleşir.
    // Adsız yapay zekâ anahtarı açıkken HİÇBİR ad ("misafirimiz") — `modelGuestFirstName`.
    guestFirstName: modelGuestFirstName(conversation.guestIdentifier),
    propertyName: conversation.property.name,
  };
  // SIR KAPSAMI oto-yanıtla TEK kural (Codex 09-27): onaylı / tamamlanmış konaklama dışında Wi-Fi / giriş talimatı / kod içeren
  // kalem modele gitmez — taslak ev sahibinin elinden aday misafire gönderilebilir. Onaylı konaklamada verilir. İKİ AŞAMA (B3,
  // 09-27): HAM ve ad / daire yerleştirilmiş metin taranır ("Kapı: {daire}" + "Daire 4590" → "Kapı: 4590" yalnız ham taramayla
  // geçiyordu). Dönen kalemler ham hâlindedir.
  const kbRaw = kbForStayScopeRawAndFilled(kbFetched, conversation.reservation, kbPlaceholders);

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
  // bayrak kapalıyken kalemler aynı (yer tutucular doldurulmuş), `droppedItems === 0`.
  const kbSel = await retrieveKbForPrompt({
    items: kbRaw,
    placeholders: kbPlaceholders,
    guestMessage: lastInbound.body,
    stayTimes: { checkIn: conversation.property.checkInTime, checkOut: conversation.property.checkOutTime },
    redactNames: [conversation.guestIdentifier, conversation.reservation?.guestName, conversation.reservation?.guestGivenName],
    // Anlama katmanının tarih satırı (yalnız Konuşma Anlama Durumu bayrağı açıkken kullanılır).
    dateContext: { now: new Date(), timeZone: org?.timezone, reservation: conversation.reservation ?? null },
    // `at` (F14b): anlama katmanında yazıldığı an — öneri saatler sonra istenebilir; yalnız bayrakla görünür.
    // Yazar etiketi (K7, kurucu onayı 09-30; kanal yoluyla aynı — 10-12): otomatik şablon mesajı getirmenin alt sorgularında ve
    // anlama penceresinde CEVAP SAYILMAZ. Etiket yokken şablondan önceki cevapsız soru aranmıyordu.
    history: messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
      at: m.createdAt,
      author: historyAuthorOf(m),
    })),
  });

  // SELAM TEKRARI — kanal oto-yanıtı ve QR ile AYNI kural (`countPriorOperatorReplies`). Bu yüzey alanı hiç vermiyordu;
  // taslak devam eden konuşmada da yeniden selamlıyordu.
  const priorOperatorReplies = await countPriorOperatorReplies(conversation.id);
  // Konuşma Anlama Durumu v1 dilim B (bayraklı; kapalıyken sorgu yok, istem aynı).
  const conversationRecords = await loadConversationState({
    organizationId: session.organizationId,
    messages,
    reservationId: conversation.reservation?.id ?? null,
    conversationId: conversation.id,
    timeZone: orgTimezone(org?.timezone),
    // Kesit konuşmanın tamamı değilse kesit öncesi cevap toplamları veritabanında sayılır (madde 10).
    ...(thread.complete ? {} : { priorBefore: { row: thread.rows[0], excludedIds: [] } }),
  });

  const result = await suggestReply({
    breakerKey: session.organizationId,
    guestMessage: lastInbound.body,
    property: {
      name: conversation.property.name,
      guestDisplayName: conversation.property.guestDisplayName,
      checkInTime: conversation.property.checkInTime,
      checkOutTime: conversation.property.checkOutTime,
      address: conversation.property.address,
      city: conversation.property.city,
    },
    reservation: conversation.reservation
      ? {
          guestName: conversation.reservation.guestName,
          guestGivenName: conversation.reservation.guestGivenName,
          arrivalDate: conversation.reservation.arrivalDate,
          departureDate: conversation.reservation.departureDate,
          status: conversation.reservation.status,
          guestCheckoutTime: conversation.reservation.guestCheckoutTime,
          // Kişi / evcil hayvan sayıları (migration 86) — oto-yanıtla aynı bağlam.
          guestAdults: conversation.reservation.guestAdults,
          guestChildren: conversation.reservation.guestChildren,
          guestInfants: conversation.reservation.guestInfants,
          guestPets: conversation.reservation.guestPets,
        }
      : null,
    // Yalnız adsız yapay zekâ anahtarı açıkken, istem metninden adı silmek için (modele gitmez).
    guestIdentifier: conversation.guestIdentifier,
    knowledgeBase: kbSel.items,
    // Sır kapsamıyla elenen kalemler de "alınmadı" sayılır (oto-yanıtla aynı): model "bilgi yok" demez, devreder.
    knowledgeBaseDropped: kbDropped + (kbFetched.length - kbRaw.length) + kbSel.droppedItems,
    knowledgeBaseSelection: kbSel.selection,
    knowledgeBaseNotes: kbSel.notes,
    // Yazar + yazıldığı an (F14): istemde YALNIZ Konuşma Anlama Durumu bayrağı açıkken görünür. Öneri saatler/günler
    // sonra istenebilir → cevaplanan mesajın kendi zamanı da gider ("yarın" o güne göre).
    history: messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
      author: historyAuthorOf(m),
      at: m.createdAt,
    })),
    guestMessageAt: lastInbound.createdAt,
    conversationState: { isFirstOperatorReply: priorOperatorReplies === 0, records: conversationRecords },
    tone,
    language: lastInbound.language || "tr",
    // 🚨 STİL REHBERİ SÜZÜLEREK GEÇER — QR ve kanal yollarıyla PARİTE (08-09 (2)).
    // Rehber host'un KENDİ giden mesajlarından damıtılıyor; host bir gün misafire
    // "Kapı kodu 4590" yazdıysa o satır rehbere sızabilir ve prompt rehberi bir
    // CEVAP KAYNAĞI olarak sunuyor. Süzgeç SATIR bazlı: yalnız sırra benzeyen
    // satır düşer, üslup korunur — yani kayıp yok, çünkü rehber ÜSLUP içindir,
    // içerik değil. Üç yüzeyin üçü de artık aynı süzgeçten geçiyor.
    styleProfile: styleProfileForPrompt(org?.aiStyleProfile),
    hostInstructions: await loadPromptInstructions(session.organizationId, conversation.propertyId),
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
  // Otomatik şablon mesajı (K7) cevap değildir: pencereyi kapatmaz.
  const lastOut = messages.findLastIndex((m) => isAnsweringOutbound(m));
  const unanswered = messages
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
    // Modelin gördüğü bilgi tabanı (24 EK): yazılı sabit otopark yeri tahsisi takvim iddiası sayılmaz — kapıyla parite.
    kbFacts: kbFactsOf(kbSel.items),
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

  // Kurucu 10-22 ("bilgi tabanıyla ilgili … hiçbir şey müşteriye gitmemeli"; Opus 10-22): taslak bilginin kaynağını anlatıyorsa ev sahibi
  // tek tıkla göndermeden önce uyarıyı görür (otomatik gönderim kapısıyla aynı yüklem).
  const internalSourceCheck = namesInternalSource(hostDraft);
  return jsonOk({ ...result, reply: hostDraft, availabilityCheck, earlyCheckin, internalSourceCheck });
});
