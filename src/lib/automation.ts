import "server-only";
import { addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { orgTimezone, zonedDayRange, currentHourInTimeZone, dateKeyInTimeZone, addZonedDays } from "@/lib/timezone";
// Geriye dönük uyumluluk: bu yardımcılar uzun süre buradan import edildi.
export { zonedDayRange, currentHourInTimeZone } from "@/lib/timezone";
import { isUniqueViolation } from "@/lib/db-errors";
import { recordRiskEvent } from "@/lib/risk-events";
import { recordShadowVerdict } from "@/lib/shadow-ai";
import { scrubStyleProfileForPublic, withoutSecretKbItems, QR_SECRET_CATEGORIES } from "@/lib/guest-chat";
import { LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER } from "@/lib/message-author";
import { buildTriageData } from "@/lib/ai/triage";
import { reservationAmountNumber } from "@/lib/money";
import { classifyMessage, suggestReply, summarizeHostStyle } from "@/lib/ai";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { GUEST_DELIVERABLE_KB_WHERE } from "@/lib/kb-review";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { consumeDailyAiBudget, peekDailyAiBudget } from "@/lib/ai/daily-budget";
import {
  classifyFallback,
  isClosingAck,
  isPositiveFeedback,
  detectPromptInjection,
  holdingAckEligible,
  holdingAckBlockedSignals,
  detectGuestLanguage,
  detectRiskType,
} from "@/lib/ai/fallback";
import { premiumAllowed } from "@/lib/billing/subscription";
import { redactSensitive, reportError } from "@/lib/report-error";
import { sendOnChannel, isDefinitiveSendFailure } from "@/lib/messaging";
import { createHash } from "crypto";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import { enqueueOutbound, enqueueProactive } from "@/lib/outbox/enqueue";
import { classifySendResult, sendFailureHoldMs } from "@/lib/outbox/state";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { PROVIDER_MESSAGEABLE_RESERVATION_WHERE, PROVIDER_THREAD_CONVERSATION_WHERE } from "@/lib/channels/capability";
import { getAdjacency } from "@/lib/turnover";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";
import { parseSupplyProfile, buildSupplyChecklist } from "@/lib/supply";
import { emailService } from "@/lib/email";
import {
  complaintEscalationEmail,
  reservationCreatedEmail,
} from "@/lib/email-templates";
import type { ReplyTone } from "@/lib/constants";

const VALID_TONES: ReplyTone[] = ["formal", "warm", "short", "luxury"];

// Auto-reply only fires when the AI is confident AND the message is safe. The
// deterministic fallback never reaches this bar (it caps safe intents at 0.55),
// so auto-reply effectively requires a real model response — by design.
// Floor is 0.75: only clearly-confident drafts (75%+) auto-send; anything more
// borderline waits for a human review.
const AUTO_REPLY_MIN_CONFIDENCE = 0.75;

// HARD BLOCK: these intents touch money / cancellation / a complaint and must
// ALWAYS be handled by a human — never auto-sent, even if the model under-rates
// the risk as "low". This is a belt-and-suspenders on top of the riskLevel gate.
const NEVER_AUTO_REPLY_INTENTS = new Set(["complaint", "refund", "early_departure"]);

// riskType is a LABEL, but a high-stakes label is itself a red flag: if the model
// names any of these, never auto-send even when it (inconsistently) scored the
// risk low. Exported so the real-time QR concierge gate escalates on the SAME set
// (single source of truth → the two gates can't drift apart).
export const HIGH_STAKES_RISK_TYPES = new Set([
  "money_refund", "cancellation", "review_threat", "platform_policy",
  "safety_emergency", "discrimination", "access_security", "prompt_injection",
  "complaint", "human_request", "rule_violation",
]);

/** Only safe, confident drafts may be auto-sent; everything else waits for a human.
 * Exported for the golden scenario suite — the gate is the product's core safety
 * promise, so its verdicts are pinned by fixed test scenarios. */
export function passesAutoReplySafetyGate(
  result: {
    intent: string;
    riskLevel: string;
    confidence: number;
    source: string;
    /** Model's WHY-risky label (closed set, clamped). Used to TIGHTEN only. */
    riskType?: string | null;
  },
  guestMessage: string,
  /** What the MODEL sees beyond the last message: recent history bodies + the
   *  (Airbnb-controlled) guest display name. Scanned for INJECTION ONLY. */
  context?: {
    history?: string[];
    guestName?: string | null;
    /** Son giden yanıttan SONRA gelen, henüz cevaplanmamış misafir mesajları
     *  (sonuncusu hariç — o `guestMessage` olarak ayrıca geliyor). Kısıtlayıcı
     *  netler bunların HEPSİNE uygulanır; ↑gerekçe. */
    pendingGuestMessages?: string[];
  },
): boolean {
  // Never auto-send the deterministic fallback: it can't honour the language /
  // nuance rules the model follows, so if the model is unavailable we wait for a
  // human instead of sending a canned message.
  if (result.source !== "openai") return false;
  // Sensitive intents always go to a human (refund/cancellation/complaint).
  if (NEVER_AUTO_REPLY_INTENTS.has(result.intent)) return false;
  // CROSS-CHECK the model against the deterministic keyword detector: if the
  // guest's OWN words clearly signal a complaint, refund, or early-departure/
  // cancellation, never auto-send — even when the model under-rated it as a
  // benign, low-risk intent. This catches the dangerous misclassification case
  // (an angry or money/cancellation message labelled e.g. "amenity"/"general").
  // ⚠️ YALNIZ SON MESAJA BAKMAK YETMEZ (derin denetim, 08-01). Misafir arka
  // arkaya iki mesaj yazdığında — önce "daire çok kirli, param iade edilsin",
  // 90 saniye sonra "neyse, wifi şifresi neydi?" — kapı yalnız SONUNCUYU
  // taradığı için şikayeti HİÇ görmüyordu: zararsız son mesaj kapıdan geçiyor,
  // AI wifi şifresini gönderiyor, konuşma "answered" oluyor ve şikayet KALICI
  // olarak kayboluyordu (aynı sebeple `sendDueAlerts` de onu bir daha seçmiyor).
  // Ürünün "riskli mesaj HER ZAMAN insana kalır" sözü tam burada kırılıyordu.
  //
  // KAPSAM DAR VE BİLİNÇLİ: yalnız CEVAPLANMAMIŞ mesajlar (son giden yanıttan
  // sonra gelen misafir mesajları) taranır. Aşağıdaki injection yorumunun haklı
  // uyarısı — "dünkü çözülmüş şikayet, bugünün wifi cevabını engellememeli" —
  // bu yüzden geçerliliğini korur: bir kez cevap verdiğimizde pencere sıfırlanır.
  const surfaces = [guestMessage, ...(context?.pendingGuestMessages ?? [])].filter(Boolean);
  const fbAll = surfaces.map((t) => classifyFallback(t));
  if (
    fbAll.some(
      (x) =>
        x.isComplaint ||
        x.intent === "refund" ||
        x.intent === "early_departure" ||
        (x.intent === "human_request" && result.intent !== "human_request"),
    )
  ) {
    return false;
  }
  // Yüksek-riskli deterministik netler de TÜM cevaplanmamış mesajlara uygulanır.
  if (
    surfaces.some((t) => {
      const d = detectRiskType(t);
      return d === "safety_emergency" || d === "rule_violation" || d === "discrimination";
    })
  ) {
    return false;
  }

  const fb = classifyFallback(guestMessage);
  // human_request nuance: when the guest's own words ask for a real person, the
  // ONLY acceptable auto-reply is the model's handoff acknowledgement ("passed
  // you to our host"), which the model produces exactly when IT also labelled
  // the message human_request (and the send then pauses the AI on this thread).
  // If the model labelled it anything else, its draft is a normal answer — the
  // one thing this guest did not want — so hold for a human.
  if (
    fb.isComplaint ||
    fb.intent === "refund" ||
    fb.intent === "early_departure" ||
    (fb.intent === "human_request" && result.intent !== "human_request")
  ) {
    return false;
  }
  // Deterministic prompt-injection backstop: never rely on the model to
  // self-report an injection attempt — if the guest's own words carry classic
  // jailbreak phrasing, the draft waits for a human no matter what the model
  // scored. Restrictive-only (can only prevent an auto-send).
  if (detectPromptInjection(guestMessage)) return false;
  // The model does not only see the LAST message: the prompt carries the recent
  // history verbatim plus the guest display name (Airbnb-controlled text). An
  // injection planted in an EARLIER message — or in the name itself — reaches
  // the model even when the last message is benign, so the injection veto must
  // cover those surfaces too. INJECTION ONLY here: re-running the complaint/risk
  // word nets over old messages would permanently over-block normal threads
  // (yesterday's resolved complaint is not a reason to hold today's wifi answer).
  if (context) {
    const extraSurfaces = [...(context.history ?? []), context.guestName ?? ""];
    if (extraSurfaces.some((t) => t && detectPromptInjection(t))) return false;
  }
  // ── DETERMİNİSTİK YÜKSEK-RİSK VETOSU — 3 ETİKETTEN TAM KÜMEYE (08-06) ──────
  //
  // 🚨 ÖLÇÜLEN AÇIK (denetim ajanı bulgusu, kendi ölçümümle birebir üretildi):
  // bu backstop YALNIZ üç etiketi vetoluyordu, oysa `detectRiskType` ON etiket
  // döndürebiliyor. Aradaki fark KOD TARAFINDAN TESPİT EDİLİP kod tarafından
  // BLOKLANMAYAN bir küme bırakıyordu; o kümede kalan mesajlar için tek savunma
  // MODELİN hükmüydü — yani kapının var olma sebebi (karar modele verilmez)
  // tam orada delinmişti. Ölçüm (model "zararsız" dedi varsayımıyla):
  //
  //   "IBAN'ınızı atar mısınız?"                  → platform_policy → GEÇİYORDU
  //   "I will leave a really bad review"          → review_threat   → GEÇİYORDU
  //   "Sizin için düşük bir puan vereceğim"       → review_threat   → GEÇİYORDU
  //   "Parayı size elden versem olur mu?"         → platform_policy → GEÇİYORDU
  //
  // Neden bu boşluk oluştu: kelime-arası boşluk toleransı (08-06'da
  // `REVIEW_THREAT_PHRASES` + `OFFPLATFORM_PAYMENT_PHRASES`'e AÇILDI) sayesinde
  // `detectRiskType` bu mesajları yakalıyor, ama kapının çapraz-kontrolü
  // `classifyFallback`/`detectIntent` ve o BİTİŞİKLİK istiyor (`allowWordGap`
  // orada KAPALI, bilerek). Yani etiketlenen küme, bloklanabilen kümeden
  // yapısal olarak BÜYÜK — ve arada kalanlar korumasızdı.
  //
  // ⚠️ YÖN GÜVENLİ: `detectRiskType` KISITLAYICIDIR — yalnız bir oto-gönderimi
  // ENGELLEYEBİLİR, asla sebep olamaz. Aşırı-eskalasyon bu depoda belgeli
  // güvenli yöndür (aynı yorumun kendisi bunu söylüyordu).
  //
  // ⚠️ DEVİR MUAFİYETİ KORUNUR — AMA DETERMİNİSTİK DALDA ÖLÇÜT MODEL **INTENT**'İ,
  // ETİKETİ DEĞİL. Bunu ilk yazımda yanlış yaptım ve `holding-ack.test.ts` yakaladı:
  // muafiyeti model ETİKETİNE (`riskType === "human_request"`) bağlamıştım, oysa
  // model bu akışta etiketi çoğunlukla NULL bırakıp yalnız intent'i bildiriyor →
  // tasarlanmış devir mesajı hiç gitmez olmuştu. `human_request` bir "risk" değil
  // bir ÜRÜN AKIŞIDIR; ayrımı yapan şey modelin mesajı devir talebi olarak OKUYUP
  // OKUMADIĞIDIR.
  //   · deterministik human_request + model intent human_request → devir ack'i GİDER
  //   · deterministik human_request + model BAŞKA bir şey der    → insana bırakılır
  // (İkisi de `holding-ack.test.ts`'te ayrı ayrı pinli.)
  const isHandoffAck = result.intent === "human_request" && result.riskType === "human_request";
  const deterministicRisk = detectRiskType(guestMessage);
  const deterministicBlocks =
    deterministicRisk !== null &&
    HIGH_STAKES_RISK_TYPES.has(deterministicRisk) &&
    !(deterministicRisk === "human_request" && result.intent === "human_request");
  if (deterministicBlocks) return false;
  // A high-stakes label (HIGH_STAKES_RISK_TYPES, module scope — shared with the QR
  // gate) is itself a red flag: if the model names one, never auto-send even when
  // it (inconsistently) scored the risk low. Tightens only — null label changes nothing.
  // Sole exemption: the designed handoff ack — model intent AND label both say
  // human_request. Any OTHER high-stakes label (even alongside a human_request
  // intent) holds for a human.
  if (result.riskType && !isHandoffAck && HIGH_STAKES_RISK_TYPES.has(result.riskType)) {
    return false;
  }
  if (result.riskLevel !== "none" && result.riskLevel !== "low") return false;
  // İKİNCİ KEMER (Codex F01): güven değeri SONLU bir sayı olmak zorunda. Parser
  // zaten yalnız sonlu number geçiriyor, ama kapı başka çağıranlardan da ham
  // nesne alır (QR yolu, testler) — `Infinity >= 0.75` true olurdu.
  if (!Number.isFinite(result.confidence)) return false;
  return result.confidence >= AUTO_REPLY_MIN_CONFIDENCE;
}

/**
 * Risk-visibility (Faz-A): persist WHY the AI last held back on a thread (+ the
 * model's last risk verdict) so the inbox can explain itself and Reports can
 * aggregate. Guarded write — only touches the row when the value actually
 * changes, so recurring per-tick skips (human_hold etc.) cost one write total.
 */
async function persistRiskVisibility(
  conversationId: string,
  reason: string,
  risk?: string | null,
  riskType?: string | null,
): Promise<void> {
  // ⚠️ "AYNI SEBEP → YAZMA" KORUMASI RİSK ALANLARINI DA ATLIYORDU (denetim, 08-01).
  //
  // Koruma yalnız `skippedReason`'a bakıyordu ama aynı UPDATE `lastRiskLevel` ve
  // `lastRiskType`'ı da taşıyor. Misafir arka arkaya İKİ mesaj yazıp ikisi de
  // `low_confidence_or_risky` düşerse (sebep AYNI) ikinci mesajın deterministik
  // risk etiketi — `detectRiskType` backstop'unun tam da ürettiği
  // `safety_emergency`/`rule_violation`/`discrimination` — hiç yazılmıyordu:
  // WHERE'in iki dalı da eşleşmiyor, 0 satır güncelleniyor, inbox rozeti BAYAT
  // kalıyordu. Ters yön de aynı hatadan doğar: A mesajında yazılmış bir etiket,
  // B zararsızken silinmiyordu (yanlış-pozitif rozet).
  //
  // Çözüm: RİSK BİLGİSİ TAŞIYAN çağrılarda koruma atlanır. Korumanın varlık
  // sebebi (her turda tekrarlanan `human_hold` gibi sebepler için tek yazma)
  // korunuyor — o çağrılar risk argümanı GEÇMEZ. Risk taşıyan tek çağrı yeri
  // mesaj başına bir kez koşar (`autoReplyAttemptedAt` damgası), yani yazma
  // sayısı pratikte artmaz.
  const carriesRisk = risk !== undefined || riskType !== undefined;
  await prisma.conversation
    .updateMany({
      where: {
        id: conversationId,
        ...(carriesRisk
          ? {}
          : { OR: [{ skippedReason: null }, { skippedReason: { not: reason } }] }),
      },
      data: {
        skippedReason: reason,
        ...(risk !== undefined ? { lastRiskLevel: risk } : {}),
        ...(riskType !== undefined ? { lastRiskType: riskType } : {}),
      },
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Tier-2 "holding acknowledgement" (OPT-IN, default OFF).
//
// The three-tier model: (1) low-risk questions auto-send; (3) high-risk
// messages get a silent draft + host escalation. This is tier (2): a MILD
// complaint (NO deterministic high-stakes signal — money/cancellation/human-
// request/review-threat/safety/injection/discrimination/rule-violation/
// off-platform payment; see holdingAckEligible) gets ONE immediate, deterministic,
// non-committal acknowledgement so the guest isn't left hanging at 3am, while
// the conversation STAYS flagged "problem" and the host is still emailed. The
// text never promises a remedy, never admits fault, only acknowledges + asks
// for a detail/photo + hands off to the host. Per-org opt-in
// (autoHoldingReplyEnabled) so the default product keeps the landing promise
// ("complaints are never auto-answered") to the letter.
// ---------------------------------------------------------------------------
const HOLDING_ACK_TEXTS: Record<string, string> = {
  // ⚠️ "paylaşırsanız … hızlandırır" ÖZNESİZDİ (denetim 08-08): koşul cümlesinden
  // sonra gelen yüklemin öznesi yok. Metin misafire OTOMATİK gidiyor, yani bozuk
  // Türkçe doğrudan müşteriye ulaşıyordu. Doğru kuruluş isim-fiil öznesidir.
  tr: "Bunun için özür dileriz. Mesajınızı ev sahibimize ilettim; en kısa sürede sizinle ilgilenecek. Sorunun kısa bir açıklamasını ya da fotoğrafını paylaşmanız çözümü hızlandırır.",
  en: "Apologies for the trouble. I've passed your message to our host, who will follow up with you shortly. Sharing a short detail or a photo of the issue will help speed things up.",
  // ⚠️ "er meldet sich" ev sahibinin ERKEK olduğunu varsayıyordu; ev sahibi
  // müşterimizdir ve cinsiyetini bilmiyoruz. Cümle yeniden kuruldu (zamir yok).
  de: "Entschuldigen Sie die Unannehmlichkeit. Ich habe Ihre Nachricht an unseren Gastgeber weitergeleitet; Sie erhalten in Kürze eine Rückmeldung. Ein kurzes Detail oder ein Foto des Problems hilft uns, schneller zu helfen.",
  fr: "Veuillez nous excuser pour ce désagrément. J'ai transmis votre message à notre hôte, qui reviendra vers vous rapidement. Un court détail ou une photo du problème nous aidera à aller plus vite.",
  ar: "نعتذر عن هذا الإزعاج. لقد أرسلت رسالتكم إلى المضيف وسيتواصل معكم في أقرب وقت. مشاركة تفصيل قصير أو صورة للمشكلة تساعدنا على الحل بشكل أسرع.",
  // ⚠️ "Я передал" YAZANIN erkek olduğunu, "он свяжется" ev sahibinin erkek
  // olduğunu varsayıyordu — ikisini de bilmiyoruz. Edilgen kuruluş her ikisini
  // de çözer ve Rusçada tamamen doğaldır.
  ru: "Приносим извинения за неудобство. Ваше сообщение передано хозяину — с вами свяжутся в ближайшее время. Короткое описание или фото проблемы поможет решить вопрос быстрее.",
};

/**
 * ⛔ İPTAL EDİLMİŞ KONAKLAMAYA OTOMATİK MİSAFİR MESAJI GİTMEZ (denetim, 08-08).
 *
 * `applyChannelAutoReply` bu kapıyı `:1176`'da ZATEN tutuyor, ama BEKLETME
 * MESAJI (holding ack) yolunun ikinci çağıranı `sendDueAlerts`'tir ve ORADA
 * hiçbir rezervasyon kontrolü YOKTU: aday sorgusu yalnız `status:"new"` +
 * 72 saatlik tazelik penceresine bakıyor. Ölçülmüş senaryo — misafirin
 * rezervasyonu İPTAL, misafir "Klima çalışmıyor" yazıyor → kelime yolu
 * konuşmayı "Sorunlu" claim ediyor, host'a uyarı gidiyor ve ARDINDAN misafire
 * "özür dileriz, ev sahibimiz en kısa sürede ilgilenecek" mesajı OTOMATİK
 * gidiyordu. Artık gitmiyor.
 *
 * KARAR TABLOSU (fail-safe yön = GÖNDERME):
 *   · bağlı rezervasyon + status "cancelled"  → ENGELLE
 *   · bağlı rezervasyon + başka her durum      → izin ver (pending/confirmed/
 *     completed; "completed" bir konaklama YAŞANMIŞTIR, çıkış sonrası şikayete
 *     bekletme mesajı meşrudur — burada DARALTMA yapılmadı)
 *   · BAĞSIZ + senkron çiti damgalı             → ENGELLE (↓)
 *   · BAĞSIZ + damgasız                         → izin ver (↓)
 *   · konuşma satırı yok / okuma fırlattı       → ENGELLE
 *
 * ⚠️ BAĞSIZ KONUŞMA TOPTAN SUSTURULMAZ. Yerel rezervasyonu olmayan bir thread
 *    aynı zamanda REZERVASYON ÖNCESİ satış sorusudur (`prompts.ts`
 *    preBookingBlock) ve ona cevap vermek bilinçli ürün davranışıdır. Bağsız +
 *    ÖLÜ konaklamanın doğru yeri senkron katmanındaki `fenceUnlinkedTerminalStay`
 *    çitidir; o çit `skippedReason:"reservation_ended"` damgasını basar. Damgayı
 *    bugüne kadar YALNIZ model yolunun aday sorgusu okuyordu (`autoReplyAttemptedAt`
 *    üzerinden) — `sendDueAlerts` ne o alana ne bu alana bakıyordu, yani çitin
 *    kör noktası tam da buydu. Damga CLAIM'DEN ÖNCE okunmak zorunda: claim onu
 *    "complaint" ile EZER, sonradan okumak daima yanlış cevap verir.
 */
async function autoGuestMessageBlockedByStay(opts: {
  conversationId: string;
  /** `skippedReason === "reservation_ended"`, çağıran thread'i claim etmeden ÖNCE. */
  stayFencedBeforeClaim?: boolean;
}): Promise<boolean> {
  try {
    const row = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
      select: { reservation: { select: { status: true } } },
    });
    if (!row) return true; // satır kayboldu → bilinmeyen durum, gönderme
    if (row.reservation) return row.reservation.status === "cancelled";
    return opts.stayFencedBeforeClaim === true;
  } catch {
    // Durum OKUNAMADI. Bu modülde bilinmeyenin güvenli yönü SUSMAKTIR: kaçırılan
    // bir bekletme mesajı gecikmedir, iptal edilmiş konaklamaya giden bir mesaj
    // geri alınamaz.
    return true;
  }
}

/**
 * Send the tier-2 holding acknowledgement if every gate allows it. The CALLER
 * must have already atomically claimed the conversation into "problem" — that
 * claim is the idempotency lock (a second replica/run loses the claim and never
 * reaches this call), so the guest can never receive the ack twice.
 */
async function maybeSendHoldingAck(opts: {
  organizationId: string;
  conversation: {
    id: string;
    channel: string;
    guestIdentifier: string;
    externalReservationId: string | null;
  };
  guestMessage: string;
  org: { autoHoldingReplyEnabled: boolean; autoReplyDisclosure: boolean; aiSignature: string | null };
  /** Model-detected language when available; falls back to the heuristic. */
  language?: string | null;
  /** True on the model path: the model already labelled this a (non-high)
   * complaint, so keyword-complaint isn't required — only the deterministic
   * blocking signals (any non-complaint risk label; see
   * holdingAckBlockedSignals) are checked. */
  complaintConfirmed?: boolean;
  /** `skippedReason === "reservation_ended"` as observed BEFORE the caller
   * claimed the thread into "problem" (the claim overwrites it with
   * "complaint", so it can never be re-read here). See
   * autoGuestMessageBlockedByStay. */
  stayFencedBeforeClaim?: boolean;
}): Promise<boolean> {
  // Same master switches as every other automatic guest message.
  if (process.env.AUTO_REPLY_ENABLED !== "1") return false;
  if (!opts.org.autoHoldingReplyEnabled) return false;
  const eligible = opts.complaintConfirmed
    ? !holdingAckBlockedSignals(opts.guestMessage)
    : holdingAckEligible(opts.guestMessage);
  if (!eligible) return false;
  // İptal edilmiş (ya da senkronca ölü işaretlenmiş) konaklamaya otomatik
  // misafir mesajı YOK. Ucuz kapıların ARDINA konuldu: sorgu yalnız gerçekten
  // bir ack'in eşiğine gelindiğinde harcanır, sıcak yol etkilenmez.
  if (
    await autoGuestMessageBlockedByStay({
      conversationId: opts.conversation.id,
      stayFencedBeforeClaim: opts.stayFencedBeforeClaim,
    })
  ) {
    return false;
  }
  if (!(await premiumAllowed(opts.organizationId))) return false;
  const token = await getOrgHospitableToken(opts.organizationId);
  if (!token) return false;

  const lang = (opts.language ?? detectGuestLanguage(opts.guestMessage)).slice(0, 2).toLowerCase();
  const text = HOLDING_ACK_TEXTS[lang] ?? HOLDING_ACK_TEXTS.en;
  const note = automatedReplyNote(lang, opts.org.autoReplyDisclosure);
  const signature = opts.org.aiSignature?.trim();
  const body = [text, ...(note ? [note] : []), ...(signature ? [signature] : [])].join("\n\n");

  // ── Durable Outbox (flag ON) ──────────────────────────────────────────────
  // Record the ack as a durable send-intent; the worker delivers it. messageType
  // "holding_ack" → the worker KEEPS the thread in "problem" on delivery (deliveryEffect:
  // none), so the host still owns it. The escalation's "problem" claim the caller already
  // made is the primary lock; the deterministic key (conversation + complaint content)
  // makes a retry a clean dedupe-hit. Flag OFF → the inline best-effort send below runs.
  if (durableOutboxEnabled() && opts.conversation.externalReservationId) {
    const digest = createHash("sha256").update(opts.guestMessage).digest("base64url").slice(0, 24);
    try {
      await enqueueOutbound({
        organizationId: opts.organizationId,
        conversationId: opts.conversation.id,
        channel: opts.conversation.channel,
        externalReservationId: opts.conversation.externalReservationId,
        body,
        senderName: "GuestOps AI", // classification magic string (unchanged)
        authorType: "ai",
        messageType: "holding_ack",
        aiIntent: "complaint",
        idempotencyKey: `holding:${opts.conversation.id}:${digest}`,
      });
    } catch (err) {
      // ⚠️ SESSİZ DEĞİL (denetim, 08-01 — üçüncü tur, ajan bulgusu). Çağıran
      // konuşmayı ZATEN atomik olarak "problem"a claim etti ve o claim ack'in
      // idempotency kilidi — yani buradan `false` dönmek, opt-in Seviye-2 sözünün
      // ("misafir gecenin 3'ünde sahipsiz kalmasın") o konuşma için SESSİZCE
      // çiğnenmesi demek. Gövde/ad ASLA loglanmaz, yalnız konuşma id'si.
      void reportError(
        "holding-ack-enqueue",
        new Error(`conversation=${opts.conversation.id} — bekletme mesajı kuyruğa alınamadı`, {
          cause: err,
        }),
      );
      return false; // best-effort — a failed enqueue must not break the escalation
    }
    return true;
  }

  const delivery = await sendOnChannel(
    {
      channel: opts.conversation.channel,
      guestIdentifier: opts.conversation.guestIdentifier,
      externalReservationId: opts.conversation.externalReservationId,
    },
    body,
    token,
  );
  if (!delivery.ok) {
    // Aynı gerekçe (↑): claim tüketildi, ack bir daha denenmeyecek — iz kalmalı.
    // Sağlayıcının HAM hata metni DB'ye/alarma girmez, yalnız konuşma id'si.
    void reportError(
      "holding-ack-send",
      new Error(`conversation=${opts.conversation.id} — bekletme mesajı gönderilemedi`),
    );
    return false; // escalation already happened; ack is best-effort
  }

  // Bookkeeping (delivery already succeeded — best-effort): record the outbound
  // message; the conversation deliberately STAYS "problem" so the host still
  // owns the thread.
  await prisma
    .$transaction([
      prisma.message.create({
        data: {
          conversationId: opts.conversation.id,
          direction: "outbound",
          authorType: "ai",
          senderName: "GuestOps AI",
          body,
          aiIntent: "complaint",
          // Dedup this ack against its own re-import from the channel thread.
          ...(delivery.providerMessageId ? { externalId: delivery.providerMessageId } : {}),
        },
      }),
      prisma.conversation.update({
        where: { id: opts.conversation.id },
        data: { lastMessageAt: new Date() },
      }),
    ])
    // Mesaj ZATEN misafire gitti; persist düşerse geri alınamaz. Ama sessiz
    // kalamaz: host'un thread'inde görünmez (sync yeniden import edene kadar) ve
    // import edilince AI atfını kaybeder → `senderName "GuestOps AI"` sayan
    // raporlar eksik sayar. Kayıp kaçınılmazsa bile GÖRÜNÜR olmalı.
    // ⚠️ Context string'ine konuşma id'si KOYMA: `report-error-core.ts` e-posta
    // throttle'ını CONTEXT bazlı tutuyor, yani her konuşma ayrı bir anahtar olur
    // ve 10 dakikalık koruma fiilen kalkar (toplu bir DB hıçkırığı = konuşma
    // başına uyarı e-postası). Id, throttle anahtarı OLMAYAN hata mesajında.
    .catch((err) =>
      reportError(
        "holding-ack persist",
        err instanceof Error
          ? new Error(`${err.message} (conversation ${opts.conversation.id})`)
          : new Error(`${String(err)} (conversation ${opts.conversation.id})`),
      ),
    );
  return true;
}

// ---------------------------------------------------------------------------
// Opt-in COURTESY reply to a bare closing ("teşekkürler / thanks / 👍"). By
// default such closings are silently skipped (isClosingAck) — that stays the
// product default. When the org turns on `autoClosingReplyEnabled`, ONE short,
// deterministic "you're welcome" line goes out in the guest's language. Never
// twice in a row: if OUR latest outbound was itself this courtesy, the guest is
// thanking the thank-you and the thread is left alone (no pleasantry ping-pong).
// ---------------------------------------------------------------------------
const CLOSING_COURTESY_INTENT = "closing_courtesy"; // Message.aiIntent marker = the loop guard
export type CourtesyKind = "ack" | "praise";
// SHORT on purpose: a closing gets a closing, not a paragraph. The host can
// replace these entirely with their own line (Organization.closingReplyText).
// Two kinds share ONE toggle + ONE custom text: "ack" answers a bare thanks,
// "praise" answers a pure compliment — sober wording, no emotion claims
// ("çok sevindim" yasak: üslup kuralı), no promises.
// ⚠️ ÜNLEM YOK (08-08, ürün sahibi kararı). Bu altı satır misafire OTOMATİK
// gidiyor ve ünlem, yazıya dökülmemiş bir coşku beyanıdır — prompts.ts Bölüm 10
// aynı yasağı modele de koyuyor, iki yüzey AYNI kuralda kalmalı. Emoji ayrı bir
// karardır ve bilerek DURUYOR: burada değişen yalnız noktalama.
const CLOSING_COURTESY_TEXTS: Record<CourtesyKind, Record<string, string>> = {
  ack: {
    tr: "Rica ederiz, iyi günler dileriz. 😊",
    en: "You're very welcome. 😊",
    de: "Sehr gerne. 😊",
    fr: "Avec plaisir. 😊",
    ar: "على الرحب والسعة. 😊",
    ru: "Пожалуйста. 😊",
  },
  // TIME-AGNOSTIC on purpose (Codex): praise often arrives PAST-tense ("her şey
  // harikaydı") — "keyifli bir konaklama dileriz" would read oddly after checkout.
  praise: {
    tr: "Güzel geri bildiriminiz için teşekkür ederiz.",
    en: "Thank you for the kind feedback.",
    de: "Vielen Dank für das schöne Feedback.",
    fr: "Merci pour ce gentil retour.",
    ar: "شكرًا لملاحظاتكم اللطيفة.",
    ru: "Спасибо за тёплый отзыв.",
  },
};

/**
 * Which language the courtesy should use for a given closing message: the
 * guest's detected language when the closing has letters; a pure-emoji "👍"
 * carries no signal, so the org's own language wins (never a silent English default).
 */
export function closingCourtesyLanguage(closingBody: string, orgLanguage: string): string {
  const hasLetters = /\p{L}/u.test(closingBody);
  return (hasLetters ? detectGuestLanguage(closingBody) : orgLanguage || "tr").slice(0, 2).toLowerCase();
}

/**
 * The EXACT guest-facing courtesy body: the host's custom line (verbatim, any
 * language) when set, else the short built-in default for (kind, lang); then
 * the host's signature. The "machine-prepared" note is DELIBERATELY absent
 * here (unlike model auto-sends): the text is fixed by the host or by us, so
 * there is nothing a disclaimer could correct — a pleasantry stays a
 * pleasantry. Exported so the settings playground previews PRECISELY what
 * would go out (no drift between preview and send).
 */
export function composeClosingCourtesy(opts: {
  kind: CourtesyKind;
  lang: string;
  customText: string | null;
  signature: string | null;
}): string {
  const custom = opts.customText?.trim();
  const defaults = CLOSING_COURTESY_TEXTS[opts.kind];
  const text = custom || (defaults[opts.lang] ?? defaults.en);
  const signature = opts.signature?.trim();
  return [text, ...(signature ? [signature] : [])].join("\n\n");
}

/**
 * Send the opt-in closing courtesy if every gate allows it. Mirrors the
 * holding-ack's self-contained gating (master env switch, org toggle, premium,
 * token) and the MAIN auto-send's idempotency mechanism: the guest's closing
 * re-opened the thread as "new", so an atomic new/waiting→answered claim is the
 * cross-replica lock — the loser sends nothing. Returns true when sent/enqueued.
 */
async function maybeSendClosingCourtesy(opts: {
  organizationId: string;
  conversation: {
    id: string;
    channel: string;
    guestIdentifier: string;
    externalReservationId: string | null;
  };
  /** Thread messages (oldest→newest) — used for the courtesy-to-courtesy loop guard. */
  messages: { direction: string; aiIntent: string | null }[];
  lastInbound: { id: string; body: string };
  /** "ack" = bare thanks/ok; "praise" = pure compliment (isPositiveFeedback). */
  kind: CourtesyKind;
  org: {
    autoClosingReplyEnabled: boolean;
    closingReplyText: string | null;
    aiSignature: string | null;
    language: string;
  };
}): Promise<boolean> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return false;
  if (!opts.org.autoClosingReplyEnabled) return false;
  // LOOP GUARD: our latest outbound was itself the courtesy → the guest is
  // thanking the thank-you. Stay silent, or the two sides ping-pong forever.
  const lastOutbound = [...opts.messages].reverse().find((m) => m.direction === "outbound");
  if (lastOutbound?.aiIntent === CLOSING_COURTESY_INTENT) return false;
  if (!(await premiumAllowed(opts.organizationId))) return false;
  const token = await getOrgHospitableToken(opts.organizationId);
  if (!token) return false;

  const lang = closingCourtesyLanguage(opts.lastInbound.body, opts.org.language);
  const body = composeClosingCourtesy({
    kind: opts.kind,
    lang,
    customText: opts.org.closingReplyText,
    signature: opts.org.aiSignature,
  });

  // Cross-replica idempotency claim (same as the main auto-send): only the run
  // that flips new/waiting→answered may deliver; failure releases the claim.
  const claim = await prisma.conversation.updateMany({
    where: { id: opts.conversation.id, status: { in: ["new", "waiting"] } },
    data: { status: "answered" },
  });
  if (claim.count === 0) return false;

  // ── Durable Outbox (flag ON) — deterministic key: one courtesy per closing msg.
  if (durableOutboxEnabled() && opts.conversation.externalReservationId) {
    try {
      await enqueueOutbound({
        organizationId: opts.organizationId,
        conversationId: opts.conversation.id,
        channel: opts.conversation.channel,
        externalReservationId: opts.conversation.externalReservationId,
        body,
        senderName: "GuestOps AI", // classification magic string (unchanged)
        authorType: "ai",
        messageType: "ai",
        aiIntent: CLOSING_COURTESY_INTENT,
        idempotencyKey: `closing:${opts.conversation.id}:${opts.lastInbound.id}`,
      });
    } catch {
      await prisma.conversation
        .update({ where: { id: opts.conversation.id }, data: { status: "new" } })
        .catch(() => {});
      return false;
    }
    return true;
  }

  const delivery = await sendOnChannel(
    {
      channel: opts.conversation.channel,
      guestIdentifier: opts.conversation.guestIdentifier,
      externalReservationId: opts.conversation.externalReservationId,
    },
    body,
    token,
  );
  if (!delivery.ok) {
    // DEFINITIVE (4xx≠408): nothing was delivered → release the claim so a later
    // pass may retry (or fall back to the silent skip). AMBIGUOUS (timeout/5xx/
    // network): the courtesy MAY already have reached the guest, so reverting to
    // "new" would let the next pass re-claim and send a DUPLICATE courtesy — HOLD
    // the claim (stays "answered") instead. Parity with the auto-reply/lifecycle/
    // manual paths' isDefinitiveSendFailure(); the silent local-record gap is the
    // accepted ambiguous trade-off ("a duplicate is worse than a rare silent miss").
    if (isDefinitiveSendFailure(delivery.error)) {
      await prisma.conversation
        .update({ where: { id: opts.conversation.id }, data: { status: "new" } })
        .catch(() => {});
    }
    return false;
  }

  await prisma
    .$transaction([
      prisma.message.create({
        data: {
          conversationId: opts.conversation.id,
          direction: "outbound",
          authorType: "ai",
          senderName: "GuestOps AI",
          body,
          aiIntent: CLOSING_COURTESY_INTENT, // ALSO the loop guard for the next closing
          ...(delivery.providerMessageId ? { externalId: delivery.providerMessageId } : {}),
        },
      }),
      prisma.conversation.update({
        where: { id: opts.conversation.id },
        data: { lastMessageAt: new Date(), skippedReason: null },
      }),
    ])
    // ⚠️ BU YUTULAN HATA MİSAFİRE GÖRÜNÜR (denetim, 07-31). Mesaj ZATEN gitti;
    // burada kaybedilen şey `aiIntent: CLOSING_COURTESY_INTENT` — ve o alan tam
    // olarak yukarıdaki DÖNGÜ KİLİDİNİN baktığı yer. Persist düşerse sync bu
    // mesajı sonra düz bir giden satır olarak (aiIntent null) içeri alır, kilit
    // kaybolur ve misafir tekrar teşekkür ettiğinde İKİNCİ bir nezaket gider —
    // yani bu özelliğin var olma sebebi olan ping-pong. Geri alınamaz, ama
    // GÖRÜNÜR olmak zorunda: aksi hâlde ping-pong'un sebebi asla bulunamaz.
    // Id throttle anahtarına DEĞİL hata mesajına gider (↑gerekçe: holding-ack).
    .catch((err) =>
      reportError(
        "closing-courtesy persist",
        err instanceof Error
          ? new Error(`${err.message} (conversation ${opts.conversation.id})`)
          : new Error(`${String(err)} (conversation ${opts.conversation.id})`),
      ),
    );
  return true;
}

// A short, warm note (in the guest's language) appended to AUTO-sent replies so
// the guest knows the message was machine-prepared and a human will correct any
// slip. Manual replies (host-reviewed) never carry it. Set AUTO_REPLY_DISCLOSURE=0
// to turn it off. Exported so the settings playground can compose an auto-send
// preview with the SAME note (preview parity — never a second copy of the text).
export function automatedReplyNote(lang: string | undefined, orgEnabled: boolean): string | null {
  // env=0 is a GLOBAL operator kill-switch; otherwise the per-org toggle decides.
  if (process.env.AUTO_REPLY_DISCLOSURE === "0" || !orgEnabled) return null;
  const l = (lang ?? "en").slice(0, 2).toLowerCase();
  // 🚨 TUTULAMAYACAK SÖZ VERME (denetim 08-08). Eski metin altı dilde birden
  // "bir hata olursa ekibimiz HEMEN DÜZELTİR" diyordu. Böyle bir mekanizma YOK:
  // kapıdan geçen bir oto-yanıtı sonradan kimse OKUMUYOR, yanlış olduğunu
  // anlayan bir dedektör de yok. Host, ancak misafir TEKRAR YAZARSA haberdar
  // oluyor.
  //
  // 🚨 "BURAYA YAZIN, EV SAHİBİ DEVRALACAK" CÜMLESİ KALDIRILDI (denetim 08-08,
  // ÖLÇÜLDÜ). O cümle bu turda eklenmişti ve gerekçesi "yapı gereği doğru" idi —
  // DEĞİLDİ. `autoReplyHoldUntil` (botu susturan TEK alan) yalnız İKİ yerde
  // yazılıyor: gönderim hatası geri çekilmesi ve `intent === "human_request"`.
  // "Misafir oto-yanıttan sonra yazdı" hiçbir yerde devir sinyali DEĞİL.
  // Ölçüldü: nazik bir düzeltmenin ("Aslında çıkış saati 11 değil mi?") beş
  // varyantının BEŞİ de kapıdan geçip TEKRAR OTOMATİK yanıtlandı; konuşma
  // "answered" işaretlendi ve host hiç görmedi.
  // ⚠️ Bu, yerine geçtiği eski cümleden ("ekibimiz hemen düzeltir") DAHA KÖTÜYDÜ:
  // eskisi belirsiz bir vaatti, yenisi misafirin UYGULAYACAĞI bir TALİMATTI.
  // Davetin geri gelmesi için önce mekanizması yazılmalı (oto-yanıt sonrası ilk
  // gelen mesajda hold) — o ayrı ve onaylı bir tur; metin o zamana kadar
  // yalnızca DOĞRU olanı söyler: mesajın makine tarafından hazırlandığını.
  // Açıklama yükümlülüğü aynen korunuyor. Gerçek bir sorun yazılırsa şikayet
  // yolu zaten "Sorunlu" işaretleyip host'a e-posta gönderiyor — o mekanizma
  // VAR, ama misafire söz olarak verilmiyor çünkü her mesaj için geçerli değil.
  // ⚠️ "ev sahibimiz" ifadesi de bilerek gitti: mesaj host'un KENDİ hesabından
  // çıkıyor ve prompt "ev sahibinin ağzından yaz" diyor — kendi kendinden
  // "bizim ev sahibimiz" diye söz etmek, kaçınılmak istenen acente dilidir.
  const notes: Record<string, string> = {
    tr: "(Bu yanıt otomatik asistan tarafından hazırlandı.)",
    en: "(This reply was prepared by an automated assistant.)",
    de: "(Diese Antwort wurde von einem automatischen Assistenten erstellt.)",
    fr: "(Cette réponse a été préparée par un assistant automatique.)",
    ar: "(تم إعداد هذا الرد بواسطة مساعد آلي.)",
    ru: "(Этот ответ подготовлен автоматическим ассистентом.)",
  };
  return notes[l] ?? notes.en;
}

// currentHourInTimeZone / dateKeyInTimeZone / zonedDayRange artık @/lib/timezone'da
// (supply/detect gibi modüller automation'a döngü kurmadan kullanabilsin diye);
// mevcut importçular için buradan re-export edilir.

/**
 * Is `hour` inside the [startHour, endHour) window?
 *   start === end → always true (full day)
 *   start <  end  → same-day window (e.g. 9–18)
 *   start >  end  → window that wraps past midnight (e.g. 22–6)
 */
export function isWithinActiveHours(startHour: number, endHour: number, hour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

// Simple, fixed if/then automation engine (no queue/Zapier-style builder for MVP).
// Each function represents a trigger handler.

/**
 * Create the standard check-in prep + checkout cleaning tasks for a reservation.
 * Idempotent: skips entirely if the reservation already has tasks (so it is safe
 * to call on every iCal re-sync). Past-dated stays are ignored — only upcoming
 * arrivals/departures generate work. Returns the number of tasks created.
 */
export async function createReservationTasks(reservationId: string): Promise<number> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      propertyId: true,
      guestName: true,
      arrivalDate: true,
      departureDate: true,
      status: true,
      property: { select: { supplyProfileJson: true, organization: { select: { timezone: true } } } },
    },
  });
  if (!r || r.status === "cancelled") return 0;

  // Turnover linen/supply checklist from the property's profile (if set). Attached
  // to the cleaning task — the turnover job the cleaner actually opens ("çarşaf/
  // havlu değişimi"). Empty when no profile → no checklist, behavior unchanged.
  const supplyChecklist = buildSupplyChecklist(parseSupplyProfile(r.property?.supplyProfileJson));
  const supplyChecklistJson = supplyChecklist.length > 0 ? JSON.stringify(supplyChecklist) : undefined;

  // Per-TYPE idempotency: create whichever of check-in / cleaning is still missing.
  // A plain "has any task → bail" permanently blocked a reservation that earlier
  // got only a check-in task from ever receiving its checkout cleaning — the exact
  // reason today's checkouts were absent from the cleaning list. Checking per type
  // is still safe to re-run every sync (never duplicates) and self-heals the gap.
  const existing = await prisma.task.findMany({
    where: { reservationId: r.id },
    select: { type: true },
  });
  const has = new Set(existing.map((t) => t.type));

  // "Today" boundary in the HOST'S timezone (org.timezone) — matches the dashboard
  // and the missing-tasks count. date-fns startOfDay uses the server's UTC day;
  // reservation dates land at local midnight (BEFORE UTC midnight for UTC+ zones),
  // so a UTC gate wrongly treats TODAY's checkout as past and creates nothing.
  // That is exactly why "Eksik görevleri oluştur" reported 0 created.
  const todayStart = zonedDayRange(new Date(), orgTimezone(r.property?.organization?.timezone)).start;
  const data: {
    propertyId: string;
    reservationId: string;
    type: string;
    origin: string;
    title: string;
    description: string;
    dueAt: Date;
    status: string;
    priority: string;
    checklistJson?: string;
  }[] = [];

  if (r.arrivalDate >= todayStart && !has.has("checkin_prep")) {
    data.push({
      propertyId: r.propertyId,
      reservationId: r.id,
      type: "checkin_prep",
      origin: "system",
      title: `${r.guestName} girişi için hazırlık`,
      description: "Hoş geldin hazırlığı, anahtar/giriş kontrolü.",
      dueAt: r.arrivalDate,
      status: "todo",
      priority: "standard",
    });
  }
  if (r.departureDate >= todayStart && !has.has("cleaning")) {
    data.push({
      propertyId: r.propertyId,
      reservationId: r.id,
      type: "cleaning",
      origin: "system",
      title: `Çıkış temizliği - ${r.guestName}`,
      description: "Çıkış sonrası tam temizlik ve çarşaf/havlu değişimi.",
      dueAt: r.departureDate,
      status: "todo",
      priority: "standard",
      checklistJson: supplyChecklistJson,
    });
  }

  if (data.length === 0) return 0;
  await prisma.task.createMany({ data });
  return data.length;
}

