import { prisma } from "@/lib/db";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";
import { suggestReply } from "@/lib/ai";
import { guestTurnLanguage } from "@/lib/ai/language-signal";
import { hostVoiceDraft } from "@/lib/ai/host-voice";
import { isClosingAck, isPositiveFeedback } from "@/lib/ai/fallback";
import {
  composeClosingCourtesy,
  closingCourtesyLanguage,
  passesAutoReplySafetyGate,
  semanticClosingHolds,
  automatedReplyNote,
  hostOfferForGate,
  type CourtesyKind,
} from "@/lib/automation";
import { badRequest, jsonOk, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { understandingRiskOf } from "@/lib/ai/semantic/intent-risk";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";
import {
  fillGuestPlaceholdersInItems,
  guestFirstNameOf,
  GUEST_NAME_FALLBACK,
} from "@/lib/kb-placeholders";

// ---------------------------------------------------------------------------
// AI reply PLAYGROUND — safe dry-run.
//
// POST { message, propertyId? } → runs the exact same suggestReply pipeline the
// inbox uses (real prompt + live model), against a typed test message and a
// chosen apartment's knowledge base. NOTHING is sent, NO conversation is
// created, NOTHING is written to the database. Pure read-only preview so the
// host can sanity-check the AI's behaviour without touching a real guest.
// ---------------------------------------------------------------------------

const TONES = ["warm", "formal", "short", "luxury"] as const;
type Tone = (typeof TONES)[number];

/**
 * Örnek rezervasyonun misafir adı. TEK SABİT: hem `suggestReply`a giden
 * `reservation.guestName` hem KB yer tutucularının hitabı buradan türer —
 * ikisi ayrı yazılırsa kart, kendi istemiyle çelişen bir cevap gösterir.
 */
const TEST_GUEST_NAME = "Test Misafir";

export const POST = withManage(async (session, req) => {
  // Paid AI feature: blocked once the trial lapses (dormant-safe until enforced).
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // Playground calls OpenAI ($). Throttle per user to cap spend on abuse.
  const limited = await rateLimit(`ai-test:${session.userId}`, 15, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = (await readJsonCappedOrNull(req)) as
    | { message?: unknown; propertyId?: unknown; tone?: unknown }
    | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return badRequest({ message: "Bir test mesajı yazın." });
  if (message.length > 4000) return badRequest({ message: "Mesaj çok uzun (en fazla 4000 karakter)." });

  const tone: Tone = TONES.includes(body?.tone as Tone) ? (body?.tone as Tone) : "warm";

  // Pick the requested apartment (must belong to the org) or fall back to the
  // org's first apartment, so the knowledge base is realistic.
  const property = await prisma.property.findFirst({
    where: {
      organizationId: session.organizationId,
      ...(typeof body?.propertyId === "string" && body.propertyId ? { id: body.propertyId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!property) return badRequest({ _: "Önce en az bir daire ekleyin." });

  // Tek yol `ai/kb-fetch.ts`. ÜRETİMLE PARİTE + maliyet tavanı: kardeş rotalar
  // bilgi tabanını KB_ITEM_CAP ile sınırlıyor, burada sınır YOKTU. İki sonucu
  // vardı: (1) test kartı gerçek misafir yanıtının görmediği bir bağlamla cevap
  // üretiyordu, yani "AI'yı Deneyin" üretimi yanlış temsil ediyordu; (2) istem
  // boyutunu KB içeriği belirlediği için çağrı başına maliyetin üst sınırı yoktu.
  // KOTA, DOĞRULAMADAN SONRA (denetim, 08-01). Eskiden gövde okunmadan ve
  // mülk kontrolünden önce tüketiliyordu: boş/geçersiz gövdeyle dakikada 15
  // istek atan biri, TEK bir model çağrısı üretmeden Başlangıç planının 150
  // birimini ~10 dakikada yakabiliyordu. Kota dolunca (kullanıcı kararı)
  // misafire giden oto-yanıt da durduğu için bu, panel tarafındaki bir
  // gürültüyü misafir mesajına çeviriyordu.
  const budget = await consumeDailyAiBudget(session.organizationId);
  if (!budget.ok) return tooManyRequests(budget.retryAfter, dailyBudgetMessage(budget));

  const { items: kbRaw, dropped: kbDropped } = await fetchKnowledgeBaseForPrompt({
    propertyId: property.id,
    isActive: true,
  });
  // 🚨 YER TUTUCU: ORTAK MODÜL, KENDİ REGEX'İ DEĞİL (Codex bulgu 17, ölçüldü).
  //
  // Burada eskiden iki elle yazılmış `replace` ve daire numarası için
  // `name.match(/\d+/g)?.pop()` vardı. O kural ortak modülde 09-11'de ÖLÇEREK
  // terk edilmişti; test rotası geride kalmıştı. Yedi gerçekçi ilan adının
  // YEDİSİ de ayrışıyordu — üçünde YANLIŞ numara ("No:12 D:5 Kat:3" → kat "3";
  // "DAİRE 5 - 2 Yatak Odalı" → yatak "2"; "Trabzon 4 Kişilik Daire" →
  // kapasite "4"), birinde `?? property.name` düşüşüyle MÜLK ADININ TAMAMI
  // ("Kapı kodu: Cozy Seaside Flat"). Ayrıca `{İSİM}` (noktalı İ) `/gi` ile
  // katlanmadığı için ÇÖZÜLMÜYOR ve yalnız `content` map'lendiği için BAŞLIK
  // ham belirteçle modele gidiyordu.
  //
  // Bu kartın TEK işi üretimi temsil etmek: host burada gördüğü cevaba bakıp
  // özelliği açıyor. Ayrışan bir önizleme, dayanaksız bir kalite onayıdır.
  // Hitap da `suggestReply`a verilen AYNI addan türer (↓ `TEST_GUEST_NAME`),
  // yoksa kart kendi içinde tutarsız olurdu.
  const kb = fillGuestPlaceholdersInItems(kbRaw, {
    guestFirstName: guestFirstNameOf(TEST_GUEST_NAME) ?? GUEST_NAME_FALLBACK,
    propertyName: property.name,
  });

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: {
      aiStyleProfile: true,
      aiSignature: true,
      autoClosingReplyEnabled: true,
      closingReplyText: true,
      lateCheckoutOfferText: true,
      autoReplyDisclosure: true,
      timezone: true,
      language: true,
    },
  });

  // Same pipeline as the inbox. We attach a SAMPLE reservation (today's
  // check-in at the chosen apartment) so reservation-aware questions ("which
  // apartment am I in?", "when is my check-out?") test realistically — exactly
  // as a real inbox conversation, which is always tied to a booking. The
  // result is only returned, never sent and never persisted.
  // RAG dilim 1 (09-09): üretimle PARİTE — test kartı da aynı seçiciden geçer
  // (bayrak kapalıyken kimlik: `kbSel.items === kb`).
  const now = new Date();
  // Örnek misafir DÜN girdi, çıkışa 3 gün var (konaklama sürüyor). 09-25 zaman bağlamı takvim günüyle çalışıyor: varış
  // "şimdi" olunca evre "Giriş BUGÜN" oluyordu — eski "şu an konaklamakta" çerçevesi ve 09-25 kıyası bozulmasın.
  const sampleStay = {
    arrivalDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    departureDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    status: "confirmed",
  };
  const kbSel = await retrieveKbForPrompt({
    items: kb,
    guestMessage: message,
    history: [],
    stayTimes: { checkIn: property.checkInTime, checkOut: property.checkOutTime },
    // Anlama katmanının tarih satırı (bayrak açıkken) — cevap modeliyle AYNI örnek konaklama.
    dateContext: { now, timeZone: org?.timezone, reservation: sampleStay },
  });

  const result = await suggestReply({
    guestMessage: message,
    property: {
      name: property.name,
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      address: property.address,
      city: property.city,
    },
    reservation: { guestName: TEST_GUEST_NAME, ...sampleStay },
    knowledgeBase: kbSel.items,
    knowledgeBaseDropped: kbDropped + kbSel.droppedItems,
    knowledgeBaseSelection: kbSel.selection,
    knowledgeBaseNotes: kbSel.notes,
    history: [],
    tone,
    language: "tr",
    // 🚨 STİL REHBERİ SÜZÜLEREK GEÇER — QR ve kanal yollarıyla PARİTE (08-09 (2)).
    // Rehber host'un KENDİ giden mesajlarından damıtılıyor; host bir gün misafire
    // "Kapı kodu 4590" yazdıysa o satır rehbere sızabilir ve prompt rehberi bir
    // CEVAP KAYNAĞI olarak sunuyor. Süzgeç SATIR bazlı: yalnız sırra benzeyen
    // satır düşer, üslup korunur — yani kayıp yok, çünkü rehber ÜSLUP içindir,
    // içerik değil. Üç yüzeyin üçü de artık aynı süzgeçten geçiyor.
    styleProfile: scrubStyleProfileForPublic(org?.aiStyleProfile),
    lateCheckoutOfferText: org?.lateCheckoutOfferText,
    timeZone: org?.timezone,
  });

  // The REAL auto-send verdict — the exact production gate (intent blocklist,
  // risk word-nets, injection veto, source + confidence), mirroring the landing
  // demo (#27). Drives both the "would auto-send" line on the card and whether
  // the disclosure note belongs in the preview.
  const understood = await kbSel.understanding;
  const gateInput = {
    intent: result.intent,
    riskLevel: result.riskLevel,
    confidence: result.confidence,
    source: result.source,
    riskType: result.riskType ?? null,
    // 🚨 PARİTE (09-11): `reply` VERİLMEZSE "bilgim yok" kuralı burada HİÇ
    // çalışmaz ve bu kart, gerçek göndericinin BLOKLADIĞI bir cevap için
    // "kendiliğinden gönderilirdi" der. Yukarıdaki "the exact production gate"
    // iddiası ancak bu alanla doğru (alan opsiyonel → derleme uyarmaz).
    reply: result.reply,
    // Şema beyanı (09-24) — gerçek kapıyla PARİTE; bekçi önizlemede koşmaz (bilinen fark, belgeli).
    stayChange: result.stayChange ?? null,
    // Saat kaynağı çelişkisi (P4-b kodda, 09-25) — gerçek kapıyla PARİTE ("gönderilirdi" dürüst kalsın).
    timeConflicts: result.timeConflicts ?? null,
    // Anlam yolunun kapanış itirazları (inceleme 09-25, P3) — kanalla PARİTE: modelin eksik bilgi / eylem önerisi varsa
    // önizleme de "cevap gerekmez" demez.
    missingInfo: result.missingInfo ?? null,
    actionSuggestion: result.actionSuggestion ?? null,
    // Eylem beyanı (MÇ §4, bayrak kapalıyken alan yok) — gerçek kapıyla PARİTE ("gönderilirdi" dürüst kalsın).
    claimedActions: result.claimedActions ?? null,
  };
  const gateCtx = {
    stayTimes: { checkIn: property.checkInTime, checkOut: property.checkOutTime },
    understanding: understood?.stay ?? null,
    // Anlama katmanının risk niyeti — gerçek kapıyla PARİTE ("gönderilirdi" dürüst kalsın).
    understandingRisk: understandingRiskOf(understood),
    hostOfferText: hostOfferForGate(org?.lateCheckoutOfferText),
  };
  const wouldAutoSend = passesAutoReplySafetyGate(gateInput, message, gateCtx);
  // Kapanışa sessizlik — anlam yolu (kurucu kuralı 09-25): gerçek kanalla AYNI yüklem. Önizleme de "bu mesaja cevap
  // gerekmez; hiçbir şey gönderilmez" desin (sözcük listesinin tanımadığı "Anladım" gibi kapanışlar).
  // Önizleme TEK mesajdır ve konuşmanın ORTASINDA yazılmış sayılır (önceki cevap var): gerçek kanalda ilk mesaj bir selamdır,
  // kapanış değil — o yol modele gider (`hasPriorReply`).
  const semanticClosing =
    !wouldAutoSend && semanticClosingHolds(gateInput, message, gateCtx, understood, [message], true);

  // PREVIEW PARITY: show EXACTLY what would leave the building. An AUTO-send
  // carries reply + machine-note + signature (same order as the real sender);
  // a manual/approval draft carries reply + signature only — the note never
  // rides host-reviewed messages, so it is previewed ONLY when the gate says
  // this message would truly go out on its own.
  const signature = org?.aiSignature?.trim();
  // Dipnot dili gerçek göndericiyle AYNI kuraldan (kodun dil tespiti önce, model beyanı yedek) — önizleme paritesi.
  const note = wouldAutoSend
    ? automatedReplyNote(guestTurnLanguage(message) ?? result.detectedLanguage, org?.autoReplyDisclosure ?? true)
    : null;
  // Gönderilmeyecek (taslak) cevap ev sahibinin sesiyle gösterilir — gelen kutusu önerisiyle aynı (`ai/host-voice.ts`);
  // otomatik gidecek cevap istemin dürüst devir kalıbıyla aynen. Kapı yukarıda ORİJİNAL metne baktı.
  const shown = wouldAutoSend ? result.reply : hostVoiceDraft(result.reply ?? "");
  const parts = [shown?.trimEnd() ?? ""];
  if (note) parts.push(note);
  if (signature) parts.push(signature);
  const reply = result.reply ? parts.join("\n\n") : result.reply;

  // TRANSPARENCY: on the real channel a PURE closing ("teşekkürler / 👍") never
  // gets the model draft above — it is either silently skipped or (opt-in)
  // answered with the one-line courtesy. Tell the card, and when the courtesy is
  // enabled, hand it the EXACT outgoing message (same composition as the real
  // send: custom-or-default text + machine note + signature) so the preview can
  // never drift from what the guest would actually receive.
  const closingKind: CourtesyKind | null = isClosingAck(message)
    ? "ack"
    : isPositiveFeedback(message)
      ? "praise"
      : null;
  const closingReplyEnabled = org?.autoClosingReplyEnabled ?? false;
  // Gerçek kanalla AYNI (inceleme 09-25, P1): teşekkür/onay SUSTURULUR; övgü yalnız nezaket cevabı açıkken o cevabı alır,
  // kapalıyken modele gider (övgü listesi soru işaretsiz soruyu da kabul ediyordu) — anlam yolu yine susturabilir.
  const lexicalClosing = closingKind === "ack" || (closingKind === "praise" && closingReplyEnabled);
  // Nezaket cevabı YALNIZ sözcük yolunda (gerçek kanalla aynı); anlam yolunda her zaman sessizlik.
  const closingReplyPreview =
    lexicalClosing && closingKind && closingReplyEnabled && org
      ? composeClosingCourtesy({
          kind: closingKind,
          lang: closingCourtesyLanguage(message, org.language),
          customText: org.closingReplyText,
          signature: org.aiSignature,
        })
      : null;

  return jsonOk({
    ...result,
    reply,
    property: property.name,
    wouldAutoSend,
    closingAck: lexicalClosing || semanticClosing, // backwards-compatible flag for the card
    closingKind: lexicalClosing ? closingKind : semanticClosing ? "ack" : null,
    closingSemantic: !lexicalClosing && semanticClosing,
    closingReplyEnabled,
    closingReplyPreview,
  });
});
