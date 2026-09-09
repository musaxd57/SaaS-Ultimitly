import { prisma } from "@/lib/db";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";
import { suggestReply } from "@/lib/ai";
import { isClosingAck, isPositiveFeedback } from "@/lib/ai/fallback";
import {
  composeClosingCourtesy,
  closingCourtesyLanguage,
  passesAutoReplySafetyGate,
  automatedReplyNote,
  type CourtesyKind,
} from "@/lib/automation";
import { badRequest, jsonOk, tooManyRequests, paymentRequired, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";

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
  const aptNumber = property.name.match(/\d+/g)?.pop() ?? property.name;
  const kb = kbRaw.map((k) => ({
    ...k,
    content: k.content
      .replace(/\{\s*(isim|ad|name)\s*\}/gi, "misafirimiz")
      .replace(/\{\s*(daire|apartment|apt)\s*\}/gi, aptNumber),
  }));

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: {
      aiStyleProfile: true,
      aiSignature: true,
      autoClosingReplyEnabled: true,
      closingReplyText: true,
      lateCheckoutOfferText: true,
      autoReplyDisclosure: true,
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
  const kbSel = selectKbForPrompt({ items: kb, guestMessage: message, history: [] });

  const now = new Date();
  const result = await suggestReply({
    guestMessage: message,
    property: {
      name: property.name,
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      address: property.address,
      city: property.city,
    },
    reservation: {
      guestName: "Test Misafir",
      arrivalDate: now,
      departureDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      status: "confirmed",
    },
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
  });

  // The REAL auto-send verdict — the exact production gate (intent blocklist,
  // risk word-nets, injection veto, source + confidence), mirroring the landing
  // demo (#27). Drives both the "would auto-send" line on the card and whether
  // the disclosure note belongs in the preview.
  const wouldAutoSend = passesAutoReplySafetyGate(
    {
      intent: result.intent,
      riskLevel: result.riskLevel,
      confidence: result.confidence,
      source: result.source,
      riskType: result.riskType ?? null,
    },
    message,
  );

  // PREVIEW PARITY: show EXACTLY what would leave the building. An AUTO-send
  // carries reply + machine-note + signature (same order as the real sender);
  // a manual/approval draft carries reply + signature only — the note never
  // rides host-reviewed messages, so it is previewed ONLY when the gate says
  // this message would truly go out on its own.
  const signature = org?.aiSignature?.trim();
  const note = wouldAutoSend ? automatedReplyNote(result.detectedLanguage, org?.autoReplyDisclosure ?? true) : null;
  const parts = [result.reply?.trimEnd() ?? ""];
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
  const closingReplyPreview =
    closingKind && closingReplyEnabled && org
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
    closingAck: closingKind !== null, // backwards-compatible flag for the card
    closingKind,
    closingReplyEnabled,
    closingReplyPreview,
  });
});