/**
 * When a reservation is cancelled, drop its still-pending AUTO-generated tasks
 * (check-in prep / cleaning) so the cleaning list never shows work for a guest who
 * isn't coming. Only the auto task TYPES (check-in prep / cleaning) are removed;
 * tasks of OTHER types on the booking (maintenance/laundry/…) are preserved, and
 * only incomplete ones (a task already "done" stays as history). Scoped to
 * origin:"system" (see the where-clause) so a host's OWN manually-created or a
 * message-driven (ai) check-in/cleaning task on this reservation SURVIVES the
 * cancellation — only lifecycle-generated tasks are dropped.
 * Best-effort + idempotent: safe to call on every sync. Returns the number removed.
 */
export async function removeAutoTasksForCancelledReservation(reservationId: string): Promise<number> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  });
  if (!r || r.status !== "cancelled") return 0;
  const { count } = await prisma.task.deleteMany({
    where: {
      reservationId,
      status: { not: "done" },
      type: { in: ["checkin_prep", "cleaning"] },
      // ONLY lifecycle-generated tasks: a host's own task tied to this
      // reservation (origin manual) or a message-driven one (ai) must survive
      // the booking being cancelled — deleting them destroyed user data.
      origin: "system",
    },
  });
  return count;
}

/**
 * Backfill tasks for every existing reservation in an organization.
 * Used when reservations were imported (e.g. via iCal) before task automation
 * existed. Idempotent: createReservationTasks skips reservations that already
 * have tasks and ignores past-dated stays. Returns how many were processed and
 * how many tasks were actually created.
 */
export async function backfillReservationTasks(
  organizationId: string,
): Promise<{ processed: number; created: number }> {
  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { not: "cancelled" },
    },
    select: { id: true },
  });

  let created = 0;
  for (const r of reservations) {
    created += await createReservationTasks(r.id);
  }
  return { processed: reservations.length, created };
}

/** Reservation created → prepare check-in & checkout cleaning tasks + notify owners. */
export async function applyReservationCreatedRules(reservationId: string): Promise<void> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      property: { select: { name: true, address: true, city: true, organizationId: true } },
    },
  });
  if (!r || r.status === "cancelled") return;

  await createReservationTasks(r.id);

  // Fetch all owner/manager users in this organization for the reservation email.
  const orgUsers = await prisma.user.findMany({
    where: {
      organizationId: r.property.organizationId,
      role: { in: ["owner", "manager"] },
    },
    select: { email: true, name: true },
  });

  const propertyData = {
    name: r.property.name,
    address: r.property.address,
    city: r.property.city,
  };

  const html = reservationCreatedEmail(
    {
      id: r.id,
      guestName: r.guestName,
      guestEmail: r.guestEmail,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      channel: r.channel,
      status: r.status,
      totalAmount: reservationAmountNumber(r),
      currency: r.currency,
      notes: r.notes,
    },
    propertyData,
  );

  // ⚠️ `send` DEĞİL `sendReporting` (denetim, 08-01 — üçüncü tur). `send` sonucu
  // YUTAR ve `void` döner: sağlayıcı 5xx dönse bile burada hiçbir iz kalmazdı ve
  // host yeni rezervasyondan HABERSİZ kalırdı. Sonuç okunuyor, arıza koşu başına
  // TEK toplu alarma gidiyor (org'un 5 sahibi varsa 5 ayrı alarm değil).
  // ⚠️ Alarm PII TAŞIMAZ: yalnız sayı — misafir adı/e-posta/mülk adı YOK.
  let mailFailures = 0;
  for (const user of orgUsers) {
    const res = await emailService
      .sendReporting(user.email, `Yeni Rezervasyon: ${r.guestName} — ${r.property.name}`, html)
      .catch(() => ({ ok: false as const }));
    if (!res.ok) mailFailures += 1;
  }
  if (mailFailures > 0) {
    void reportError(
      `reservation-created-mail org=${r.property.organizationId}`,
      new Error(`${mailFailures}/${orgUsers.length} yeni-rezervasyon bildirimi gönderilemedi`),
    );
  }
}

export interface InboundRuleResult {
  intent: string;
  priority: string;
  isComplaint: boolean;
}

/**
 * Inbound guest message received → classify, set conversation priority/status,
 * and on complaint, escalate (mark problem + open a maintenance task).
 */
export async function applyInboundMessageRules(
  conversationId: string,
  messageBody: string,
): Promise<InboundRuleResult> {
  const result = await classifyMessage(messageBody);

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      propertyId: true,
      guestIdentifier: true,
      status: true,
      channel: true,
      priority: true,
      // m48 TAZELİK ÇAPASI: triyaj yazması bu değere KOŞULLU (↓). Aynı
      // `findUnique` içinde okunuyor ki çapa ile tetikleyici mesaj id'si TEK
      // tutarlı anlık görüntüden gelsin.
      lastMessageAt: true,
      // KVKK: şikayet görevi misafirin ADINI (başlık) ve MESAJINI (açıklama)
      // taşıyor. İki temizlik süpürgesi de kapsamı `reservationId` ile kuruyor,
      // yani rezervasyona BAĞLI OLMAYAN bir görev onlar için görünmez. Bu alan
      // o yüzden okunuyor (derin denetim, 08-01).
      reservationId: true,
      // ⚠️ REZERVASYONSUZ (YETİM) KONUŞMADA TEK BAĞ BUDUR (denetim, 08-01 —
      // ikinci tur). `reservationId` bir konuşma PMS'e bağlanamadığında null
      // kalır; o hâlde görev İKİ süpürgeye de görünmez olur çünkü ikisi de
      // kapsamı rezervasyondan kurar. Süre bazlı süpürgenin YETİM DALI ise
      // yalnız Message + Conversation'a dokunuyor. `sourceMessageId` görevi
      // konuşmanın mesajına bağlar ve yetim dalı onu bulabilir.
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
      property: {
        select: { name: true, address: true, city: true, organizationId: true },
      },
    },
  });
  if (!conversation) {
    return { intent: result.intent, priority: result.priority, isComplaint: result.isComplaint };
  }

  if (result.isComplaint) {
    await prisma.$transaction([
      prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "problem", priority: "urgent" },
      }),
      // m48 — YOL 3/3: KELİME yolu (üçüncü escalation yolu; kod-denetimi 08-09'a
      // kadar tasarımda hiç yoktu).
      //
      // 🚨 KAYNAK "keyword", "model" DEĞİL: bu yolun sınıflandırıcısı
      // `classifyMessage` ve gövdesi TEK SATIR — `return classifyFallback(msg)`.
      // Yani model HİÇ koşmuyor; "model" yazmak arayüze yalan söyletirdi.
      //
      // 🚨 ÜSTTEKİ `update` KOŞULSUZ ve ÖYLE KALIYOR — mevcut davranışı
      // değiştirmiyoruz. Triyaj AYRI ve KOŞULLU bir yazma: üstteki claim
      // koşulunu (`status`) körlemesine kopyalamak yerine KENDİ tazelik çapasını
      // kullanıyor. Araya yeni bir mesaj girmişse `count === 0` olur ve triyaj
      // YAZILMAZ.
      //
      // 🚨 `count === 0` PENCERESİNİN TAM SONUCU (Codex, 08-09 — eski yorum
      // eksikti): status KOŞULSUZ yazıldığı için konuşma "problem" listesine
      // GİRER, ama üzerindeki altı alan ÖNCEKİ escalation'a ait kalır. Bu
      // "yazmamak" değil, "eski snapshot'ın ayakta kalması"dır ve korumayı
      // OKUMA YÜZEYİ üstlenir: `aiTriageTriggerMessageId` mevcut son inbound
      // mesajla uyuşmadığı için satır BAYAT işaretlenir (`isTriageStale`) ve
      // panel "Bu analizden sonra yeni mesaj geldi" rozetini çizer.
      // Kısmi yazma İMKÂNSIZ: tek `updateMany`, altı alan — ya hepsi ya hiçbiri.
      // Uçtan uca kanıt: `tests/integration/ai-triage-stale-window.test.ts`.
      prisma.conversation.updateMany({
        where: { id: conversationId, lastMessageAt: conversation.lastMessageAt },
        data: buildTriageData({
          source: "keyword",
          triggerMessageId: conversation.messages[0]?.id ?? null,
          now: new Date(),
        }),
      }),
      prisma.task.create({
        data: {
          propertyId: conversation.propertyId,
          // ⚠️ SÜPÜRGELERİN BULABİLMESİ İÇİN ŞART (derin denetim, 08-01). Bu satır
          // yokken görev YALNIZ `propertyId` taşıyordu; her iki temizlik süpürgesi
          // de (`anonymizeOldGuestData` ve `maskReservationRows`) kapsamı
          // `reservationId` üzerinden kuruyor → görev ikisi için de GÖRÜNMEZDİ.
          // Yani başlıktaki misafir adı ve açıklamadaki mesaj metni, hem süre
          // bazlı anonimleştirmeden hem AÇIK SİLME talebinden sağ çıkıyordu.
          reservationId: conversation.reservationId,
          // Yetim konuşmada süpürgelerin bulabildiği TEK bağ (↑select yorumu).
          sourceMessageId: conversation.messages[0]?.id ?? null,
          type: "maintenance",
          origin: "ai",
          title: `Şikayet: ${conversation.guestIdentifier}`,
          description: messageBody.slice(0, 500),
          status: "todo",
          priority: "urgent",
        },
      }),
    ]);

    // Email all owner/manager users in the organization about the complaint.
    const orgUsers = await prisma.user.findMany({
      where: {
        organizationId: conversation.property.organizationId,
        role: { in: ["owner", "manager"] },
      },
      select: { email: true, name: true },
    });

    const orgRecord = await prisma.organization.findUnique({
      where: { id: conversation.property.organizationId },
      select: { name: true },
    });

    const html = complaintEscalationEmail(
      {
        id: conversation.id,
        guestIdentifier: conversation.guestIdentifier,
        channel: conversation.channel,
        priority: "urgent",
      },
      messageBody,
      {
        name: conversation.property.name,
        address: conversation.property.address,
        city: conversation.property.city,
      },
      orgRecord?.name ?? "GuestOps",
    );

    // BUGÜNKÜ SESSİZ-KAYIP DESENİNİN SON KOPYASI (denetim, 07-31).
    //
    // Yukarıdaki TX konuşmayı zaten "problem"e taşıdı. `sendDueAlerts` yalnız
    // status:"new" seçtiği için bu satır bir daha ASLA seçilmez → e-posta
    // gitmezse host'a giden TEK bildirim kalıcı kaybolur. Eskiden `void
    // emailService.send(...)` idi: ne await ediliyor, ne sonucu okunuyor, ve
    // `send()` sağlayıcı hatasında yalnız console'a yazıyor.
    //
    // Burada claim GERİ ALINMAZ — kardeş yollardan farkı: bu yol host'un KENDİ
    // oluşturduğu konuşmadan tetikleniyor (POST /api/conversations), yani host
    // zaten ekranın başında ve konuşma "Sorunlu" rozetiyle önünde duruyor. Geri
    // almak, host'un az önce yarattığı satırın durumunu gözünün önünde geri
    // çevirmek olurdu. Doğru davranış: gönderemediğimizi GÖRÜNÜR yapmak.
    // PARALEL: bu fonksiyon `POST /api/conversations` içinde AWAIT ediliyor,
    // yani HTTP yanıtı bekliyor. Seri döngüde 5 yöneticili bir işletmede
    // sağlayıcı yavaşlarsa 5 × 15 sn = 75 saniye asılı kalırdı ve host konuşmanın
    // yaratılıp yaratılmadığını bilemezdi — sessiz kaybı düzeltirken görünür bir
    // arıza eklemek olurdu. `allSettled`: aynı görünürlük, tek tur süresi.
    const mails = await Promise.allSettled(
      orgUsers.map((user) =>
        emailService.sendReporting(
          user.email,
          `Acil Şikayet: ${conversation.guestIdentifier} — ${conversation.property.name}`,
          html,
        ),
      ),
    );
    const alertFailures = mails.filter(
      (m) => m.status === "rejected" || !m.value.ok,
    ).length;
    if (alertFailures > 0) {
      void reportError(
        `applyInboundMessageRules org=${conversation.property.organizationId}`,
        new Error(`complaint alert e-mail failed for ${alertFailures}/${orgUsers.length} recipient(s)`),
      );
    }
  } else if (conversation.status === "closed" || conversation.status === "answered") {
    // Re-open as needing attention when a new inbound arrives.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "new", priority: result.priority },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { priority: result.priority },
    });
  }

  return { intent: result.intent, priority: result.priority, isComplaint: result.isComplaint };
}

// ---------------------------------------------------------------------------
// Channel (Airbnb / Booking via Hospitable) AI auto-reply
//
// Unlike WhatsApp (which is webhook-driven and instant), channel messages are
// pulled in by sync (polling). So channel auto-reply runs as a pass after each
// sync, gated to an active-hours window in the org timezone — e.g. answer guests
// automatically only between 00:00 and 09:00. It SENDS first (via the same
// transport as manual replies) and only persists when delivery succeeds, so we
// never record a reply that didn't reach the guest. Complaints, risky, and
// low-confidence messages are always left for a human.
// ---------------------------------------------------------------------------

export interface ChannelAutoReplyOptions {
  /** Compute the draft but do not send or persist (preview / test). */
  dryRun?: boolean;
  /** Skip the active-hours window check (used by the preview). */
  ignoreSchedule?: boolean;
  /** Skip the org on/off toggle check (used by the preview). */
  ignoreToggle?: boolean;
}

export interface ChannelAutoReplyOutcome {
  sent: boolean;
  /** Why no message was sent (when sent=false). */
  skippedReason?: string;
  /** The AI draft, when one was produced (dry-run preview or before sending). */
  draft?: { reply: string; intent: string; confidence: number; riskLevel: string };
  guestIdentifier?: string;
  propertyName?: string;
  /**
   * Durable Outbox (flag ON): true when the reply was ENQUEUED for the worker to
   * deliver rather than delivered inline. `sent` is still true (the auto-send
   * decision fired + is durable), but the guest receives it once the worker settles.
   */
  queued?: boolean;
}

/**
 * Geri çekilme pencereleri — KALICI bir gönderim hatasından sonra AI'nın o
 * konuşmada ne kadar susacağı. DAMGA DEĞİL: süre dolunca mesaj yeniden denenir,
 * yani hiçbir misafir mesajı kalıcı olarak cevapsız bırakılmaz. Amaç yalnız
 * SIKLIĞI düşürmek — damgasız hâlde her 2 dakikada bir model çağrısı + kota
 * birimi yanıyordu (denetim, 08-01).
 *
 * 4 saat: 402 (abonelik pasif) / 401-403 (yetki) / 404-422 (istek reddedildi).
 * Hepsi host bir şey düzeltene kadar sürer; 2 dakikada bir denemenin faydası yok.
 */
/**
 * Bir alarm penceresi bildirim gönderilemediği için geri alınırken yazılan KISA
 * geri çekilme. Sıfıra (epoch) çekmek 2 dakikalık cron'da sönümlemeyi tamamen
 * kaldırıyordu (↓`reportLifecycleSendFailures`).
 */
const ALARM_RETRY_BACKOFF_MS = 15 * 60 * 1000;

// ⚠️ TANIM `outbox/state.ts`'e TAŞINDI (denetim, 08-01 — üçüncü tur): kuyruk
// yolu da artık aynı geri çekilmeyi uyguluyor ve worker `automation.ts`'i import
// edemez (döngü). Buradan yeniden ihraç ediliyor — mevcut çağrı yerleri ve
// testler değişmedi.
export { SEND_FAILURE_HOLD_MS, SEND_RATE_LIMIT_HOLD_MS } from "@/lib/outbox/state";

/**
 * Evaluate (and unless dryRun, deliver) an AI auto-reply for a single channel
 * conversation. All safety gates are re-checked here, so callers can pass a
 * broad candidate set safely.
 */
export async function applyChannelAutoReply(
  conversationId: string,
  options: ChannelAutoReplyOptions = {},
): Promise<ChannelAutoReplyOutcome> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      property: {
        select: {
          name: true,
          organizationId: true,
          checkInTime: true,
          checkOutTime: true,
          address: true,
          city: true,
          organization: {
            select: {
              autoReplyHospitable: true,
              language: true,
              timezone: true,
              autoReplyStartHour: true,
              autoReplyEndHour: true,
              aiReplyTone: true,
              aiSignature: true,
              aiStyleProfile: true,
              autoReplyDisclosure: true,
              autoClosingReplyEnabled: true,
              closingReplyText: true,
              lateCheckoutOfferText: true,
              handoffHoldHours: true,
            },
          },
        },
      },
      reservation: {
        select: {
          id: true,
          guestName: true,
          arrivalDate: true,
          departureDate: true,
          status: true,
          guestCheckoutTime: true,
        },
      },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation) return { sent: false, skippedReason: "not_found" };
  const meta = { guestIdentifier: conversation.guestIdentifier, propertyName: conversation.property.name };
  const org = conversation.property.organization;

  // Must be a conversation we can actually reply to on its channel.
  if (!conversation.externalReservationId) return { sent: false, skippedReason: "no_external_target", ...meta };
  // A complaint has already escalated to a human — never auto-reply to it.
  if (conversation.status === "problem") return { sent: false, skippedReason: "complaint", ...meta };
  // Human-handoff hold: the guest asked to speak to the host, so we already sent a
  // holding reply and paused the AI for a while to let the host take over.
  if (conversation.autoReplyHoldUntil && conversation.autoReplyHoldUntil > new Date()) {
    if (!options.dryRun) await persistRiskVisibility(conversation.id, "human_hold");
    return { sent: false, skippedReason: "human_hold", ...meta };
  }
  // The guest's stay is over (or the booking was cancelled) — the AI has no
  // business replying to a finished reservation.
  if (conversation.reservation) {
    if (conversation.reservation.status === "cancelled") {
      if (!options.dryRun) await persistRiskVisibility(conversation.id, "reservation_ended");
      return { sent: false, skippedReason: "reservation_ended", ...meta };
    }
    if (conversation.reservation.departureDate < zonedDayRange(new Date(), orgTimezone(org.timezone)).start) {
      // Istanbul day boundary (not server UTC) — otherwise a guest still checked in
      // on checkout-day morning (departureDate at Istanbul midnight = before UTC
      // midnight) would be wrongly treated as departed and the reply skipped.
      if (!options.dryRun) await persistRiskVisibility(conversation.id, "reservation_ended");
      return { sent: false, skippedReason: "reservation_ended", ...meta };
    }
  }

  if (!options.ignoreToggle && !org.autoReplyHospitable) {
    return { sent: false, skippedReason: "disabled", ...meta };
  }
  if (!options.ignoreSchedule) {
    const hour = currentHourInTimeZone(org.timezone);
    if (!isWithinActiveHours(org.autoReplyStartHour, org.autoReplyEndHour, hour)) {
      // Sebep GÖRÜNÜR olmalı. Bu, mevcut müşterilerin (şema varsayılanı hâlâ
      // 00:00–09:00) gündüz mesajlarının sessizce cevapsız kalmasının TEK
      // sebebi — ve hiçbir ekranda yazmıyordu. Host "AI neden cevap vermedi?"
      // sorusunu ancak Ayarlar'daki pencereyi kendisi fark ederse çözebiliyordu.
      if (!options.dryRun) await persistRiskVisibility(conversation.id, "outside_hours");
      return { sent: false, skippedReason: "outside_hours", ...meta };
    }
  }

  let messages = conversation.messages;
  if (messages.length === 0) return { sent: false, skippedReason: "no_messages", ...meta };
  let last = messages[messages.length - 1];
  // A superseded AI draft (send-time veto → its outbox row is 'canceled') never reached the
  // guest, so it must NOT make the thread look answered. Such a draft is always an UNDELIVERED
  // outbound message (no externalId) — the only shape the tail can take here — so we only touch
  // the outbox when the newest message actually looks like one, keeping the hot path free of an
  // extra query in the normal case (guest spoke last, or the last reply was truly delivered).
  //
  // ⚠️ İKİ GENİŞLETME (denetim, 08-01 — üçüncü tur, ajan bulgusu):
  //
  // (a) KAPSAM: eskiden yalnız `canceled` ayıklanıyordu. Oysa `failed`/`blocked`/
  //     `review` satırların taslakları da misafire ULAŞMAMIŞTIR — üstelik onlar
  //     KALICI durumlardır. Ayıklanmadıkları için thread "cevaplanmış" görünüyordu.
  //     `pending`/`sending`/`ambiguous`/`reconciling` BİLEREK DIŞARIDA: onlar
  //     UÇUŞTA, birazdan ya teslim olacak ya terminal duruma düşecek; ayıklamak
  //     her turda gereksiz bir model çağrısı + kota birimi yakardı.
  //
  // (b) TETİKLEYİCİ: eski koşul yalnız SON mesaj teslim edilmemiş bir outbound
  //     iken koşuyordu. Misafir o taslaktan SONRA yazdıysa filtre atlanıyor ve
  //     hiç ulaşmamış taslak modelin geçmişine + kapı bağlamına giriyordu → model
  //     misafire ULAŞMAMIŞ bir cevabı vermiş sayıyor ("belirttiğim gibi…").
  //     Host'un inbox'ta gördüğü geçmiş ile modelin gördüğü geçmiş ayrışıyordu.
  //
  // ⚠️ Genişletilmiş tarama YALNIZ bayrak AÇIKKEN koşar: `MessageOutbox`'ta
  // `conversationId` index'i YOK (index eklemek migration ister, bilinçli
  // yapılmadı) ve bayrak KAPALIYKEN tablo zaten boştur → üretim davranışı ve
  // maliyeti BİREBİR aynı kalır.
  const tailLooksUndelivered = last.direction === "outbound" && !last.externalId;
  const anyUndeliveredOutbound =
    durableOutboxEnabled() && messages.some((m) => m.direction === "outbound" && !m.externalId);
  if (tailLooksUndelivered || anyUndeliveredOutbound) {
    const undelivered = await prisma.messageOutbox.findMany({
      where: {
        conversationId: conversation.id,
        // Terminal + teslim EDİLMEMİŞ durumlar (uçuştakiler bilinçli hariç).
        status: { in: ["canceled", "failed", "blocked", "review"] },
      },
      select: { messageId: true },
    });
    const undeliveredIds = new Set(undelivered.map((r) => r.messageId).filter(Boolean) as string[]);
    if (undeliveredIds.size > 0) {
      messages = messages.filter((m) => !undeliveredIds.has(m.id));
      if (messages.length === 0) return { sent: false, skippedReason: "no_messages", ...meta };
      last = messages[messages.length - 1];
    }
  }
  // Only answer when the guest spoke last (don't reply to ourselves).
  if (last.direction !== "inbound") return { sent: false, skippedReason: "already_answered", ...meta };

  // A bare "tamam / teşekkürler / ok 👍" closing after ANY reply (human or AI)
  // needs no answer — skip BEFORE spending a model call, and never butt into a
  // thread a human just wrapped up. Deterministic and conservative: a question
  // or any extra content ("teşekkürler, peki wifi şifresi?") never matches.
  const closingKind: CourtesyKind | null = isClosingAck(last.body)
    ? "ack"
    : isPositiveFeedback(last.body)
      ? "praise"
      : null;
  if (closingKind && messages.some((m) => m.direction === "outbound")) {
    // LOOP GUARD (both kinds): our latest outbound was itself the courtesy →
    // the guest is thanking/complimenting the thank-you. Stay SILENT — neither
    // a second courtesy nor a model draft (which would resurrect the gushy
    // improv this feature exists to replace).
    const lastOutbound = [...messages].reverse().find((m) => m.direction === "outbound");
    if (lastOutbound?.aiIntent === CLOSING_COURTESY_INTENT) {
      if (!options.dryRun) await persistRiskVisibility(conversation.id, "closing_ack");
      return { sent: false, skippedReason: "closing_ack", ...meta };
    }
    // Opt-in courtesy: when the org enabled it, answer the closing / pure
    // compliment ONCE with a deterministic line (never in dry-run). Any gate
    // saying no falls through: an "ack" keeps the classic silent skip, a
    // "praise" continues to the NORMAL model + safety-gate flow — exactly
    // today's behaviour.
    if (org.autoClosingReplyEnabled && !options.dryRun) {
      const courtesySent = await maybeSendClosingCourtesy({
        organizationId: conversation.property.organizationId,
        conversation: {
          id: conversation.id,
          channel: conversation.channel,
          guestIdentifier: conversation.guestIdentifier,
          externalReservationId: conversation.externalReservationId,
        },
        messages,
        lastInbound: { id: last.id, body: last.body },
        kind: closingKind,
        org,
      });
      if (courtesySent) {
        // Gölge kapsamı (Codex): nezaket kapanışı da bir OTOMATİK GÖNDERİM
        // kararıdır (whitelist yanlış-pozitifi olsaydı GLM burada "escalate"
        // diyecekti) — pilot bu kararı da görsün. Karar yetkisi yine sıfır.
        void recordShadowVerdict({
          organizationId: conversation.property.organizationId,
          conversationId: conversation.id,
          triggerId: last.id,
          guestMessage: last.body,
          guestName: conversation.guestIdentifier,
          reservationGuestName: conversation.reservation?.guestName,
          gateDecision: "auto_sent",
        });
        return { sent: true, ...meta };
      }
    }
    if (closingKind === "ack") {
      if (!options.dryRun) await persistRiskVisibility(conversation.id, "closing_ack");
      return { sent: false, skippedReason: "closing_ack", ...meta };
    }
  }

  // BAĞLANTI KONTROLÜ MODEL ÇAĞRISINDAN ÖNCE (denetim, 07-31).
  //
  // Bu kontrol eskiden model çağrısının ALTINDAYDI ve `not_connected` bilerek
  // `autoReplyAttemptedAt` damgalamıyordu ("koşullar değişince tekrar dene").
  // İkisi birleşince şu oluyordu: Hospitable bağlantısı kopmuş bir org'un
  // cevaplanmamış her konuşması, HER 2 DAKİKADA yeniden modelleniyor, üretilen
  // taslak hiçbir yere yazılmadan atılıyordu — sonsuza kadar, tek kuruş fayda
  // olmadan. Kontrolü öne almak damgalamaya gerek bırakmadan durdurur: host
  // yeniden bağlandığında konuşma hâlâ uygun olduğu için normal şekilde işlenir.
  //
  // dryRun (önizleme/test kartı) HARİÇ: orada gönderim yok, amaç taslağı görmek.
  let hospitableToken: string | null = null;
  if (!options.dryRun) {
    hospitableToken = await getOrgHospitableToken(conversation.property.organizationId);
    if (!hospitableToken) {
      // SEBEP GÖRÜNÜR OLMALI: bağlantı kopukken hiçbir mesaj yanıtlanmıyor ve
      // eskiden hiçbir konuşmada sebep yazmıyordu. Bağlantı kartı da "Bağlı"
      // dediği için (token çözülüyor = sağlıklı sayılıyor) arıza tamamen
      // görünmez oluyordu — host "AI neden sustu?" sorusuna hiçbir yerde cevap
      // bulamıyordu.
      await persistRiskVisibility(conversation.id, "not_connected");
      return { sent: false, skippedReason: "not_connected", ...meta };
    }

    // GÜNLÜK AI BÜTÇESİ BU YOLU DA KAPSAR (kullanıcı kararı, 07-31).
    //
    // Denetim: kota panelde "günde N AI işlemi" diye satılıyordu ama en büyük
    // harcama kalemi — misafire giden otomatik yanıt — sayaca HİÇ dokunmuyordu.
    // Yani hem müşteriye söylenen tavan uygulanmıyordu hem de maliyet
    // korumasının asıl hedefi kapsam dışıydı.
    //
    // KONUM: model çağrısının HEMEN öncesi, ucuz deterministik atlamaların
    // (already_answered / closing_ack / outside_hours / disabled / not_connected)
    // TAMAMINDAN sonra. Maliyet burada başlıyor; daha erken tüketmek cevaplanmayacak
    // thread'ler için kota yakardı.
    //
    // dryRun HARİÇ: önizleme/test kartı kendi rotasında zaten kotadan düşüyor,
    // burada ikinci kez saymak müşteriyi çifte cezalandırırdı.
    //
    // Tavana çarpınca konuşma "new" kalır ve `autoReplyAttemptedAt` DAMGALANMAZ
    // → pencere dönünce normal şekilde yanıtlanır. Kayıp değil, gecikme; ve
    // sebep host'a inbox'ta yazılı olarak görünür.
    // ÖNCE BAK, SONRA TÜKET (denetim, 08-01). Eskiden burada doğrudan
    // `consumeDailyAiBudget` vardı ve model çağrısı BAŞARISIZ olsa bile birim
    // yanıyordu: OpenAI 30 dakika düşerse `suggestReply` fallback'e döner, kapı
    // reddeder, konuşma damgalanmaz ve 2 dakika sonra aynı şey tekrarlanır —
    // sıfır lira harcanmışken Başlangıç planının 150 birimi ~1 saatte biter ve
    // servis geri dönse bile org'un TÜM oto-yanıtı 24 saat durur. Tüketim artık
    // model GERÇEKTEN yanıt verdiğinde yapılıyor (↓`source === "openai"`).
    const budget = await peekDailyAiBudget(conversation.property.organizationId);
    if (!budget.ok) {
      await persistRiskVisibility(conversation.id, "daily_budget");
      return { sent: false, skippedReason: "daily_budget", ...meta };
    }
  }

  // Tek yol `ai/kb-fetch.ts`: tavan + "kaç tanesi düştü" oradan gelir. Burası
  // uzun süre sabit 40'tı (test kartı ve "AI öner" 30 okurken), yani ne yüzeyler
  // arasında parite ne de ekrandaki "en fazla 30 okur" uyarısı doğruydu.
  const kbFetch = await fetchKnowledgeBaseForPrompt({
    propertyId: conversation.propertyId,
    isActive: true,
  });
  // SELAM TEKRARI (canlı kusur 09-08, QR'da gözlendi — bu yol AYNI istemi
  // kullandığı için aynı kusuru taşıyordu). "Daha önce cevap verdik mi" KODDA
  // hesaplanır; yüklü `messages` penceresine DEĞİL konuşmanın TAMAMINA bakar
  // (pencere bir gösterim tavanıdır, gerçeğin kaynağı değil). Sistem olayı ve
  // gövdesiz satır cevap sayılmaz: misafir onları görmez.
  const priorOperatorReplies = await prisma.message.count({
    where: {
      conversationId: conversation.id,
      direction: "outbound",
      systemEventType: null,
      NOT: { body: "" },
    },
  });
  const { items: kbRaw, dropped: kbDropped } = kbFetch;
  // Resolve any {isim} placeholder in KB entries (e.g. the welcome template) to
  // the guest's name before it reaches the model, so a literal "{isim}" can
  // never leak into a reply.
  const guestFirst = guestFirstName(conversation.guestIdentifier) ?? "misafirimiz";
  // A2 — TEMELLENDİRME SAYAÇLARI (tek yerde kurulur, her karar kaydına aynen
  // gider). `kbRetrieved` istemin GÖRÜNEN kalem sayısıdır; aşağıda `kbVisible`
  // hesaplandıktan sonra tamamlanır — burada yalnız kapasite/yetki/sürüm
  // tarafı sabitleniyor.
  const groundingBase = {
    kbPendingApproval: kbFetch.pendingApproval,
    kbNewestUpdatedAt: kbFetch.newestUpdatedAt,
  };
  const kb = kbRaw.map((k) => ({
    ...k,
    content: fillPlaceholders(k.content, guestFirst, conversation.property.name),
  }));
  // 🚨 REZERVASYON ÖNCESİ SIR KAPISI — KOD, PROMPT DEĞİL (denetim 08-09).
  //
  // Rezervasyonu OLMAYAN bir kişi (Airbnb ön sorusu) yazdığında bilgi tabanı
  // ham hâliyle prompt'a giriyordu: kapı kodu, wifi şifresi, kasa. Tek koruma
  // `prompts.ts`teki rezervasyon-öncesi paragrafıydı — üstelik ÖNBELLEKLİ
  // sistem önekindeki 24 few-shot örneğin BEŞİ wifi şifresini VEREREK
  // gösteriyor. Deterministik injection vetosu da düz dilde çalışmıyor
  // (ölçüldü: 20 sade parafrazın 15'i oto-gönderim izni aldı).
  //
  // Aynı eleme QR concierge yolunda ZATEN vardı; asimetri tersti — insan
  // olmadan gönderen yüzey korumasızdı.
  //
  // ⚠️ KOŞULLU: onaylı/tamamlanmış konaklamada UYGULANMAZ. Rezervasyonlu
  // misafire kapı kodunu vermek ürünün ta kendisidir. Yüklem `prompts.ts`
  // `isConfirmedStay` ile BİREBİR aynı.
  // ⚠️ ÖLÇÜLDÜ (12 kalemlik gerçekçi KB): düşen 2 — Wi-Fi ve Giriş Talimatı.
  // Adres, acil telefon, otopark, çöp, ev kuralları, çevre, klima, çıkış,
  // ulaşım, check-in saati KALIYOR → aday müşteri hâlâ cevap alabiliyor.
  // ⚠️ `address` KB'den DEĞİL property kaydından ayrıca geçiyor; bu kapı onu
  // durdurmaz ve durdurmayı da amaçlamaz (bilinen sınır).
  const confirmedStay =
    conversation.reservation != null &&
    (conversation.reservation.status === "confirmed" ||
      conversation.reservation.status === "completed");
  // ⚠️ İKİ BACAK, TEK BACAK DEĞİL (denetim 08-09 — DÜN YAZDIĞIM KAPININ EKSİĞİ).
  // QR yolu (`guest-chat.ts:626`) iki eleme uygular: KATEGORİ (`wifi`/`checkin`
  // hiç ÇEKİLMEZ) **ve** içerik sezgiseli. Ben buraya yalnız içerik bacağını
  // koymuştum → insan olmadan gönderen yüzey, insanın gözden geçirdiği yüzeyden
  // ZAYIF kaldı; tam da düzeltmeye çalıştığım asimetrinin tersi. Ölçüldü (7
  // gerçekçi kalem): kategori bacağı olmadan prompt'a ulaşan 7/7, bacakla 2/7.
  // Sızan tipik kalem: "Anahtar kutusunun açılış dizisi: ABCD" — `general`
  // kategorisinde OLMADIĞI için değil, `looksLikeSecret`in RAKAM istemesi
  // yüzünden geçiyordu. Kategori bacağı bu sınıfı toptan kapatır.
  const kbVisible = confirmedStay
    ? kb
    : withoutSecretKbItems(
        kb.filter((i) => !(QR_SECRET_CATEGORIES as readonly string[]).includes(i.category)),
      );

  // RAG dilim 1 (09-09): SORUYA GÖRE SEÇİM — yetki/onay/sır süzgeçlerinden
  // SONRA, modelden ÖNCE. Bayrak (`KB_RETRIEVAL_MODE`) kapalıyken `kbSel.items`
  // `kbVisible`'ın KENDİSİDİR (aynı dizi) ve `droppedItems` 0 → canlı davranış
  // karakteri karakterine aynı. Hibritte seçilmeyen kalemler devir notunu
  // besler: retrieval kaçırırsa model "bilgim yok" DEMEZ, insana devreder.
  const kbSel = selectKbForPrompt({
    items: kbVisible,
    guestMessage: last.body,
    history: messages.map((m) => ({ direction: m.direction as "inbound" | "outbound", body: m.body })),
  });
  const kbForModel = kbSel.items;
  const kbDroppedTotal = kbDropped + (kb.length - kbVisible.length) + kbSel.droppedItems;

  // A2: istemin GERÇEKTEN taşıdığı kalem sayısı — `kbDroppedTotal` ile aynı
  // formül (`knowledgeBaseDropped`), yani sayaçlar modelin gördüğü bağlamla tutarlı.
  const grounding = {
    ...groundingBase,
    kbRetrieved: kbForModel.length,
    kbDropped: kbDroppedTotal,
    // Yetkili iç denetim kanıtı — `kbVisible` yer tutucu ikamesinden GEÇMİŞ
    // nesnelerdir ama `id`/`updatedAt` alanları kaynaktan olduğu gibi taşınır.
    // Hibritte parça indeksi (`chunk`) ve retrieval özeti de kanıta girer.
    kbEvidenceJson: buildKbEvidence({ retrieved: kbForModel, usedLabels: [], retrieval: kbSel.evidence }),
  };

  // Turnover context so early-checkin / late-checkout answers are data-driven.
  const adjacency = conversation.reservation
    ? await getAdjacency(
        conversation.propertyId,
        conversation.reservation.arrivalDate,
        conversation.reservation.departureDate,
      )
    : null;

  const result = await suggestReply({
    guestMessage: last.body,
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
    knowledgeBase: kbForModel,
    knowledgeBaseSelection: kbSel.selection,
    // 🚨 SÜZÜLEN KALEMLER DE SAYIYA GİRER (savunmacı denetim 08-09).
    // İlk yazımım yalnız SQL tavanında düşenleri geçiriyordu. Sonuç ölçüldü ve
    // KÖTÜYDÜ: kapı iki kalemi elerken modele "0 kalem düştü" deniyordu, yani
    // prompt bilgi tabanını TAM sanıyor ve "bilgi yok DEME, insana devret"
    // notu HİÇ gitmiyordu. En kötü hâl: yalnız Wi-Fi ve Giriş şablonlarını
    // doldurmuş bir host'ta süzgeç boş liste döndürüyor ve prompt aday
    // müşteriye "(bilgi tabanı boş — bu mülk için kayıtlı bilgi yok)" diyor —
    // insan olmadan, oto-gönderilerek. Doğru sayıyla mesaj "alınamadı, konuyu
    // insana devret"e dönüyor.
    // ⚠️ Kardeş yolun formülüyle BİREBİR aynı (`guest-chat.ts` droppedTotal) —
    // o yol bu hatayı 07-31'de zaten yaşamış ve düzeltmişti. Hibrit seçimde
    // seçilmeyen kalemler de toplama girer (`kbSel.droppedItems`).
    knowledgeBaseDropped: kbDroppedTotal,
    history: messages.map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
    })),
    conversationState: { isFirstOperatorReply: priorOperatorReplies === 0 },
    tone: VALID_TONES.includes(org.aiReplyTone as ReplyTone)
      ? (org.aiReplyTone as ReplyTone)
      : "warm",
    language: org.language ?? "tr",
    // 🚨 SÜZÜLEREK GEÇER (denetim 08-09). Profil, host'un BAŞKA misafirlere
    // yazdığı ~40 yanıttan damıtılıyor ve o yanıtlar rutin olarak wifi şifresi /
    // kapı kodu içeriyor; damıtmadaki "dışarıda bırak" talimatı bir MODEL
    // RİCASI, deterministik garanti değil. QR yolu bunu zaten süzüyordu; oysa
    // asıl risk BU yüzeyde — burası insan olmadan oto-gönderiyor.
    // ⚠️ Süzgeç SATIR bazlı: yalnız sırra benzeyen satır düşer, üslup korunur
    // (KB'deki "kalemin tamamı düşer" sorunu burada YOK).
    styleProfile: scrubStyleProfileForPublic(org.aiStyleProfile),
    adjacency,
    lateCheckoutOfferText: org.lateCheckoutOfferText,
  });

  // If the guest stated their own departure time, record it on the reservation
  // so the dashboard can show it (falling back to the property default). Guarded
  // and best-effort — never blocks the reply. Skipped on dryRun so a PREVIEW
  // ("test quality") stays side-effect-free and never mutates a reservation.
  //
  // ⚠️ SALDIRGAN KONTROLLÜ MESAJDAN GELEN SAAT YAZILMAZ (denetim, 08-01).
  // Bu yazma güvenlik kapısından ÖNCE koşuyor ve bilinçli öyle: "yarın 11'de
  // çıkacağız ama klima bozuk, iade istiyorum" mesajı insana devredilir ve host
  // çıkış saatini TAM ORADA en çok ister — yazmayı kapının arkasına almak meşru
  // veriyi kaybettirirdi. Ama iki sınıf istisnadır:
  //   · prompt_injection → değer saldırganın seçtiği değerdir ve bir sonraki
  //     prompt'a GERİ BESLENİR ("misafirin belirttiği çıkış saati: X"),
  //   · rule_violation (overstay/çıkışı reddetme) → misafirin REDDETTİĞİ saat
  //     kalıcılaşırdı ("11:00'de çıkmıyoruz" → rezervasyona 11:00).
  // Deterministik dedektör, modelden bağımsız karar verir.
  const statedRisk = result.statedCheckoutTime ? detectRiskType(last.body) : null;
  const statedTimeTrusted =
    statedRisk !== "prompt_injection" && statedRisk !== "rule_violation";
  if (
    !options.dryRun &&
    result.statedCheckoutTime &&
    statedTimeTrusted &&
    conversation.reservation
  ) {
    try {
      await prisma.reservation.update({
        where: { id: conversation.reservation.id },
        data: { guestCheckoutTime: result.statedCheckoutTime },
      });
    } catch (err) {
      // Sessiz `catch {}` bu repoda belgeli bir anti-desen: yanıt bloke olmasın
      // ama kayıp da görünmez kalmasın (denetim, 08-01).
      void reportError(
        `statedCheckoutTime persist org=${conversation.property.organizationId}`,
        err,
      );
    }
  }

  // Close every reply in the host's voice: append their configured signature
  // (name + contact) so guests get a personal, on-brand sign-off. Build a new
  // string — never mutate the AI result object (it may be shared / reused).
  // Kota TÜKETİMİ burada: model gerçekten yanıt verdiyse (`source === "openai"`)
  // bir birim düşer. Fallback (anahtar yok / 4xx / 5xx / timeout / bozuk JSON)
  // hiçbir şeye mal olmadığı için sayılmaz — ↑`peekDailyAiBudget` gerekçesi.
  if (!options.dryRun && result.source === "openai") {
    await consumeDailyAiBudget(conversation.property.organizationId).catch(() => {});
  }

  const signature = org.aiSignature?.trim();
  // Draft / manual "AI suggest" stays clean: the host's words + their signature.
  const replyText =
    signature && result.reply ? `${result.reply.trimEnd()}\n\n${signature}` : result.reply;
  // The GUEST-FACING body of an AUTO-send also carries a short machine-prepared
  // note in the guest's language, so a guest can account for the rare mistake. The
  // note sits ABOVE the host's signature so the personal sign-off still closes the
  // message (a robotic disclaimer shouldn't be the last line). Draft/preview and
  // the manual "AI suggest" path stay clean — only the auto-send carries it.
  const note = automatedReplyNote(result.detectedLanguage, org.autoReplyDisclosure);
  const outboundParts = [result.reply.trimEnd()];
  if (note) outboundParts.push(note);
  if (signature) outboundParts.push(signature);
  const outboundBody = outboundParts.join("\n\n");

  // Safety gate: only auto-send safe, confident replies (cross-checked against
  // the guest's own words, so a mislabelled complaint/refund never slips through).
  // Context mirrors what the MODEL sees beyond last.body: the prompt's history
  // window (prompts.ts keeps the last 6) and both guest-name surfaces (the
  // reservation name goes into the prompt; guestIdentifier feeds the KB {isim}
  // fill) — an injection planted in any of them must veto the auto-send.
  // CEVAPLANMAMIŞ misafir mesajları = son GİDEN mesajdan sonrakiler. Misafir arka
  // arkaya yazdığında (şikayet + zararsız takip) kapı yalnız sonuncuyu görüyordu;
  // artık pencerenin tamamını görüyor. Pencere, biz cevap verince sıfırlanır —
  // yani "dünkü çözülmüş şikayet" bugünü engellemez.
  const lastOutboundIdx = messages.map((m) => m.direction).lastIndexOf("outbound");
  const pendingGuestMessages = messages
    .slice(lastOutboundIdx + 1)
    .filter((m) => m.direction === "inbound" && m.id !== last.id)
    .map((m) => m.body);

  const gateContext = {
    history: [...messages.slice(-6).map((m) => m.body), conversation.guestIdentifier ?? ""],
    guestName: conversation.reservation?.guestName ?? null,
    pendingGuestMessages,
  };
  if (!passesAutoReplySafetyGate(result, last.body, gateContext)) {
    // If the block was driven by a MODEL-detected sensitive signal (complaint /
    // refund / early-departure intent, medium/high risk, OR a high-stakes
    // riskType label) — not mere low confidence — actively escalate to the host
    // so it never sits silently in the inbox. The keyword path (sendDueAlerts)
    // already handles keyword-detectable cases and flags "problem" BEFORE this
    // runs; this closes the "model saw it, keywords missed it" gap. The riskType
    // leg (Codex 07-24 #1) covers the model's INCONSISTENT verdicts: riskLevel
    // "low" but riskType "safety_emergency"/"review_threat"/… — the gate blocks
    // the send on that label alone, so without this leg the thread sat silently
    // as low_confidence_or_risky. No handoff-ack exemption here: if the pair
    // (human_request/human_request) failed the gate anyway, the guest asked for
    // a human and got NO reply — the host must know. Atomic status claim →
    // can't double-email.
    const modelSensitive =
      result.source === "openai" &&
      (NEVER_AUTO_REPLY_INTENTS.has(result.intent) ||
        (result.riskLevel !== "none" && result.riskLevel !== "low") ||
        (result.riskType != null && HIGH_STAKES_RISK_TYPES.has(result.riskType)));
    if (!options.dryRun && modelSensitive) {
      try {
        const claimed = await prisma.conversation.updateMany({
          where: { id: conversation.id, status: { not: "problem" } },
          data: {
            status: "problem",
            priority: "urgent",
            skippedReason: "escalated_to_human",
            lastRiskLevel: result.riskLevel,
            lastRiskType: result.riskType ?? detectRiskType(last.body),
            // m48 — YOL 1/3: MODEL yolu. Modelin ZATEN ürettiği analiz burada
            // saklanıyor; yeni bir çağrı YOK. Altı alan da AÇIKÇA yazılır
            // (`buildTriageData` sözleşmesi): eksik bırakılan alan `undefined`
            // olur ve Prisma onu "dokunma" sayar → önceki escalation'ın analizi
            // hayatta kalır ve arayüz onu YENİ sanardı.
            // ⚠️ Tetikleyici mesaj `last.id` — yazma anında "son mesaj" diye
            // YENİDEN OKUNMAZ; okumak, bu claim'in kapattığı yarışı geri açardı.
            ...buildTriageData({
              source: "model",
              actionSuggestion: result.actionSuggestion,
              missingInfo: result.missingInfo,
              confidence: result.confidence,
              triggerMessageId: last.id,
              now: new Date(),
            }),
          },
        });
        if (claimed.count === 1) {
          // Per-tenant recipient: this org's own alert address, else the org
          // owner's account email. NEVER the env fallback (operator-only leak).
          const alertOrg = await prisma.organization.findUnique({
            where: { id: conversation.property.organizationId },
            select: {
              name: true,
              alertEmail: true,
              autoHoldingReplyEnabled: true,
              autoTaskFromMessageEnabled: true,
              autoReplyDisclosure: true,
              aiSignature: true,
              // The OWNER's email (role-filtered) — NOT merely the oldest user: a
              // staff-first org would otherwise leak the guest name + message body
              // + property to a staff account (same class of bug fixed in the QR
              // escalation alert). Falls back to nothing (never staff, never env).
              users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
            },
          });
          const to = alertOrg?.alertEmail?.trim() || alertOrg?.users[0]?.email?.trim();
          if (to) {
            const html = complaintEscalationEmail(
              {
                id: conversation.id,
                guestIdentifier: conversation.guestIdentifier,
                channel: conversation.channel,
                priority: "urgent",
              },
              last.body,
              {
                name: conversation.property.name,
                address: conversation.property.address,
                city: conversation.property.city,
              },
              alertOrg?.name ?? "Lixus AI",
            );
            // Sonucu OKU (`sendReporting`) ve başarısızsa claim'i geri al.
            // Eskiden `void emailService.send(...)` idi: `send` asla fırlatmaz,
            // dönüşü de beklenmiyordu → sağlayıcı hatası host'a giden TEK
            // bildirimi sessizce yutuyordu ve aşağıdaki catch'in "next sync
            // cycle retries via sendDueAlerts" iddiası YANLIŞTI (sendDueAlerts
            // yalnız status:"new" seçer, claim satırı çoktan "problem" yapmıştı).
            const mail = await emailService.sendReporting(
              to,
              `⚠️ Acil misafir mesajı — ${conversation.guestIdentifier} (${conversation.property.name})`,
              html,
            );
            if (!mail.ok) {
              // ⚠️ BURADA CLAIM **GERİ ALINMAZ** — kardeş `sendDueAlerts`'ten
              // BİLEREK farklı. İlk denemede burada da geri alma vardı; denetim
              // onun İKİ regresyon getirdiğini gösterdi ve geri alındı:
              //
              //  1. GÜVENLİK (ağır olan): claim aynı zamanda "bu thread insana
              //     ait" KİLİDİDİR (`:975` "problem" görünce erken döner). Geri
              //     alınca sonraki tur modele TEKRAR sorar; model hükmü
              //     medium→low oynarsa kapı geçebilir ve RİSKLİ sayılmış bir
              //     mesaja otomatik cevap gider. Kapının deterministik
              //     yedekleri `review_threat`/`platform_policy`/`access_security`
              //     sınıflarını KAPSAMAZ (yalnız safety/rule/discrimination) —
              //     yani bu yolda ikinci bir savunma YOK.
              //  2. MALİYET: bu yolda yaş penceresi yok (`freshSince` sabit
              //     damga) ve `escalated_to_human` `autoReplyAttemptedAt`
              //     damgalamıyor → e-posta kalıcı bozuksa her escalate edilmiş
              //     konuşma 2 dakikada bir yeniden modellenir, sonsuza kadar.
              //
              // `sendDueAlerts`'te geri alma DOĞRU kalır çünkü orada iki koruma
              // da var: 72 saatlik `ALERT_MAX_AGE_MS` penceresi tekrarları
              // sınırlar, ve o yolun claim ettiği mesajları kapının
              // deterministik `classifyFallback` çapraz-kontrolü zaten vetolar
              // (`fb.isComplaint || refund || early_departure`) — yani geri
              // alınmış bir kelime-şikayeti asla otomatik yanıtlanamaz.
              //
              // Buradaki taviz AÇIK: e-posta gitmezse host'a bildirim ulaşmaz.
              // Ama thread KALICI olarak "Sorunlu" kalır (inbox'ta görünür,
              // insanın önünde) ve arıza Sentry'ye düşer. Sessiz DEĞİL —
              // yalnız kanalı e-posta değil, panel.
              void reportError(
                `applyChannelAutoReply escalation org=${conversation.property.organizationId}`,
                new Error("escalation e-mail failed; thread stays 'problem' for the host"),
              );
            }
          }
          // Tier-2 holding acknowledgement (opt-in): a MILD model-detected
          // complaint (never high risk, never money/cancellation) may get one
          // immediate non-committal ack. The claim above is the idempotency
          // lock; the thread stays "problem" for the host either way.
          // ⚠️ E-POSTA BAŞARISIZLIĞI BU İKİ ŞEYİ İPTAL ETMEZ (denetim düzeltmesi).
          // Bir ara burada `!escalationMailFailed` kapısı vardı; o kapı claim'in
          // GERİ ALINDIĞI tasarıma aitti ("sonraki geçiş baştan alır"). Geri alma
          // kaldırılınca sonraki geçiş de kalmadı: konuşma kalıcı "problem" olur,
          // yani kapı, misafire gidecek bekletme mesajını ve panele düşecek görevi
          // KALICI olarak iptal ediyordu. Üstelik savunma "kanalı e-posta değil
          // PANEL" derken tam o panel sinyalini siliyordu. İkisi de e-postadan
          // BAĞIMSIZ; idempotency kilidi zaten claim.
          if (alertOrg && result.intent === "complaint" && result.riskLevel !== "high") {
            await maybeSendHoldingAck({
              organizationId: conversation.property.organizationId,
              conversation: {
                id: conversation.id,
                channel: conversation.channel,
                guestIdentifier: conversation.guestIdentifier,
                externalReservationId: conversation.externalReservationId,
              },
              guestMessage: last.body,
              org: alertOrg,
              language: result.detectedLanguage,
              complaintConfirmed: true,
              // `conversation` fonksiyonun BAŞINDA okundu → bu alan claim'den
              // ÖNCEKİ değer. Aday sorgusu (`dueAutoReplyWhere`) çitlenmiş
              // satırları zaten eliyor, ama bu fonksiyon doğrudan da çağrılıyor;
              // kapı çağıranın kim olduğuna bağlı kalmamalı.
              stayFencedBeforeClaim: conversation.skippedReason === "reservation_ended",
            }).catch(() => false);
          }
          // Smart operational task (opt-in): if this escalation carries a
          // physical-operations signal (fault / restock / cleaning), open a
          // deduped, SLA-dated task so the host can action it — not just the
          // "problem" flag + email. Best-effort: never blocks the escalation.
          if (alertOrg?.autoTaskFromMessageEnabled) {
            await createOperationalTaskFromMessage({
              propertyId: conversation.propertyId,
              message: last.body,
              sourceMessageId: last.id,
              reservationId: conversation.reservation?.id ?? null,
              ai: { intent: result.intent, riskType: result.riskType },
            }).catch(() => {});
          }
        }
      } catch (err) {
        // Escalation is best-effort; a db hiccup must never throw out of the
        // auto-reply pass. NOT silent any more: the old comment claimed "the
        // next sync cycle retries via sendDueAlerts", which was false — that
        // pass only selects status:"new" and the claim above already moved the
        // row to "problem". E-mail failure is handled explicitly (rollback)
        // just above; what lands here is a genuine DB/unknown error, so it gets
        // reported instead of vanishing.
        void reportError(
          `applyChannelAutoReply escalation org=${conversation.property.organizationId}`,
          err,
        );
      }
      await recordRiskEvent({
        organizationId: conversation.property.organizationId,
        propertyId: conversation.propertyId,
        conversationId: conversation.id,
        surface: "auto_reply",
        triggerId: last.id,
        finalDecision: "human_review",
        riskLevel: result.riskLevel,
        riskType: result.riskType ?? detectRiskType(last.body),
        reason: "escalated_to_human",
        confidence: result.confidence,
        ...grounding,
        srcDeclared: result.sourceAudit?.declared ?? null,
        srcVerified: result.sourceAudit?.verified ?? null,
      });
      // GLM gölge (Aşama-1): bağımsız ikinci hüküm, karar yetkisi SIFIR.
      // await YOK — gönderim/escalation yolunu bir milisaniye bile bekletmez.
      void recordShadowVerdict({
        organizationId: conversation.property.organizationId,
        conversationId: conversation.id,
        triggerId: last.id,
        guestMessage: last.body,
        guestName: conversation.guestIdentifier,
        reservationGuestName: conversation.reservation?.guestName,
        gateDecision: "human_review",
        gateRiskLevel: result.riskLevel,
        gateRiskType: result.riskType ?? detectRiskType(last.body),
      });
      return { sent: false, skippedReason: "escalated_to_human", ...meta };
    }
    if (!options.dryRun) {
      await persistRiskVisibility(
        conversation.id,
        result.source === "openai" ? "low_confidence_or_risky" : "ai_unavailable",
        result.riskLevel,
        result.riskType ?? detectRiskType(last.body),
      );
      await recordRiskEvent({
        organizationId: conversation.property.organizationId,
        propertyId: conversation.propertyId,
        conversationId: conversation.id,
        surface: "auto_reply",
        triggerId: last.id,
        finalDecision: "human_review",
        riskLevel: result.riskLevel,
        riskType: result.riskType ?? detectRiskType(last.body),
        reason: "low_confidence_or_risky",
        confidence: result.confidence,
        ...grounding,
        srcDeclared: result.sourceAudit?.declared ?? null,
        srcVerified: result.sourceAudit?.verified ?? null,
      });
      void recordShadowVerdict({
        organizationId: conversation.property.organizationId,
        conversationId: conversation.id,
        triggerId: last.id,
        guestMessage: last.body,
        guestName: conversation.guestIdentifier,
        reservationGuestName: conversation.reservation?.guestName,
        gateDecision: "human_review",
        gateRiskLevel: result.riskLevel,
        gateRiskType: result.riskType ?? detectRiskType(last.body),
      });
    }
    // ⚠️ "MODEL EMİN OLAMADI" ile "MODELE HİÇ ULAŞILAMADI" AYNI ŞEY DEĞİL
    // (denetim, 07-31). İkisi de buraya düşüyordu ve `runDueChannelAutoReplies`
    // `low_confidence_or_risky` gördüğünde `autoReplyAttemptedAt` DAMGALIYOR —
    // yani mesaj bir daha ASLA modellenmiyor. Sonuç: 30 dakikalık bir OpenAI
    // kesintisinde o pencerede gelen HER misafir mesajı, servis geri dönse bile
    // kalıcı olarak "insana bırakıldı" kalıyordu.
    //
    // Model gerçekten cevap verip emin olamadıysa damgalamak DOĞRU (aynı metni
    // 2 dakikada bir yeniden sormanın faydası yok). Ama modele ulaşılamadıysa
    // koşullar değişince tekrar denenmeli — tıpkı `not_connected` gibi.
    return {
      sent: false,
      skippedReason: result.source === "openai" ? "low_confidence_or_risky" : "ai_unavailable",
      ...meta,
    };
  }

  const draft = {
    reply: replyText,
    intent: result.intent,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
  };

  if (options.dryRun) {
    return { sent: false, skippedReason: "dry_run", draft, ...meta };
  }

  // GLOBAL MASTER KILL-SWITCH. Auto-replies are NEVER sent unless the
  // deployment explicitly sets AUTO_REPLY_ENABLED=1. This is a hard, env-level
  // guarantee on top of the per-org toggle and the active-hours window: with the
  // variable unset (the default), no automatic message can ever leave the
  // system — previews/tests still work, the AI just never delivers.
  if (process.env.AUTO_REPLY_ENABLED !== "1") {
    return { sent: false, skippedReason: "globally_disabled", draft, ...meta };
  }

  // No hourly cap: the system only ever replies to the guest's latest UNANSWERED
  // message (see the "already_answered" guard above), never initiates, and stays
  // silent on non-questions (low confidence) — so each guest message gets at most
  // one reply and nothing unsolicited goes out.

  // Deliver FIRST — never persist a reply that didn't reach the guest. Use THIS
  // org's own Hospitable token. Bağlantı ZATEN model çağrısından önce
  // doğrulandı (↑gerekçe); burada yalnız o değer kullanılıyor.
  const token = hospitableToken;
  if (!token) {
    return { sent: false, skippedReason: "not_connected", draft, ...meta };
  }

  // ── Durable Outbox path (flag ON) ──────────────────────────────────────────
  // Record the AI Message + a durable send-intent ATOMICALLY and let the worker
  // deliver, retry with backoff, and — per Codex #6 — mark the thread "answered"
  // ONLY on confirmed delivery. We deliberately do NOT claim "answered" here: the
  // outbound Message this enqueue creates makes the NEXT cycle skip (its last message
  // is now outbound → already_answered), and the tenant-scoped idempotencyKey
  // collapses any concurrent enqueue to a single row — so a queued-but-undelivered
  // reply never makes the conversation look handled. The auto-send DECISION is final +
  // durable here, so the decision-time bookkeeping (risk visibility, human-handoff
  // hold, RiskEvent) runs now; only delivery is deferred. externalId stays unset until
  // the worker confirms a provider id. Flag OFF (the production default) skips this
  // whole branch → the inline claim-then-send below runs BYTE-FOR-BYTE as before.
  if (durableOutboxEnabled() && conversation.externalReservationId) {
    let enq;
    try {
      enq = await enqueueOutbound({
        organizationId: conversation.property.organizationId,
        conversationId: conversation.id,
        channel: conversation.channel,
        externalReservationId: conversation.externalReservationId,
        reservationId: conversation.reservation?.id ?? null,
        body: outboundBody,
        senderName: "GuestOps AI", // AI-message classification magic string (unchanged)
        authorType: "ai",
        messageType: "ai",
        aiAssisted: true,
        aiIntent: result.intent,
        aiConfidence: result.confidence,
        aiSourcesJson: result.usedSources.length ? JSON.stringify(result.usedSources) : null,
        // Tenant-scoped idempotency: this exact inbound message → at most one queued reply.
        idempotencyKey: `auto:${conversation.id}:${last.id}`,
      });
    } catch (err) {
      // enqueueOutbound is atomic: a real failure (not a dedupe-hit, which returns
      // cleanly) left NOTHING persisted, so a later cycle simply retries. There is no
      // claim to roll back — we never marked the thread.
      return { sent: false, skippedReason: `enqueue_failed: ${redactSensitive(String(err))}`, draft, ...meta };
    }
    // A concurrent run already queued this exact reply — don't double-count or re-run
    // the decision bookkeeping (the winner already did it).
    if (enq.deduped) return { sent: false, skippedReason: "already_queued", draft, ...meta };

    // Decision metadata only — NOT status/lastMessageAt (#6: the worker sets "answered"
    // + the delivery time on confirmed send). lastRiskLevel/Type describe the GUEST
    // message, so they are valid regardless of when delivery lands.
    await prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { skippedReason: null, lastRiskLevel: result.riskLevel, lastRiskType: result.riskType },
      })
      .catch(() => {});
    // ⚠️ İNSAN-DEVRİ HOLD'U BURADA KURULMAZ (denetim, 08-01 — üçüncü tur).
    //
    // Hold aynı zamanda worker'ın `aiSendVeto` kapısıdır ("ai_paused"). Enqueue'dan
    // SONRA kurulunca worker AYNI geçişte kendi satırımızı veto edip `canceled`
    // yapıyordu → TASARLANMIŞ DEVİR MESAJI misafire HİÇ GİTMİYOR, üstelik konuşma
    // 12 saat sessize alınıyordu. Daha kötüsü: hold dolunca konuşma yeniden aday
    // olur, model YENİDEN çağrılır, `enqueueOutbound` dedupe'a düşer
    // (`already_queued`) ve o sebep ne damgalanır ne alarma girer → 2 dakikada bir
    // sonsuz model çağrısı + kota yakımı.
    //
    // Hold artık TESLİMAT ONAYLANINCA worker'da kurulur (`applyDeliveryEffect`),
    // yani satır içi yolun semantiğiyle BİREBİR: "önce mesaj gider, SONRA AI susar".
    // Teslimat başarısızsa hold hiç kurulmaz — bilinçli: misafir devir mesajını
    // almadıysa AI'yı susturmak yanlış olur.
    await recordRiskEvent({
      organizationId: conversation.property.organizationId,
      propertyId: conversation.propertyId,
      conversationId: conversation.id,
      surface: "auto_reply",
      triggerId: last.id,
      finalDecision: "auto_sent",
      riskLevel: result.riskLevel,
      riskType: result.riskType,
      reason: "gate_passed",
      confidence: result.confidence,
      ...grounding,
      srcDeclared: result.sourceAudit?.declared ?? null,
      srcVerified: result.sourceAudit?.verified ?? null,
    });
    void recordShadowVerdict({
      organizationId: conversation.property.organizationId,
      conversationId: conversation.id,
      triggerId: last.id,
      guestMessage: last.body,
      guestName: conversation.guestIdentifier,
      reservationGuestName: conversation.reservation?.guestName,
      gateDecision: "auto_sent",
      gateRiskLevel: result.riskLevel,
      gateRiskType: result.riskType,
    });
    return { sent: true, queued: true, draft, ...meta };
  }

  // ── Inline delivery path (flag OFF — production default) ────────────────────
  // Claim-then-send: atomically move the thread out of the "new" claimable set
  // BEFORE delivering, so two concurrent sync passes (multiple replicas, or a
  // lock-TTL overrun) can't both send a reply to the same guest. The loser sees
  // count 0 and backs off; on a delivery failure we release the claim so the
  // winner still retries next cycle. Mirrors the welcome/checkin/checkout senders.
  const claim = await prisma.conversation.updateMany({
    where: { id: conversation.id, status: { in: ["new", "waiting"] } },
    data: { status: "answered" },
  });
  if (claim.count === 0) {
    return { sent: false, skippedReason: "already_claimed", draft, ...meta };
  }

  const delivery = await sendOnChannel(
    {
      channel: conversation.channel,
      guestIdentifier: conversation.guestIdentifier,
      externalReservationId: conversation.externalReservationId,
    },
    outboundBody,
    token,
  );
  if (!delivery.ok) {
    // DEFINITIVE failure (HTTP 4xx≠408) → nothing delivered → release the claim
    // (status→new) so a later cycle re-models and retries. AMBIGUOUS (timeout/5xx/
    // network) → the reply MAY have reached the guest → KEEP the claim (leave status
    // "answered") so we never re-model + re-POST a possibly-delivered answer
    // (duplicate). The next sync re-imports it if it delivered; if the guest writes
    // again the thread reopens to "new" on its own. Mirrors the manual-reply route +
    // the lifecycle senders via the shared isDefinitiveSendFailure().
    if (isDefinitiveSendFailure(delivery.error)) {
      // ⚠️ CLAIM'İ GERİ ALMAK TEK BAŞINA SONSUZ DÖNGÜ ÜRETİYORDU (denetim, 08-01).
      // `runDueChannelAutoReplies` `send_failed`'i "geçici" sayıp damgalamıyor →
      // konuşma 2 dakika sonra yeniden UYGUN → model YENİDEN çağrılıyor (para) ve
      // günlük kotadan bir birim daha yanıyor → gönderim yine AYNI kalıcı hatayla
      // düşüyor. Tek bozuk konuşma org'un 150'lik günlük kotasını ~5 saatte
      // tüketip GERÇEK misafirlerin oto-yanıtını `daily_budget` ile kapatıyordu.
      // Nuve'nin canlı hesabı bugün tam bu durumda (Hospitable 402).
      //
      // Çözüm DAMGA DEĞİL GERİ ÇEKİLME: damga kalıcı olurdu (host bağlantısını
      // düzeltse bile misafir o mesaja hiç cevap alamazdı). `autoReplyHoldUntil`
      // mesajı KAYBETMEDEN sıklığı düşürür — süre dolunca kendiliğinden yeniden
      // denenir. Süre hatanın TÜRÜNE göre; sınıflandırma dayanıklı outbox'la aynı
      // kaynaktan (`classifySendResult`) gelir, iki yol ayrışamaz.
      const kind = classifySendResult({ ok: false, error: delivery.error });
      // Süre de sebep kodu da TEK KAYNAKTAN (`outbox/state.ts`) — iki gönderim
      // yolu ayrışamasın diye (denetim, 08-01 — üçüncü tur).
      const holdMs = sendFailureHoldMs(kind);
      await prisma.conversation
        .update({
          where: { id: conversation.id },
          data: {
            status: "new",
            autoReplyHoldUntil: new Date(Date.now() + holdMs),
            // Sebep bir KOD'dur — sağlayıcının ham hata metni ASLA DB'ye yazılmaz
            // (misafir/rezervasyon ayrıntısı taşıyabilir). Host ekranda okunur bir
            // açıklama görür (SKIP_REASON_LABELS).
            skippedReason:
              kind === "blocked"
                ? "subscription_inactive"
                : kind === "rate_limited"
                  ? "rate_limited"
                  : "send_failed",
          },
        })
        // ⚠️ SESSİZ `catch {}` DEĞİL (denetim, 08-01 — üçüncü tur). Bu yazma
        // düşerse konuşma KALICI olarak "answered" (claim'li) kalır: misafir
        // cevabı HİÇ almamıştır ama sistem cevaplanmış sayar → yeni mesaj gelene
        // kadar kimse fark etmez. Geri alma başarısızlığı kaydın kendisidir.
        .catch((err) => {
          void reportError(
            "auto-reply-claim-release",
            new Error(`conversation=${conversation.id} — gönderim hatası sonrası claim geri alınamadı`, {
              cause: err,
            }),
          );
        });
    }
    if (!isDefinitiveSendFailure(delivery.error)) {
      // ⚠️ BELİRSİZ (timeout/5xx) — claim TUTULUR (asla kör tekrar POST'lanmaz) ama
      // konuşmaya HİÇBİR ŞEY yazılmıyordu (denetim, 08-01 — beşinci tur, ajan
      // bulgusu): thread "Cevaplandı" görünüyor, İÇİNDE tek bir giden balon YOK ve
      // hiçbir açıklama da yok → host misafirin cevap aldığını sanıyordu.
      // `delivery_unverified` metni tam da bunu dürüstçe söylüyor ("iletilmiş
      // OLABİLİR, elle yanıtlamadan önce kanalı kontrol edin") ama üretimde
      // ULAŞILAMAZ bir etiketti (yalnız kuyruk yolundan yazılıyordu).
      await prisma.conversation
        .updateMany({ where: { id: conversation.id }, data: { skippedReason: "delivery_unverified" } })
        .catch((err) => void reportError("auto-reply-unverified-reason", err));
    }
    return { sent: false, skippedReason: `send_failed: ${delivery.error ?? "unknown"}`, draft, ...meta };
  }

  const now = new Date();
  const conversationDone = prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: "answered",
      lastMessageAt: now,
      skippedReason: null,
      lastRiskLevel: result.riskLevel,
      lastRiskType: result.riskType,
    },
  });
  try {
    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          authorType: "ai",
          senderName: "GuestOps AI",
          body: outboundBody,
          aiIntent: result.intent,
          aiConfidence: result.confidence,
          aiSourcesJson: result.usedSources.length ? JSON.stringify(result.usedSources) : null,
          // Store the provider's message id so the next sync dedups this AI reply
          // instead of re-importing it as a duplicate "Ev sahibi" message.
          ...(delivery.providerMessageId ? { externalId: delivery.providerMessageId } : {}),
        },
      }),
      conversationDone,
    ]);
  } catch (err) {
    // Delivery already SUCCEEDED. If the row raced in via a concurrent sync
    // import (@@unique([conversationId, externalId]) dedupe-hit ONLY), the
    // message exists — still mark the conversation answered, or the expiring
    // outbound claim would let a later pass RE-SEND to the guest.
    if (!isUniqueViolation(err, ["conversationId", "externalId"])) throw err;
    await conversationDone;
  }

  // Guest asked to speak to a human: we just sent the holding reply, now pause the
  // AI on this thread so the host can take over without the bot chiming in again.
  if (result.intent === "human_request") {
    const holdHours = org.handoffHoldHours ?? (Number(process.env.HUMAN_HANDOFF_HOLD_HOURS) || 12);
    await prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { autoReplyHoldUntil: new Date(now.getTime() + holdHours * 60 * 60 * 1000) },
      })
      .catch(() => {});
  }

  await recordRiskEvent({
    organizationId: conversation.property.organizationId,
    propertyId: conversation.propertyId,
    conversationId: conversation.id,
    surface: "auto_reply",
    triggerId: last.id,
    finalDecision: "auto_sent",
    riskLevel: result.riskLevel,
    riskType: result.riskType,
    reason: "gate_passed",
    confidence: result.confidence,
    ...grounding,
    srcDeclared: result.sourceAudit?.declared ?? null,
    srcVerified: result.sourceAudit?.verified ?? null,
  });
  void recordShadowVerdict({
    organizationId: conversation.property.organizationId,
    conversationId: conversation.id,
    triggerId: last.id,
    guestMessage: last.body,
    guestName: conversation.guestIdentifier,
    reservationGuestName: conversation.reservation?.guestName,
    gateDecision: "auto_sent",
    gateRiskLevel: result.riskLevel,
    gateRiskType: result.riskType,
  });
  return { sent: true, draft, ...meta };
}

/**
 * YAŞAM-DÖNGÜSÜ GÖNDERİM ARIZALARI ARTIK SESSİZ DEĞİL (denetim, 08-01).
 *
 * Üç göndericinin (karşılama / giriş bilgisi / çıkış hatırlatması) hata dalı
 * `delivery.error`'ı yalnızca `isDefinitiveSendFailure`'a veriyor ve başka hiçbir
 * yere yazmıyordu: ne alarm, ne log, ne sayaç. Dönen `{sent, considered}`
 * farkını da kimse okumuyordu. Yani giriş talimatı (kapı kodunu TAŞIYAN mesaj)
 * misafire hiç gitmese bile hiçbir yerde iz kalmıyordu — sorun ancak misafir
 * kapıda kalınca anlaşılırdı. Bu, 07-31'de oto-yanıt için kapatılan desenin son
 * kopyasıydı.
 *
 * Koşu başına TEK toplu alarm (sağlayıcı komple düşerse her rezervasyon için
 * ayrı alarm sel olurdu). YALNIZ hata SINIFI ve SAYI gider — rezervasyon id'si,
 * misafir adı, mesaj gövdesi ya da sağlayıcının ham hata metni ASLA.
 */
async function reportLifecycleSendFailures(
  kind: "welcome" | "checkin" | "checkout",
  organizationId: string,
  failures: string[],
  considered: number,
): Promise<void> {
  if (failures.length === 0) return;
  // ⚠️ ALARM KENDİ PENCERESİNE BAĞLI OLMAK ZORUNDA (denetim, 08-01 — ikinci tur).
  //
  // Yaşam-döngüsü göndericileri KESİN hatada (4xx≠408) damgayı geri alıp HER
  // geçişte yeniden deniyor — ve Hospitable 402 "abonelik pasif" de kesin hata
  // sayılıyor (Nuve'nin BUGÜNKÜ hâli). Yani geri çekilmesi OLMAYAN bir sonsuz
  // döngü var. Alarmı ona çıplak bağlamak, `reportError`'un 10 dakikalık
  // context throttle'ıyla bile GÜNDE ~432 uyarı e-postası demekti (2 dk'lık cron
  // × 3 tür ÷ 10 dk) — ve karşılama için `arrivalDate` geçene kadar, yani AYLARCA.
  // Bir arızayı görünür kılmak için kurulan mekanizma, gerçek arızayı gömerdi.
  //
  // Pencere `SystemLock` ile (org, tür) başına 6 saat (Paddle uyarısının emsali):
  // satır yoksa yarat, varsa YALNIZ süresi dolmuşsa yenile — ikisi de atomik.
  // ⚠️ Sonsuz tekrarın KENDİSİ hâlâ açık ve KOLON İSTİYOR (oto-yanıttaki
  // `autoReplyHoldUntil`in `Reservation` karşılığı yok) → `docs/MIGRATION-
  // BEKLEYEN-ISLER.md §4`. Bu değişiklik yalnız SESİ kısar, arızayı çözmez.
  // ⚠️ CLAIM-THEN-NOTIFY: pencereyi claim edip SONUCU OKUMADAN bildirim yapmak
  // bu repoda belgeli bir arıza sınıfıdır (CLAUDE.md). Claim edilen pencerenin
  // adını tutuyoruz ki bildirim BAŞARISIZ olursa geri alabilelim — yoksa tek bir
  // Resend 5xx'i pencereyi tüketir ve host 6 saat boyunca hiçbir şey duymaz.
  let claimedWindow: string | null = null;
  const key = `lifecycle-alarm:${kind}:${organizationId}`;
  const now = new Date();
  const nextAllowed = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  try {
    const created = await prisma.systemLock.createMany({
      data: [{ name: key, lockedUntil: nextAllowed }],
      skipDuplicates: true,
    });
    const renewed =
      created.count === 1
        ? { count: 0 }
        : await prisma.systemLock.updateMany({
            where: { name: key, lockedUntil: { lte: now } },
            data: { lockedUntil: nextAllowed },
          });
    if (created.count + renewed.count === 0) return; // pencere dolu → sessiz kal
    claimedWindow = key;
  } catch {
    // Pencere yazılamadıysa alarmı YİNE AT: görünürlük, gürültüden önemli.
    // (DB yazamıyorsak senkron zaten patlıyordur — pratikte dar bir yol.)
  }
  const counts = failures.reduce<Record<string, number>>((acc, k) => {
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  // ⚠️ SONUCU GERÇEKTEN OKU (denetim, 08-01 — üçüncü tur). İlk yazımda burada bir
  // `try/catch` vardı ve catch'te pencere geri alınıyordu — ama `reportError`
  // ASLA FIRLATMAZ, yani o dal ÖLÜ KODdu ve yorum var olmayan bir korumayı
  // anlatıyordu. Bir denetim ajanı yakaladı. Artık `reportError` sonuç döndürüyor.
  //
  // `throttled` ve `configured:false` BAŞARISIZLIK DEĞİLDİR: ilki "bu context
  // zaten uyarıldı", ikincisi "alarm e-postası hiç kurulmamış". Yalnız GERÇEKTEN
  // gönderilemediğinde pencere geri alınır ki bir sonraki geçiş yeniden denesin.
  const outcome = await reportError(
    `lifecycle-send ${kind} org=${organizationId}`,
    new Error(
      `${kind} delivery failed for ${failures.length}/${considered} reservation(s): ` +
        Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
    ),
  );
  // Opsiyonel zincir bilinçli: bu bir ALARM yolu ve ASLA çağıranı bozmamalı.
  // (Bir sarmalayıcı/mock `void` döndürürse `undefined` gelir → geri alma
  // yapılmaz = GÜVENLİ yön: pencere korunur, yaşam-döngüsü göndericisi çökmez.)
  if (claimedWindow && outcome?.configured && !outcome.notified && !outcome.throttled) {
    // 🚨 EPOCH 0 DEĞİL, KISA GERİ ÇEKİLME (denetim, 08-01 — üçüncü tur; ilk hâli
    // bir SEL üretiyordu). `new Date(0)` pencereyi HEMEN serbest bırakıyordu ve
    // `reportError`'ün başarısızlık damgası da ~1 dk geriye çekildiği için
    // 2 dakikalık cron'da kova HİÇ tutmuyordu: 2 dk + 9 dk = 11 dk > 10 dk
    // throttle → HER GEÇİŞ yeni bir e-posta denemesi. Üç yaşam-döngüsü türü ×
    // 30 geçiş/saat = 90 deneme/saat, her biri 12-15 sn timeout ile senkron
    // içinde bloklayabilir. Oysa bu pencerenin VARLIK SEBEBİ tam da o seli
    // önlemekti (yorumdaki hesap: damgasız hâlde ~432/gün).
    // 15 dakika: bildirim gerçekten kaybolduysa makul sürede tekrar denenir
    // (claim-then-notify korunur), ama tekrar ≤4/saat ile sınırlı kalır.
    // ⚠️ GERİ ALMANIN KENDİSİ DE SESSİZ OLMAMALI (denetim, 08-01 — dördüncü tur):
    // bu yazma düşerse pencere 6 saat yanar ve bildirim o süre boyunca hiç
    // denenmez — düzeltmeye çalıştığımız desenin bir seviye yukarıdaki kopyası.
    const reopened = await prisma.systemLock
      .updateMany({
        where: { name: claimedWindow },
        data: { lockedUntil: new Date(Date.now() + ALARM_RETRY_BACKOFF_MS) },
      })
      .catch(() => null);
    if (reopened === null || reopened.count === 0) {
      console.warn(
        `[lifecycle-alarm] ${kind}/${organizationId}: bildirim gitmedi VE pencere geri alınamadı — bu arıza 6 saat sessiz kalacak`,
      );
    }
  }
}

/**
 * ADAY KÜMESİ — TEK KAYNAK. Hem asıl geçiş (findMany) hem "aktif saat dışında"
 * görünürlük yazımı (updateMany) bunu kullanır; iki yerde ayrı ayrı yazılsaydı
 * host'a "bu konuşma saat aralığı yüzünden bekliyor" denip aslında başka bir
 * sebeple beklemesi (ya da tersi) mümkün olurdu.
 */
function dueAutoReplyWhere(organizationId: string, freshSince: Date) {
  return {
    property: { organizationId },
    // V0.5: sağlayıcı thread'i (iç QR thread'i hariç — dönüş kanalı yok, sohbetin kendi
    // kapısı triyajladı). Kural tek yerde: channels/capability.ts (INTERNAL_THREAD_PREFIX).
    ...PROVIDER_THREAD_CONVERSATION_WHERE,
    status: "new",
    lastMessageAt: { gte: freshSince },
    // ⚠️ UYGUNLUK FİLTRESİ SQL'DE OLMAK ZORUNDA — TAVANLA BİRLİKTE (denetim
    // 08-01). Bu koşul bir süre YALNIZCA JS'te uygulandı ve araya `take: 25`
    // kondu; sıra da `lastMessageAt asc` (en eski önce). Sonuç KALICI AÇLIKTI:
    // damgalanmış konuşmalar (`closing_ack` / `low_confidence_or_risky` /
    // `globally_disabled`) `status:"new"` kalır ve EN ESKİ oldukları için
    // sıranın başındadır → 25 slotu doldurup `eligible`'ı boşaltırlar ve YENİ
    // misafir mesajları hiç seçilmez. `freshSince` sabit bir damga olduğu için
    // (kayan pencere DEĞİL) bu küme yalnız BÜYÜR; org'un tüm oto-yanıtı
    // sessizce ölürdü. Tavan artık UYGUN satırlara uygulanıyor.
    AND: [
      {
        OR: [
          { autoReplyAttemptedAt: null },
          { autoReplyAttemptedAt: { lt: prisma.conversation.fields.lastMessageAt } },
        ],
      },
      {
        // İnsan devri süresince AI susuyor (`autoReplyHoldUntil`). Bu satırlar
        // DAMGALANAMAZ — damga, devir bitince konuşmayı KALICI susturur — o
        // yüzden adaylıktan burada düşerler ve süre dolunca kendiliğinden geri
        // gelirler. Aksi hâlde her turda 25 slottan birini işgal ederlerdi.
        OR: [{ autoReplyHoldUntil: null }, { autoReplyHoldUntil: { lte: new Date() } }],
      },
    ],
  };
}

/**
 * Run the channel auto-reply pass for an organization: if enabled AND we are
 * inside the active-hours window, auto-answer every channel conversation whose
 * last message is an unanswered guest message. Called after each sync.
 */
export async function runDueChannelAutoReplies(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      autoReplyHospitable: true,
      autoReplyEnabledAt: true,
      timezone: true,
      autoReplyStartHour: true,
      autoReplyEndHour: true,
    },
  });
  // Global master kill-switch (see applyChannelAutoReply): nothing is ever sent
  // unless AUTO_REPLY_ENABLED=1 is set on the deployment. Short-circuit here so
  // the cron pass does no AI work at all while auto-reply is globally disabled.
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  if (!org || !org.autoReplyHospitable) return { sent: 0, considered: 0 };

  // "new" = the guest spoke last and we haven't answered (see hospitable-sync).
  // Only answer messages that arrived AFTER auto-reply was switched on — never
  // the pre-existing backlog. Falls back to a 48h window if the timestamp is
  // missing (legacy orgs).
  const freshSince = org.autoReplyEnabledAt ?? new Date(Date.now() - 48 * 60 * 60 * 1000);

  const hour = currentHourInTimeZone(org.timezone);
  if (!isWithinActiveHours(org.autoReplyStartHour, org.autoReplyEndHour, hour)) {
    // ⚠️ SEBEP BURADA YAZILMAZSA HİÇBİR YERDE YAZILMIYOR (denetim, 08-01).
    // `applyChannelAutoReply` içinde birebir aynı kontrol var ve orası
    // `outside_hours` sebebini persist ediyor — ama BU erken dönüş hiçbir
    // konuşmaya dokunmadan geri döndüğü için oraya ASLA ulaşılmıyordu. Yani
    // 07-31'de eklenen görünürlük düzeltmesi üretimde ölü koddu ve ürünün 1
    // numaralı destek sorusu ("AI neden sustu?") ekranda cevapsız kalıyordu.
    // Şema varsayılanı hâlâ 00:00–09:00 olduğu için bu, mevcut TÜM org'ları
    // (Nuve dahil) gündüz boyunca ilgilendiriyor.
    //
    // Model çağrısı YOK — tek `updateMany`. `skippedReason: null` koşulu iki işi
    // birden yapıyor: (1) gerçek bir sebebi (escalated_to_human / şikayet /
    // low_confidence) EZMİYOR, (2) her konuşmaya ömründe TEK yazma düşüyor —
    // aksi hâlde gece boyunca 2 dakikada bir aynı satırlar yeniden yazılırdı
    // (`persistRiskVisibility`'nin "yalnız değişince yaz" kuralıyla aynı mantık).
    await prisma.conversation
      .updateMany({
        where: { ...dueAutoReplyWhere(organizationId, freshSince), skippedReason: null },
        data: { skippedReason: "outside_hours" },
      })
      .catch(() => {});
    return { sent: 0, considered: 0 };
  }

  const candidates = await prisma.conversation.findMany({
    where: dueAutoReplyWhere(organizationId, freshSince),
    select: { id: true, lastMessageAt: true, autoReplyAttemptedAt: true },
    // ADİL VE DETERMİNİSTİK SIRA: en eski cevapsız mesaj önce.
    orderBy: { lastMessageAt: "asc" },
    // Kardeş geçişlerin hepsinde tavan var; burada yoktu. İşletme planında en
    // kötü hâl 1.500 ardışık model çağrısıydı (her biri 60 sn timeout'lu) ve
    // senkron kilidinin TTL'i 15 dakika — aşılırsa "aynı org iki kez koşmaz"
    // varsayımına dayanan TÜM duplicate koruması delinir. Kesilen adaylar claim
    // edilmediği için kayıp değil, bir sonraki turda alınır.
    take: 25,
  });

  // İKİNCİ SAVUNMA (SQL'dekinin aynısı). Prisma alan-referansı sessizce
  // çalışmazsa tavan yine yanlış satırlara uygulanır; bu filtre en azından
  // GEREKSİZ MODEL ÇAĞRISINI önler. Açlığı önleyen şey yukarıdaki SQL koşuludur,
  // bu değil — o yüzden ikisi birden duruyor ve SQL koşulu testle pinli.
  const eligible = candidates.filter(
    (c) => !c.autoReplyAttemptedAt || c.autoReplyAttemptedAt < c.lastMessageAt,
  );

  let sent = 0;
  // GÖNDERİM ARIZASI ARTIK SESSİZ DEĞİL (denetim, 07-31). `applyChannelAutoReply`
  // hatayı bir STRING olarak döndürüyor (`send_failed: …` / `enqueue_failed: …`)
  // ve bu döngü onu okuyan TEK yerdi — ama yalnız `sent` sayılıyor, arızalar
  // tamamen atılıyordu: ne log, ne Sentry, ne sayaç. Yani bir misafire cevap
  // gidememesinin hiçbir izi kalmıyordu; ancak misafir şikayet edince fark
  // edilirdi. Koşu başına TEK toplu alarm: sağlayıcı komple düşerse her
  // konuşma için ayrı alarm = sel olurdu.
  const failures: string[] = [];
  for (const c of eligible) {
    const outcome = await applyChannelAutoReply(c.id);
    // Günlük kota dolduysa bu org için geçişi BİTİR: kalan konuşmaların her biri
    // sayacı bir kez daha artırmaktan başka bir şey yapmaz (tavan zaten aşıldı).
    // Damgalamıyoruz → pencere dönünce hepsi normal şekilde yanıtlanır.
    if (outcome.skippedReason === "daily_budget") {
      // Sebep KALAN adaylara da yazılır. Eskiden yalnız ilk reddedilen konuşma
      // etiketleniyor, `break` hemen ardından geliyordu → geri kalan N konuşma
      // hiçbir açıklama olmadan sessizce bekliyordu ("sebep host'a görünür"
      // gerekçesi N-1 konuşma için geçerli değildi). Tek `updateMany`, model
      // çağrısı yok. `autoReplyAttemptedAt` yine DAMGALANMAZ → pencere dönünce
      // hepsi normal şekilde yanıtlanır.
      const rest = eligible.slice(eligible.indexOf(c) + 1).map((x) => x.id);
      if (rest.length > 0) {
        await prisma.conversation
          .updateMany({
            // ⚠️ GERÇEK SEBEBİ EZME (denetim, 08-01). `rest` içinde model
            // çağrısına HİÇ gelmeyecek konuşmalar da var: `human_hold` (misafir
            // insan istedi, AI susuyor) ve `reservation_ended` (konaklama bitti).
            // Onları `daily_budget` ile işaretlemek host'a "sınır yenilenince
            // otomatik yanıtlanacak" diye YALAN söylüyordu — o konuşmalar sınır
            // yenilense de asla yanıtlanmayacak. Yalnız sebebi OLMAYAN ya da
            // zaten `daily_budget` olan satırlar güncellenir.
            where: {
              id: { in: rest },
              OR: [{ skippedReason: null }, { skippedReason: "daily_budget" }],
            },
            data: { skippedReason: "daily_budget" },
          })
          .catch(() => {});
      }
      break;
    }
    if (outcome.sent) {
      sent++;
    } else if (
      outcome.skippedReason === "low_confidence_or_risky" ||
      outcome.skippedReason === "globally_disabled" ||
      outcome.skippedReason === "closing_ack" ||
      // Konaklama bitti/iptal: bu mesaj için KALICI bir hayır. Damgalanmazsa
      // konuşma `status:"new"` kalır, `lastMessageAt`'i en eski olduğu için
      // sıranın başına oturur ve her turda aday slotu yer (denetim, 08-01).
      // Misafir YENİ bir mesaj yazarsa `lastMessageAt` damgayı geçer ve konuşma
      // kendiliğinden yeniden uygun olur — yani kayıp değil.
      outcome.skippedReason === "reservation_ended" ||
      // ⚠️ KUYRUK YOLU SONSUZ MODELLEME (denetim, 08-01 — üçüncü tur, ajan bulgusu).
      // `already_queued` = bu TAM inbound mesaj için dayanıklı bir gönderim-niyeti
      // ZATEN var. Damgalanmadığı için konuşma her 2 dakikada bir yeniden
      // modelleniyordu: `enqueueOutbound` dedupe'u `(org, idempotencyKey)` üzerinden
      // çalışır ve satırın DURUMUNA bakmaz → satır bir kez `failed`/`canceled`
      // olduğunda anahtar SONSUZA KADAR tutulur, yani her tur bir model çağrısı +
      // bir kota birimi boşa yanardı (kalıcı 4xx döngüsünün kuyruk yolundaki eşi).
      // Bu mesaj için KALICI bir hayır: misafir YENİ mesaj yazarsa `lastMessageAt`
      // damgayı geçer, anahtar da değişir → konuşma kendiliğinden yeniden uygun olur.
      outcome.skippedReason === "already_queued"
    ) {
      // Deterministic non-send for this message → don't re-model it next tick.
      // Transient reasons (send_failed / not_connected / already_claimed) are NOT
      // stamped, so they still retry when conditions change.
      // ⚠️ DAMGA SUNUCU SAATİ DEĞİL, KARARIN VERİLDİĞİ MESAJIN DAMGASI (denetim,
      // 08-01 — dördüncü tur). `new Date()` sunucu ekseninde; `lastMessageAt` ise
      // sağlayıcının `reservation.last_message_at`'inden geliyor. İkisini
      // karşılaştırmak, geçiş sırasında (model çağrısı başına 60 sn × 25 konuşma)
      // gelen bir misafir mesajını damgadan ESKİ gösterip konuşmayı KALICI
      // aday-dışı bırakabiliyordu — `syncCursorAt` dersinin aynısı. `c.lastMessageAt`
      // yazmak eşitlik üretir; aday koşulu `lt` olduğu için bu satır düşer, ama
      // misafir YENİ yazınca `lastMessageAt` ilerler ve konuşma geri gelir.
      await prisma.conversation
        .updateMany({ where: { id: c.id }, data: { autoReplyAttemptedAt: c.lastMessageAt } })
        .catch(() => {});
    } else if (
      outcome.skippedReason?.startsWith("send_failed") ||
      outcome.skippedReason?.startsWith("enqueue_failed")
    ) {
      // Yalnız SEBEBİN ETİKETİ toplanır — konuşma id'si, misafir adı ya da mesaj
      // gövdesi ASLA. Sebep string'i zaten `redactSensitive`'den geçmiş durumda.
      failures.push(outcome.skippedReason.split(":")[0]);
    }
  }
  if (failures.length > 0) {
    const counts = failures.reduce<Record<string, number>>((acc, k) => {
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    void reportError(
      `runDueChannelAutoReplies org=${organizationId}`,
      new Error(
        `auto-reply delivery failed for ${failures.length}/${eligible.length} conversation(s): ` +
          Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(", "),
      ),
    );
  }
  return { sent, considered: eligible.length };
}

/** Org başına "en son ne zaman DENEDİK" (başarısız denemeler dahil, ↓gerekçe). */
const styleProfileAttemptAt = new Map<string, number>();
const STYLE_PROFILE_ATTEMPT_MS = 6 * 60 * 60 * 1000; // 6 saat

/**
 * Refresh the org's "style profile" — a short guide distilled from the host's
 * OWN past replies — so future AI drafts mirror their voice. Throttled to once
 * per ~24h and only run when there are enough real host messages. Best-effort:
 * on any failure the existing profile (or none) is kept and replies fall back to
 * default behaviour. Never throws.
 */
export async function refreshStyleProfile(
  organizationId: string,
): Promise<{ refreshed: boolean }> {
  if (!process.env.OPENAI_API_KEY) return { refreshed: false };
  // Premium gate: a lapsed/free org must not keep incurring OpenAI cost for the
  // background style-distillation (this ran before the premium check in the sync).
  if (!(await premiumAllowed(organizationId))) return { refreshed: false };

  // ⚠️ DENETİM BULGUSU (07-31): aşağıdaki 24 saatlik throttle YALNIZCA profil bir
  // kez üretilmişse tutar — `aiStyleProfileAt` NULL kalan org'da (ör. henüz 5 host
  // yanıtı yazmamış YENİ müşteri ve her terk edilmiş deneme hesabı) hiç devreye
  // girmiyordu. Sonuç: aşağıdaki `message.findMany(take:40)` her 2 dakikada bir,
  // SONSUZA KADAR koşuyordu. Bu in-process kontrol o boşluğu kapatır: deploy'da
  // sıfırlanır ve replikalar arası paylaşılmaz, ama bir throttle için ikisi de
  // önemsiz — asıl kazanç aynı org'u dakikalarca tekrar sorgulamamak.
  const lastAttempt = styleProfileAttemptAt.get(organizationId);
  if (lastAttempt && Date.now() - lastAttempt < STYLE_PROFILE_ATTEMPT_MS) return { refreshed: false };
  styleProfileAttemptAt.set(organizationId, Date.now());

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiStyleProfileAt: true },
  });
  if (!org) return { refreshed: false };

  // Throttle: skip if refreshed within the last 24 hours.
  if (org.aiStyleProfileAt && Date.now() - org.aiStyleProfileAt.getTime() < 24 * 60 * 60 * 1000) {
    return { refreshed: false };
  }

  // Learn ONLY from the host's real, human replies — never the AI's own.
  // 🚨 FİLTRE TEK ADI TANIYORDU (denetim, 08-09). `senderName: { not: "GuestOps
  // AI" }` yalnız ESKİ sihirli string'i eliyordu; QR concierge kendi AI
  // yanıtlarını `senderName: "Lixus AI", authorType: "ai"` diye yazıyor →
  // BOT'un çıktısı "host'un sesi" diye örnekleniyordu. Sonuç iki katmanlı:
  // (a) model kendi çıktısıyla besleniyor (geri besleme döngüsü), (b) profil
  // prompt'a bir CEVAP KAYNAĞI olarak giriyor ("bu rehberdeki sık sorulan
  // sorular kısmı açıkça karşılıyorsa o cevabı temel al") — yani bir misafirin
  // bota söylettiği politika cümlesi, org genelinde BAŞKA misafirlere otomatik
  // gönderilen yanıtlara sızabiliyordu.
  // Doğru filtre bir dosya ötede ZATEN vardı: `quality-audit.ts:114-119`.
  // `authorType` birincil, `senderName` yalnız damgasız ESKİ satırlar için.
  const hostReplies = await prisma.message.findMany({
    where: {
      direction: "outbound",
      // POZİTİF seçim (kara liste değil): "host" damgalı satırlar, artı damga
      // taşımayan ESKİ satırlardan AI/sistem adı olmayanlar. Kara liste yazsaydım
      // `authorType:"system"` (QR "AI devam ediyor" işaretçisi) elenmezdi — o da
      // host'un yazdığı nesir DEĞİL.
      OR: [
        { authorType: "host" },
        {
          authorType: null,
          senderName: { notIn: [...LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER] },
        },
      ],
      conversation: { property: { organizationId } },
    },
    select: { body: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  // KVKK: redact PII (e-mail/phone/long codes/keys) from the host's own reply
  // bodies BEFORE they reach OpenAI. Style (tone, structure) is preserved; a
  // door code or address a host happened to type doesn't cross the border raw.
  const samples = hostReplies
    .map((m) => redactSensitive(m.body))
    .filter((b) => b && b.trim().length > 0);
  if (samples.length < 5) return { refreshed: false };

  const profile = await summarizeHostStyle(samples);
  if (!profile) return { refreshed: false };

  await prisma.organization.update({
    where: { id: organizationId },
    data: { aiStyleProfile: profile, aiStyleProfileAt: new Date() },
  });
  return { refreshed: true };
}

/** First name for the greeting, or null for placeholder names (no real name). */
function guestFirstName(name: string): string | null {
  const first = name.trim().split(/\s+/)[0];
  if (!first || first === "Rezervasyon" || first === "Misafir") return null;
  return first;
}

// (dateKeyInTimeZone / tzOffsetMs / zonedDayRange → @/lib/timezone'a taşındı)

// Placeholder the host can drop into a welcome template — {isim} / {ad} / {name}
// — replaced with the guest's first name when the message is sent.
function hasNamePlaceholder(s: string): boolean {
  return /\{\s*(isim|ad|name)\s*\}/i.test(s); // fresh, non-global → no lastIndex footgun
}

// The guest-facing apartment number: the last number in the property name
// ("nuve 3" → "3", "nuve teras 4" → "4", "Daire 1" → "1"). Falls back to the
// full name when it contains no number.
function apartmentNumber(propertyName: string): string {
  const nums = propertyName.match(/\d+/g);
  return nums ? nums[nums.length - 1] : propertyName;
}

// Resolve the host's template tokens to live values:
//   {isim} / {ad} / {name}         → guest's first name
//   {daire} / {apartment} / {apt}  → the apartment number (from the property name)
function fillPlaceholders(text: string, firstName: string, propertyName?: string): string {
  // Function replacers so a guest name / apartment value containing $ patterns
  // ($&, $1, $`, $$, …) is inserted LITERALLY — a plain string replacement would
  // let those special patterns corrupt the guest's own personalized message.
  let out = text.replace(/\{\s*(isim|ad|name)\s*\}/gi, () => firstName);
  if (propertyName) {
    const apt = apartmentNumber(propertyName);
    out = out.replace(/\{\s*(daire|apartment|apt)\s*\}/gi, () => apt);
  }
  return out;
}

/**
 * Build the welcome message body. If the host's template contains a {isim}
 * placeholder, substitute the tokens and send it verbatim (their own greeting +
 * sign-off). Otherwise prepend a greeting and append the org signature.
 */
function buildGuestMessageBody(
  content: string,
  firstName: string,
  signature?: string,
  propertyName?: string,
): string {
  const trimmed = content.trim();
  const filled = fillPlaceholders(trimmed, firstName, propertyName);
  if (hasNamePlaceholder(trimmed)) {
    return filled; // host's own greeting + sign-off, tokens resolved
  }
  return [`Merhaba ${firstName},`, "", filled, ...(signature ? ["", signature] : [])].join("\n");
}

/**
 * Fence the flag-OFF lifecycle sender against the durable outbox (post-rollback coherence,
 * final-review). If a row for this (org, reservation, messageType) already exists in the outbox
 * in ANY state EXCEPT terminal `failed`, the outbox owns/owned this send: the direct path must
 * NOT POST a second time — a `pending` row is drained by the worker even with the flag off, a
 * `blocked` row (Hospitable subscription not active) is reactivated + drained once the sync
 * succeeds again, and a `review`/`ambiguous`/`sent`/`canceled` row must never be blind-resent.
 * Only a `failed` row (definitively not delivered) lets the direct path retry. No-op when the
 * outbox was never used (pure flag-OFF) → the query finds nothing, so the classic claim-then-send
 * below runs unchanged.
 */
async function lifecycleOutboxOwns(
  organizationId: string,
  externalReservationId: string,
  messageType: string,
): Promise<boolean> {
  const row = await prisma.messageOutbox.findFirst({
    where: { organizationId, externalReservationId, messageType, status: { not: "failed" } },
    select: { id: true },
  });
  return row != null;
}

/**
 * Send the per-apartment welcome message for upcoming reservations that haven't
 * received one yet. The body is built from the apartment's "welcome" knowledge
 * base entry, personalised with the guest's first name and closed with the org
 * signature. Sent at most ONCE per reservation (welcomeSentAt), only for stays
 * arriving in the near future (never blasts past guests), and only when BOTH the
 * global kill-switch (AUTO_REPLY_ENABLED=1) and the org's autoWelcome toggle are
 * on. Apartments without a welcome entry are skipped.
 */
export async function sendDueWelcomes(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoWelcome: true, autoWelcomeEnabledAt: true, aiSignature: true, timezone: true },
  });
  if (!org || !org.autoWelcome) return { sent: 0, considered: 0 };

  // Multi-tenant: deliver via THIS org's own Hospitable token (skip if unconnected).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return { sent: 0, considered: 0 };

  // The welcome is a "thanks for booking" greeting (no codes/Wi-Fi), so it goes
  // right after the booking is made — the sync picks it up within ~2 minutes,
  // regardless of how far ahead the stay is. Only bookings first seen AFTER
  // welcome was switched on (autoWelcomeEnabledAt) qualify, so enabling never
  // touches the pre-existing backlog. No baseline yet → nothing is sent.
  const now = new Date();
  const baseline = org.autoWelcomeEnabledAt;
  if (!baseline) return { sent: 0, considered: 0 };

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      welcomeSentAt: null,
      // V0.5: mesajlanabilirlik TEK KAYNAK (channels/capability.ts) — sourceReference
      // dolu + calendarSourceId null + channel notIn [ics, manual]. Gerekçe (08-08
      // denetimi: `channel` iCal işaretçisi DEĞİL, gerçek işaretçi calendarSourceId)
      // fragment'in başlığında; önizleme aynı fragment'i yayar → parite yapısal.
      ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE,
      createdAt: { gte: baseline }, // only bookings created since welcome was enabled
      // Org-local day boundary (not server UTC) so today's arrival isn't dropped.
      arrivalDate: { gte: zonedDayRange(now, orgTimezone(org.timezone)).start },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      arrivalDate: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { arrivalDate: "asc" },
    take: 25, // cap per run so enabling the toggle can't cause a huge burst
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;
  // Hata SINIFI etiketleri (PII yok) — koşu sonunda tek toplu alarma gider.
  const failures: string[] = [];

  for (const r of reservations) {
    const welcome = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "welcome", ...GUEST_DELIVERABLE_KB_WHERE },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!welcome) continue; // this apartment has no welcome text → skip

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(welcome.content, firstName, signature, r.property.name);

    // ── Durable Outbox (flag ON) ──────────────────────────────────────────────
    // Enqueue the welcome and let the worker deliver it. welcomeSentAt is stamped ONLY on
    // confirmed delivery (by the worker), never here — so a queued-but-undelivered welcome
    // is re-considered next run and the deterministic key (org + booking) makes that a clean
    // dedupe-hit, so a scheduler replay / process restart never sends a second welcome. Flag
    // OFF → the proven claim-then-send below runs BYTE-FOR-BYTE as before.
    if (durableOutboxEnabled() && r.sourceReference) {
      try {
        const enq = await enqueueProactive({
          organizationId,
          reservationId: r.id,
          externalReservationId: r.sourceReference,
          channel: r.channel,
          messageType: "welcome",
          body,
          idempotencyKey: `welcome:${organizationId}:${r.sourceReference}`,
        });
        if (!enq.deduped) sent++;
      } catch {
        // enqueue failure → *SentAt stays null → a later run retries cleanly (no stamp),
        // AMA sessiz kalmaz: kalıcı bir enqueue arızasında yaşam-döngüsü mesajları
        // HİÇ gitmez ve hiçbir yerde iz kalmazdı (denetim, 08-01 — üçüncü tur).
        // Doğrudan dal `failures` topluyordu, bu dal toplamıyordu → koşu başına tek
        // toplu alarm bu yolda ASLA tetiklenmiyordu. Bayrak AÇILMADAN önce kapatıldı.
        failures.push("enqueue_failed");
      }
      continue;
    }

    // Fence against a durable-outbox row for this booking (post-rollback): the outbox owns it
    // unless it terminally FAILED — don't POST a second time (final-review).
    if (r.sourceReference && (await lifecycleOutboxOwns(organizationId, r.sourceReference, "welcome"))) continue;

    // Claim-then-send: atomically stamp welcomeSentAt BEFORE sending so two
    // overlapping sync runs can't both deliver. Lose the claim → skip; send fails →
    // roll the claim back so it retries next run. Stamps every row for this booking.
    // ⚠️ DAMGA DEĞİŞKENE ALINIR — geri alma bunu KOŞUL olarak kullanacak (↓).
    const stampedAt = new Date();
    const claim = await prisma.reservation.updateMany({
      where: { sourceReference: r.sourceReference, property: { organizationId }, welcomeSentAt: null },
      data: { welcomeSentAt: stampedAt },
    });
    if (claim.count === 0) continue; // another run already claimed/sent this booking

    const delivery = await sendOnChannel(
      {
        channel: r.channel,
        guestIdentifier: r.guestName,
        externalReservationId: r.sourceReference,
      },
      body,
      token,
    );
    if (!delivery.ok) {
      // DEFINITIVE failure (HTTP 4xx≠408) → nothing delivered → un-claim so a later
      // run retries. AMBIGUOUS (timeout/5xx/network) → the welcome MAY have reached
      // the guest → KEEP welcomeSentAt so we never re-POST a possibly-delivered
      // proactive message (a duplicate is worse than a rare silent miss). Mirrors the
      // manual-reply route via the shared isDefinitiveSendFailure(). Durable Outbox
      // (flag ON) handles this via reconcile/review; this is the flag-OFF direct path.
      const definitive = isDefinitiveSendFailure(delivery.error);
      failures.push(definitive ? "definitive" : "ambiguous");
      if (definitive) {
        // ⚠️ GERİ ALMANIN SONUCU OKUNUR (denetim, 08-01 — üçüncü tur).
        // Damga geri alınamazsa rezervasyon KALICI olarak "gönderilmiş" sayılır
        // ve bu mesaj bir daha ASLA denenmez — gecikme değil, kalıcı kayıp.
        // Sessiz `catch {}` bu sınıfın kokusudur; artık toplu alarma etiket düşer
        // (`rollback_failed`), döngü yine kırılmaz.
        const rolled = await prisma.reservation
          .updateMany({
            // 🚨 `stampedAt` KOŞULU ŞART (yarış denetimi, 08-05). Claim YALNIZ
            // hâlâ null olan satırları damgalar; koşulsuz bir geri alma ise aynı
            // `sourceReference`'ı paylaşan KARDEŞ satırın GERÇEKTEN gönderilmiş
            // damgasını da siler → sonraki geçiş booking'i tekrar aday görür ve
            // misafire İKİNCİ (gerçek) karşılama mesajı gider. Dup satır bu üründe
            // gerçek bir durum (relink sonrası; prod'da 114 çift temizlenmişti) ve
            // "hepsini damgala" tasarımının varlık sebebi tam da bu çift-gönderimi
            // önlemekti — koşulsuz geri alma o garantiyi kendi kapısından deliyordu.
            where: { sourceReference: r.sourceReference, property: { organizationId }, welcomeSentAt: stampedAt },
            data: { welcomeSentAt: null },
          })
          .catch(() => null);
        if (rolled === null || rolled.count === 0) failures.push("rollback_failed");
      }
      continue; // definitive → un-claimed for retry; ambiguous → claim held (no re-POST)
    }
    sent++;
  }

  await reportLifecycleSendFailures("welcome", organizationId, failures, reservations.length);
  return { sent, considered: reservations.length };
}

/**
 * Send the per-apartment CHECK-IN INFO message a few days before arrival — the
 * practical access details (address, entry code, Wi-Fi). Fires once the stay is
 * within CHECKIN_LEAD_DAYS of check-in, at most once per reservation
 * (checkinSentAt), and only for bookings created after the feature was switched
 * on (autoCheckinEnabledAt → never the backlog). Gated behind AUTO_REPLY_ENABLED
 * + the org autoCheckin toggle. Apartments without a "checkin" knowledge-base
 * entry are skipped. Body comes from that entry, personalised with the guest's
 * first name.
 */
export async function sendDueCheckins(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoCheckin: true, autoCheckinEnabledAt: true, aiSignature: true, timezone: true },
  });
  if (!org || !org.autoCheckin) return { sent: 0, considered: 0 };

  // Multi-tenant: deliver via THIS org's own Hospitable token (skip if unconnected).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return { sent: 0, considered: 0 };

  // Land the access details close to the stay: CHECKIN_LEAD_DAYS before arrival.
  const CHECKIN_LEAD_DAYS = 4;
  const now = new Date();
  const baseline = org.autoCheckinEnabledAt;
  if (!baseline) return { sent: 0, considered: 0 };

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      checkinSentAt: null,
      ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE, // V0.5 tek kaynak (önizleme aynı fragment)
      createdAt: { gte: baseline }, // only bookings created since this was enabled
      arrivalDate: {
        gte: zonedDayRange(now, orgTimezone(org.timezone)).start, // not for stays already begun/past (org-local day)
        lte: addDays(now, CHECKIN_LEAD_DAYS), // …only once within the lead window
      },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { arrivalDate: "asc" },
    take: 25,
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;
  // Hata SINIFI etiketleri (PII yok) — koşu sonunda tek toplu alarma gider.
  const failures: string[] = [];

  for (const r of reservations) {
    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkin", ...GUEST_DELIVERABLE_KB_WHERE },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!tpl) continue; // no check-in info entry for this apartment → skip

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(tpl.content, firstName, signature, r.property.name);

    // Durable Outbox (flag ON): enqueue; the worker delivers and stamps checkinSentAt ONLY on
    // confirmed delivery. Deterministic key (org + booking) → replay/restart dedupes. See welcome.
    if (durableOutboxEnabled() && r.sourceReference) {
      try {
        const enq = await enqueueProactive({
          organizationId,
          reservationId: r.id,
          externalReservationId: r.sourceReference,
          channel: r.channel,
          messageType: "checkin",
          body,
          idempotencyKey: `checkin:${organizationId}:${r.sourceReference}`,
        });
        if (!enq.deduped) sent++;
      } catch {
        // enqueue failure → *SentAt stays null → retries cleanly, ama SESSİZ DEĞİL
        // (denetim, 08-01 — üçüncü tur): bu dal `failures`'a hiçbir şey itmediği için
        // koşu başına tek toplu alarm bu yolda ASLA tetiklenmiyordu.
        failures.push("enqueue_failed");
      }
      continue;
    }

    // Fence against a durable-outbox row for this booking (post-rollback, final-review).
    if (r.sourceReference && (await lifecycleOutboxOwns(organizationId, r.sourceReference, "checkin"))) continue;

    // Claim-then-send (see sendDueWelcomes) — prevents a concurrent double-send.
    // ⚠️ DAMGA DEĞİŞKENE ALINIR — geri alma bunu KOŞUL olarak kullanacak (↓).
    const stampedAt = new Date();
    const claim = await prisma.reservation.updateMany({
      where: { sourceReference: r.sourceReference, property: { organizationId }, checkinSentAt: null },
      data: { checkinSentAt: stampedAt },
    });
    if (claim.count === 0) continue;

    const delivery = await sendOnChannel(
      { channel: r.channel, guestIdentifier: r.guestName, externalReservationId: r.sourceReference },
      body,
      token,
    );
    if (!delivery.ok) {
      // DEFINITIVE failure (HTTP 4xx≠408) → nothing delivered → un-claim for retry.
      // AMBIGUOUS (timeout/5xx/network) → the check-in message MAY have reached the
      // guest → KEEP checkinSentAt so we never re-POST it (duplicate). Mirrors the
      // manual-reply route via the shared isDefinitiveSendFailure() (flag-OFF path).
      const definitive = isDefinitiveSendFailure(delivery.error);
      failures.push(definitive ? "definitive" : "ambiguous");
      if (definitive) {
        // ⚠️ GERİ ALMANIN SONUCU OKUNUR (denetim, 08-01 — üçüncü tur).
        // Damga geri alınamazsa rezervasyon KALICI olarak "gönderilmiş" sayılır
        // ve bu mesaj bir daha ASLA denenmez — gecikme değil, kalıcı kayıp.
        // Sessiz `catch {}` bu sınıfın kokusudur; artık toplu alarma etiket düşer
        // (`rollback_failed`), döngü yine kırılmaz.
        const rolled = await prisma.reservation
          .updateMany({
            // 🚨 `stampedAt` KOŞULU ŞART (yarış denetimi, 08-05). Claim YALNIZ
            // hâlâ null olan satırları damgalar; koşulsuz bir geri alma ise aynı
            // `sourceReference`'ı paylaşan KARDEŞ satırın GERÇEKTEN gönderilmiş
            // damgasını da siler → sonraki geçiş booking'i tekrar aday görür ve
            // misafire İKİNCİ (gerçek) giriş mesajı gider. Dup satır bu üründe
            // gerçek bir durum (relink sonrası; prod'da 114 çift temizlenmişti) ve
            // "hepsini damgala" tasarımının varlık sebebi tam da bu çift-gönderimi
            // önlemekti — koşulsuz geri alma o garantiyi kendi kapısından deliyordu.
            where: { sourceReference: r.sourceReference, property: { organizationId }, checkinSentAt: stampedAt },
            data: { checkinSentAt: null },
          })
          .catch(() => null);
        if (rolled === null || rolled.count === 0) failures.push("rollback_failed");
      }
      continue; // definitive → un-claimed for retry; ambiguous → claim held (no re-POST)
    }
    sent++;
  }

  await reportLifecycleSendFailures("checkin", organizationId, failures, reservations.length);
  return { sent, considered: reservations.length };
}

export interface WelcomePreview {
  guest: string;
  property: string;
  hasEntry: boolean;
  alreadySent: boolean;
  body: string | null;
}

/**
 * Preview the welcome message for upcoming reservations WITHOUT sending — the
 * exact text that would go out (placeholder substituted). Ignores the on/off
 * toggles so the host can review quality before going live. Flags apartments
 * that are missing a welcome entry and reservations already welcomed.
 */
export async function previewWelcomes(
  organizationId: string,
  limit = 12,
  now: Date = new Date(), // injectable for deterministic day-boundary tests
): Promise<WelcomePreview[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiSignature: true, timezone: true },
  });
  const signature = org?.aiSignature?.trim();

  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE, // V0.5: gönderici ile AYNI fragment (önizleme == gerçek, yapısal)
      arrivalDate: { gte: zonedDayRange(now, orgTimezone(org?.timezone)).start, lte: horizon },
    },
    select: {
      guestName: true,
      propertyId: true,
      welcomeSentAt: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one card per booking
    orderBy: { arrivalDate: "asc" },
    take: limit,
  });

  const previews: WelcomePreview[] = [];
  for (const r of reservations) {
    const welcome = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "welcome", ...GUEST_DELIVERABLE_KB_WHERE },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    previews.push({
      guest: r.guestName,
      property: r.property.name,
      hasEntry: Boolean(welcome),
      alreadySent: Boolean(r.welcomeSentAt),
      body: welcome ? buildGuestMessageBody(welcome.content, firstName, signature, r.property.name) : null,
    });
  }
  return previews;
}

/**
 * Preview the check-in info message for upcoming reservations WITHOUT sending —
 * the exact text that would go out (placeholders substituted). Ignores the
 * on/off toggle so the host can review every apartment's "Giriş Talimatı" entry
 * before going live. Flags apartments missing the entry and bookings already
 * messaged.
 */
export async function previewCheckins(
  organizationId: string,
  limit = 12,
): Promise<WelcomePreview[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiSignature: true, timezone: true },
  });
  const signature = org?.aiSignature?.trim();

  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: "confirmed",
      ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE, // V0.5: gönderici ile AYNI fragment (önizleme == gerçek, yapısal)
      arrivalDate: { gte: zonedDayRange(now, orgTimezone(org?.timezone)).start, lte: horizon },
    },
    select: {
      guestName: true,
      propertyId: true,
      checkinSentAt: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one card per booking
    orderBy: { arrivalDate: "asc" },
    take: limit,
  });

  const previews: WelcomePreview[] = [];
  for (const r of reservations) {
    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkin", ...GUEST_DELIVERABLE_KB_WHERE },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    previews.push({
      guest: r.guestName,
      property: r.property.name,
      hasEntry: Boolean(tpl),
      alreadySent: Boolean(r.checkinSentAt),
      body: tpl ? buildGuestMessageBody(tpl.content, firstName, signature, r.property.name) : null,
    });
  }
  return previews;
}

/**
 * Send the per-apartment check-out message ON THE DEPARTURE DAY as a same-day
 * reminder: between 08:00 and 12:00 (org timezone), for bookings checking out
 * today. 08:00 gives the guest a wake-up-and-pack window before the typical
 * 11:00-12:00 checkout (Airbnb's own reminder cadence: native checkout
 * instructions surface to the guest the morning of departure). The 12:00 cap
 * exists so a delayed run never "reminds" a guest who already left. Sent once
 * per reservation (checkoutSentAt). Body comes from the apartment's "checkout"
 * knowledge-base entry, personalised with the guest's first name. Gated behind
 * AUTO_REPLY_ENABLED + the org autoCheckout toggle. Apartments without a
 * checkout entry are skipped.
 */
export async function sendDueCheckouts(
  organizationId: string,
): Promise<{ sent: number; considered: number }> {
  if (process.env.AUTO_REPLY_ENABLED !== "1") return { sent: 0, considered: 0 };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { autoCheckout: true, autoCheckoutEnabledAt: true, aiSignature: true, timezone: true },
  });
  if (!org || !org.autoCheckout) return { sent: 0, considered: 0 };

  // Multi-tenant: deliver via THIS org's own Hospitable token (skip if unconnected).
  const token = await getOrgHospitableToken(organizationId);
  if (!token) return { sent: 0, considered: 0 };

  const now = new Date();
  const tz = orgTimezone(org.timezone);
  // Same-day reminder window: 08:00-11:59 org time on the departure day.
  const hour = currentHourInTimeZone(tz, now);
  if (hour < 8 || hour >= 12) return { sent: 0, considered: 0 };
  // The calendar date of "today" in the org timezone — check-out must be today.
  const todayKey = dateKeyInTimeZone(now, tz);
  // Only message bookings created AFTER checkout was switched on
  // (autoCheckoutEnabledAt), so enabling never messages guests already mid-stay
  // from before. No baseline yet → nothing is sent.
  const baseline = org.autoCheckoutEnabledAt;
  if (!baseline) return { sent: 0, considered: 0 };

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { in: ["confirmed", "completed"] },
      checkoutSentAt: null,
      ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE, // V0.5 tek kaynak (önizleme aynı fragment)
      createdAt: { gte: baseline }, // only bookings created since checkout was enabled
      // +3 CALENDAR days in org-tz (addZonedDays), not date-fns addDays (+72h):
      // DST geçiş günlerinde sabit saat-adımı pencere ucunu yerel geceyarısından
      // kaydırıyordu. Bu yalnız mesaj-SEÇİM penceresidir — asıl gönderim-anı
      // checkout vetosu outbox worker'ındaki lifecycleVeto'da yaşar ve AYNI
      // org-tz takvim-günü kuralını kullanır (Codex 07-23; iki yol ayrışamaz).
      departureDate: { gte: zonedDayRange(now, tz).start, lt: addZonedDays(zonedDayRange(now, tz).start, 3, tz) },
    },
    select: {
      id: true,
      guestName: true,
      channel: true,
      sourceReference: true,
      propertyId: true,
      departureDate: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one message per booking, even if rows duplicated
    orderBy: { departureDate: "asc" },
    take: 25,
  });

  const signature = org.aiSignature?.trim();
  let sent = 0;
  // Hata SINIFI etiketleri (PII yok) — koşu sonunda tek toplu alarma gider.
  const failures: string[] = [];

  for (const r of reservations) {
    // Only when check-out is TODAY (same-day reminder). Compare the departure's
    // calendar day in the ORG timezone against todayKey (also org tz). A UTC
    // day-key disagreed by a day for departures stored at Istanbul midnight, so
    // checkout messages effectively never sent.
    // (No single-night skip anymore: that guard existed because the old
    // evening-before send collided with the arrival day; a morning-of reminder
    // is exactly as useful for a one-night guest.)
    if (dateKeyInTimeZone(r.departureDate, tz) !== todayKey) continue;

    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkout", ...GUEST_DELIVERABLE_KB_WHERE },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!tpl) continue;

    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    const body = buildGuestMessageBody(tpl.content, firstName, signature, r.property.name);

    // Durable Outbox (flag ON): enqueue; the worker delivers and stamps checkoutSentAt ONLY on
    // confirmed delivery. Deterministic key (org + booking) → replay/restart dedupes. See welcome.
    if (durableOutboxEnabled() && r.sourceReference) {
      try {
        const enq = await enqueueProactive({
          organizationId,
          reservationId: r.id,
          externalReservationId: r.sourceReference,
          channel: r.channel,
          messageType: "checkout",
          body,
          idempotencyKey: `checkout:${organizationId}:${r.sourceReference}`,
        });
        if (!enq.deduped) sent++;
      } catch {
        // enqueue failure → *SentAt stays null → retries cleanly, ama SESSİZ DEĞİL
        // (denetim, 08-01 — üçüncü tur): bu dal `failures`'a hiçbir şey itmediği için
        // koşu başına tek toplu alarm bu yolda ASLA tetiklenmiyordu.
        failures.push("enqueue_failed");
      }
      continue;
    }

    // Fence against a durable-outbox row for this booking (post-rollback, final-review).
    if (r.sourceReference && (await lifecycleOutboxOwns(organizationId, r.sourceReference, "checkout"))) continue;

    // Claim-then-send (see sendDueWelcomes) — prevents a concurrent double-send.
    // ⚠️ DAMGA DEĞİŞKENE ALINIR — geri alma bunu KOŞUL olarak kullanacak (↓).
    const stampedAt = new Date();
    const claim = await prisma.reservation.updateMany({
      where: { sourceReference: r.sourceReference, property: { organizationId }, checkoutSentAt: null },
      data: { checkoutSentAt: stampedAt },
    });
    if (claim.count === 0) continue;

    const delivery = await sendOnChannel(
      { channel: r.channel, guestIdentifier: r.guestName, externalReservationId: r.sourceReference },
      body,
      token,
    );
    if (!delivery.ok) {
      // DEFINITIVE failure (HTTP 4xx≠408) → nothing delivered → un-claim for retry.
      // AMBIGUOUS (timeout/5xx/network) → the checkout message MAY have reached the
      // guest → KEEP checkoutSentAt so we never re-POST it (duplicate). Mirrors the
      // manual-reply route via the shared isDefinitiveSendFailure() (flag-OFF path).
      const definitive = isDefinitiveSendFailure(delivery.error);
      failures.push(definitive ? "definitive" : "ambiguous");
      if (definitive) {
        // ⚠️ GERİ ALMANIN SONUCU OKUNUR (denetim, 08-01 — üçüncü tur).
        // Damga geri alınamazsa rezervasyon KALICI olarak "gönderilmiş" sayılır
        // ve bu mesaj bir daha ASLA denenmez — gecikme değil, kalıcı kayıp.
        // Sessiz `catch {}` bu sınıfın kokusudur; artık toplu alarma etiket düşer
        // (`rollback_failed`), döngü yine kırılmaz.
        const rolled = await prisma.reservation
          .updateMany({
            // 🚨 `stampedAt` KOŞULU ŞART (yarış denetimi, 08-05). Claim YALNIZ
            // hâlâ null olan satırları damgalar; koşulsuz bir geri alma ise aynı
            // `sourceReference`'ı paylaşan KARDEŞ satırın GERÇEKTEN gönderilmiş
            // damgasını da siler → sonraki geçiş booking'i tekrar aday görür ve
            // misafire İKİNCİ (gerçek) çıkış mesajı gider. Dup satır bu üründe
            // gerçek bir durum (relink sonrası; prod'da 114 çift temizlenmişti) ve
            // "hepsini damgala" tasarımının varlık sebebi tam da bu çift-gönderimi
            // önlemekti — koşulsuz geri alma o garantiyi kendi kapısından deliyordu.
            where: { sourceReference: r.sourceReference, property: { organizationId }, checkoutSentAt: stampedAt },
            data: { checkoutSentAt: null },
          })
          .catch(() => null);
        if (rolled === null || rolled.count === 0) failures.push("rollback_failed");
      }
      continue; // definitive → un-claimed for retry; ambiguous → claim held (no re-POST)
    }
    sent++;
  }

  await reportLifecycleSendFailures("checkout", organizationId, failures, reservations.length);
  return { sent, considered: reservations.length };
}

/**
 * Email the host when a guest sends a complaint or refund-type message that
 * needs a person. Detection is keyword-based (classifyFallback) — no AI cost.
 * Each flagged conversation is moved to "problem", which routes it to a human
 * (auto-reply skips "problem") AND dedupes the alert so it never re-sends. The
 * feature is off unless ALERT_EMAIL is set. Never throws: e-mail failures are
 * swallowed by the email service and the status write is guarded.
 */
export async function sendDueAlerts(
  organizationId: string,
): Promise<{ alerted: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      alertEmail: true,
      autoHoldingReplyEnabled: true,
      autoTaskFromMessageEnabled: true,
      autoReplyDisclosure: true,
      aiSignature: true,
      // The OWNER's email (role-filtered) — used as the per-tenant fallback so a
      // customer who didn't set an alert address still gets THEIR own alerts.
      // MUST be role-scoped, not "oldest user": a staff-first org would otherwise
      // leak the guest name + message body to a staff account. And we must NOT
      // fall back to env ALERT_EMAIL: that is the operator's address, so other
      // tenants' complaints would leak to the operator.
      users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
    },
  });
  // Per-tenant recipient: this org's own alert address, else the org owner's
  // account email. Never the global env fallback (operator-only).
  const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim();
  if (!to) return { alerted: 0 };

  // Only escalate genuinely recent complaints. A re-sync (e.g. after reconnecting
  // the channel) can resurface a weeks-old unanswered message as "new"; without
  // this guard the host gets a burst of stale alert emails about long-past stays.
  // Real complaints are caught within minutes (the cron syncs ~every 2m), so a few
  // days of slack is plenty.
  const ALERT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

  // Unanswered conversations where the guest spoke last and that aren't flagged.
  const candidates = await prisma.conversation.findMany({
    where: {
      property: { organizationId },
      status: "new",
      // ⚠️ YAŞ PENCERESİ SQL'DE OLMAK ZORUNDA — TAVANLA BİRLİKTE (denetim, 08-01).
      // Filtre yalnız JS'te (`continue`) uygulanıyor, tavan (`take: 50`) SQL'de
      // duruyordu. Damgalanmış konuşmalar (`closing_ack`/`low_confidence_or_risky`/
      // `outside_hours`) `status:"new"` KALIR ve sonsuza kadar birikir: 72 saatten
      // eski 50 satır biriktiği anda her geçiş yalnız o bayat satırları çeker,
      // hepsi JS'te atlanır ve YENİ ŞİKAYET HİÇ SEÇİLMEZ. Bu, aynı gün
      // `runDueChannelAutoReplies` için kapatılan açlık sınıfının birebir aynısı.
      lastMessageAt: { gte: new Date(Date.now() - ALERT_MAX_AGE_MS) },
    },
    select: {
      id: true,
      guestIdentifier: true,
      channel: true,
      priority: true,
      propertyId: true,
      reservationId: true,
      externalReservationId: true,
      // ⚠️ CLAIM'DEN ÖNCEKİ DEĞER. Aşağıdaki atomik claim bu alanı "complaint"
      // ile EZİYOR, yani senkronun ölü-konaklama çitinin damgası
      // ("reservation_ended", `fenceUnlinkedTerminalStay`) ancak BURADA
      // okunabilir. Bekletme mesajı kapısı bunu kullanıyor.
      skippedReason: true,
      property: { select: { name: true, address: true, city: true } },
      // ⚠️ TEK MESAJ YETMEZ (derin denetim, 08-01). Misafir arka arkaya yazınca
      // — önce şikayet, sonra zararsız bir takip — `take: 1` yalnız sonuncuyu
      // getiriyordu, `classifyFallback` onu şikayet saymıyordu ve uyarı HİÇ
      // gitmiyordu. Konuşma da oto-yanıtla "answered" olduğu için bir daha
      // seçilmiyordu: şikayet KALICI kayboluyordu. Son 6 mesaj alınır, aşağıda
      // CEVAPLANMAMIŞ olanların (son giden yanıttan sonrakiler) HEPSİ taranır.
      messages: { orderBy: { createdAt: "desc" }, take: 6 },
    },
    // ⚠️ EN YENİ ÖNCE. Bu satır 08-01'de bir mutasyon-geri-alma script'inin
    // sayı sınırı olmayan `replace`'i yüzünden KAZAYLA "asc" olmuştu (commit
    // mesajında yoktu, yorum kodun tersini anlatıyordu). Şikayet uyarısında
    // doğru yön "en yeni önce"dir: bayat yığın yeni şikayeti ezmemeli.
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });

  let alerted = 0;
  let escalationEmailFailures = 0;
  // Geri alma DA düşerse satır bir daha seçilemez → ayrı, daha ağır sinyal.
  let escalationRollbackFailures = 0;
  // Bu geçiş zamanlanmış koşunun SÜRE BÜTÇESİNDEN MUAF (uyarı susturulamaz),
  // ama muafiyet sınırsız olamaz: 50 aday × 15 sn e-posta timeout'u = 12 dakika,
  // ve senkron kilidinin TTL'i 15 dakika. Kendi wall-clock tavanını taşır;
  // dolduğunda kalan adaylar bir sonraki geçişe kalır (claim edilmedikleri için
  // hiçbir şey kaybolmaz, yalnız gecikir).
  const alertsStartedAt = Date.now();
  const ALERT_BUDGET_MS = 60_000;
  for (const c of candidates) {
    if (Date.now() - alertsStartedAt > ALERT_BUDGET_MS) break;
    const last = c.messages[0];
    if (!last || last.direction !== "inbound") continue;
    // Skip stale backlog surfaced by a re-sync — only alert on fresh messages.
    if (Date.now() - last.createdAt.getTime() > ALERT_MAX_AGE_MS) continue;
    // Mesajlar YENİDEN ESKİYE geldi; cevaplanmamış pencere = ilk giden mesaja
    // kadar olan kısım. O pencerenin HERHANGİ birinde şikayet varsa uyarı gider.
    const outboundAt = c.messages.findIndex((m) => m.direction === "outbound");
    const pending = (outboundAt === -1 ? c.messages : c.messages.slice(0, outboundAt)).filter(
      (m) => m.direction === "inbound",
    );
    const hit = pending.find((m) => {
      const k = classifyFallback(m.body);
      return k.isComplaint || k.intent === "refund";
    });
    if (!hit) continue;
    const cls = classifyFallback(hit.body);
    const riskType = detectRiskType(hit.body);

    // ATOMIC claim first (new → problem): routes the thread to a human, dedupes
    // the alert AND is the idempotency lock for the optional holding ack below —
    // two concurrent passes can't both win, so the guest can never get the ack
    // (or the host the email) twice. If a send below then fails, the thread is
    // still visibly flagged "problem" in the inbox, so nothing is silently lost.
    let claimed = 0;
    try {
      const res = await prisma.conversation.updateMany({
        where: { id: c.id, status: "new" },
        data: {
          status: "problem",
          skippedReason: "complaint",
          lastRiskType: riskType,
          // m48 — YOL 2/3: KELİME yolu. Model HİÇ koşmadı, o yüzden analiz
          // alanları NULL yazılır — uydurma değer ÜRETİLMEZ. `aiTriageSource`
          // yine de yazılır: "modele sorulmadı" ile "model sorulup sonuç
          // alınamadı" ayrımı artık NULL'a değil BU kolona bağlı.
          ...buildTriageData({
            source: "keyword",
            triggerMessageId: hit.id,
            now: new Date(),
          }),
        },
      });
      claimed = res.count;
    } catch {
      // ignore; the next run will retry
    }
    if (claimed !== 1) continue;

    // Decision made (keyword path — NO model verdict, so riskLevel stays null
    // rather than fabricating one). Recorded at the claim, independent of the
    // email/ack deliveries below; never throws, unique key absorbs retries.
    await recordRiskEvent({
      organizationId,
      propertyId: c.propertyId,
      conversationId: c.id,
      surface: "alerts",
      // Tetikleyici ŞİKAYET mesajıdır, en son gelen zararsız takip DEĞİL:
      // tekilleştirme anahtarı da böylece doğru satıra bağlanır.
      triggerId: hit.id,
      finalDecision: "human_review",
      riskType,
      reason: "keyword_escalated",
    });

    const html = complaintEscalationEmail(
      { id: c.id, guestIdentifier: c.guestIdentifier, channel: c.channel, priority: c.priority },
      hit.body, // host ŞİKAYETİ görmeli, sonraki zararsız mesajı değil
      { name: c.property.name, address: c.property.address, city: c.property.city },
      org?.name ?? "GuestOps",
    );
    // GÖNDERİM SONUCU OKUNUR (`sendReporting`, `send` DEĞİL). `send()` asla
    // fırlatmaz: sağlayıcı hatasında yalnız console'a yazar. Eskiden burada o
    // kullanılıyordu ve sonucu kimse okumuyordu — yani Resend'in tek bir 5xx'i
    // host'un ŞİKAYET UYARISINI KALICI OLARAK yutuyordu: claim konuşmayı zaten
    // "problem"e taşımış olduğu için ne bu döngü (yalnız status:"new" seçer) ne
    // de model yolu (status "problem" ise erken döner) o thread'i bir daha
    // seçebiliyordu. Tek iz, host'un fark etmesi gereken bir inbox rozetiydi.
    const mail = await emailService.sendReporting(
      to,
      `⚠️ Acil misafir mesajı — ${c.guestIdentifier} (${c.property.name})`,
      html,
    );
    if (!mail.ok) {
      // Claim'i GERİ AL ki bir sonraki geçiş yeniden denesin. YALNIZ `status`
      // geri alınır: `skippedReason`/`lastRiskType` kalır, böylece inbox rozeti
      // görünmeye devam eder (görünürlük kaybı yok) ama satır yeniden seçilebilir
      // hâle gelir. Bekletme mesajı (holding ack) ve görev bilerek ATLANIR —
      // e-posta gitmediği için tur baştan alınacak; ack'in idempotency kilidi
      // claim olduğundan, ancak e-postanın başarılı olduğu turda bir kez çalışır.
      // Sonsuz tekrar riski yok: ALERT_MAX_AGE_MS penceresi dışına çıkan mesaj
      // zaten aday listesinden düşer.
      // ⚠️ GERİ ALMANIN SONUCU OKUNUR (denetim, 08-01 — üçüncü tur, ajan bulgusu).
      // Bu, ürünün EN YÜKSEK BAHİSLİ bildirimi: geri alma düşerse konuşma kalıcı
      // "problem" kalır, aday listesi yalnız `status:"new"` seçtiği için satır bir
      // daha SEÇİLEMEZ ve host'a giden TEK acil şikayet bildirimi izsiz kaybolur.
      // Yaşam-döngüsü göndericilerinde aynı desen zaten okunuyordu; burası atlanmıştı.
      const rolled = await prisma.conversation
        .updateMany({ where: { id: c.id, status: "problem" }, data: { status: "new" } })
        .catch(() => null);
      if (rolled === null || rolled.count === 0) escalationRollbackFailures++;
      escalationEmailFailures++;
      continue;
    }
    alerted++;

    // Tier-2 holding acknowledgement (opt-in; keyword path — no model verdict
    // here, so holdingAckEligible alone decides mildness).
    if (org) {
      await maybeSendHoldingAck({
        organizationId,
        conversation: {
          id: c.id,
          channel: c.channel,
          guestIdentifier: c.guestIdentifier,
          externalReservationId: c.externalReservationId,
        },
        guestMessage: hit.body,
        org,
        language: null,
        // Claim `skippedReason`'ı çoktan ezdi — çit damgası aday satırından okunur.
        stayFencedBeforeClaim: c.skippedReason === "reservation_ended",
      }).catch(() => false);
    }

    // Smart operational task (opt-in): keyword-detected complaints are the
    // primary escalation path (this runs before the model pass), so the task
    // must be created HERE too — not only in applyChannelAutoReply. Deduped;
    // best-effort, never blocks the alert.
    if (org?.autoTaskFromMessageEnabled) {
      await createOperationalTaskFromMessage({
        propertyId: c.propertyId,
        message: hit.body,
        sourceMessageId: hit.id,
        reservationId: c.reservationId,
        ai: { intent: cls.intent, riskType },
      }).catch(() => {});
    }
  }
  // Koşu başına TEK toplu alarm (PII yok: yalnız sayı). Şikayet uyarısı bu ürünün
  // "AI karar vermez, riskli mesaj insana gider" sözünün taşıyıcısı — sessizce
  // başarısız olması en pahalı arıza. Satır başına rapor etmiyoruz: e-posta
  // sağlayıcısı komple düşerse 50 aday × her geçiş = alarm seli olurdu.
  if (escalationEmailFailures > 0) {
    void reportError(
      `sendDueAlerts org=${organizationId}`,
      new Error(
        `escalation e-mail failed for ${escalationEmailFailures} conversation(s)` +
          (escalationRollbackFailures > 0
            ? ` — ${escalationRollbackFailures} of them ALSO failed to roll back (those threads stay "problem" and will NOT be retried)`
            : ""),
      ),
    );
  }
  return { alerted };
}

/** Preview check-out messages for upcoming departures (no sending). */
export async function previewCheckouts(
  organizationId: string,
  limit = 12,
): Promise<WelcomePreview[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiSignature: true, timezone: true },
  });
  const signature = org?.aiSignature?.trim();
  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId },
      status: { in: ["confirmed", "completed"] },
      ...PROVIDER_MESSAGEABLE_RESERVATION_WHERE, // V0.5: gönderici ile AYNI fragment (önizleme == gerçek, yapısal)
      departureDate: { gte: zonedDayRange(now, orgTimezone(org?.timezone)).start, lte: horizon },
    },
    select: {
      guestName: true,
      propertyId: true,
      checkoutSentAt: true,
      property: { select: { name: true } },
    },
    distinct: ["sourceReference"], // one card per booking
    orderBy: { departureDate: "asc" },
    take: limit,
  });

  const previews: WelcomePreview[] = [];
  for (const r of reservations) {
    const tpl = await prisma.knowledgeBaseItem.findFirst({
      where: { propertyId: r.propertyId, category: "checkout", ...GUEST_DELIVERABLE_KB_WHERE },
      select: { content: true },
      orderBy: { updatedAt: "desc" },
    });
    const firstName = guestFirstName(r.guestName) ?? r.guestName;
    previews.push({
      guest: r.guestName,
      property: r.property.name,
      hasEntry: Boolean(tpl),
      alreadySent: Boolean(r.checkoutSentAt),
      body: tpl ? buildGuestMessageBody(tpl.content, firstName, signature, r.property.name) : null,
    });
  }
  return previews;
}

/**
 * Preview what the channel auto-reply WOULD send right now — without sending
 * anything. Ignores the on/off toggle and the active-hours window so the user
 * can test quality at any time. Returns one outcome per candidate conversation.
 */
export async function previewChannelAutoReplies(
  organizationId: string,
  limit = 12,
): Promise<ChannelAutoReplyOutcome[]> {
  const candidates = await prisma.conversation.findMany({
    where: {
      property: { organizationId },
      ...PROVIDER_THREAD_CONVERSATION_WHERE, // V0.5: gönderici (dueAutoReplyWhere) ile aynı fragment
      status: "new",
    },
    // ⚠️ EN YENİ ÖNCE. Bu satır da 08-01'de aynı hatalı geri-alma script'iyle
    // kazayla "asc" olmuştu. Önizlemenin sorusu "AI ŞU AN ne cevap verirdi?" —
    // "asc" ile host, aylar önceki bayat thread'leri görüyor ve günlük AI kotası
    // (rota model çağrısından ÖNCE tüketiyor) onlara yanıyordu.
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: { id: true },
  });

  const outcomes: ChannelAutoReplyOutcome[] = [];
  for (const c of candidates) {
    outcomes.push(
      await applyChannelAutoReply(c.id, { dryRun: true, ignoreSchedule: true, ignoreToggle: true }),
    );
  }
  return outcomes;
}
