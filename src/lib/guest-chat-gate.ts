import "server-only";

import { admitsMissingKnowledge, namesInternalSource } from "@/lib/ai/absence";
import { mentionsAssistanceAnimal, mentionsPets, petReplyStraysFromFreeKb } from "@/lib/conversation-items/pet-policy";
import { absenceHolds, seniorChecksOf, type AbsenceJudgeOutcome } from "@/lib/ai/semantic/absence-judge";
import { noApologyRuleEnabled } from "@/lib/ai/no-apology-rule";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { actionClaimHold, type ClaimedActionsDeclaration } from "@/lib/ai/action-claims";
import { vetoAvailability, type AvailabilityPolicyOptions } from "@/lib/ai/availability-claims";
import { timeConflictHolds } from "@/lib/ai/time-conflict-gate";
import type { TimeConflict } from "@/lib/ai/prompts";
import { evaluateIntentRisk, type IntentRiskKind } from "@/lib/ai/semantic/intent-risk";
import type {
  StayChangeDeclaration,
  StayGuardOutcome,
  StayTimes,
  UnderstandingStaySignal,
} from "@/lib/ai/semantic/stay-change";
import { classifyFallback, detectPromptInjection, detectRiskType, detectRiskTypes } from "@/lib/ai/fallback";
import { contextLabels, hasEmergencyCallDirective, hasSafetyReassurance, kbSupportsReassurance } from "@/lib/ai/hazard-evidence";
import {
  confidentLanguage,
  guestTurnLanguage,
  languageEvidence,
  replyLanguageMismatch,
  type ConfidentLanguage,
} from "@/lib/ai/language-signal";
import { HIGH_STAKES_RISK_TYPES } from "@/lib/automation";
import { fixSupportHolds, type KbFixSupport } from "@/lib/conversation-items/relation";

// ---------------------------------------------------------------------------
// QR MİSAFİR SOHBETİ — DEVİR KAPISI (saf; DB yok, ağ yok, yan etki yok).
//
// 🚨 NEDEN AYRI MODÜL (09-11): bu fonksiyon "bot bu cevabı misafire gönderir mi"
// kararının TAMAMIDIR ve rota dosyasının İÇİNDE yaşadığı için hiçbir yerden
// çağrılamıyordu. Sonuç: eval harness'ı "ürün bunu gönderir mi" sorusunu tek bir
// VEKİLLE (`admitsMissingKnowledge`) ölçüyordu — kapının BİR dalı. Kurucunun
// 09-11 gerçek koşusundaki dokuz kırmızının SEKİZİ bu vekil yüzünden çıktı:
// ürün doğru karar veriyordu (güven 0.3 → `low_confidence` → devir), eval
// yanlış şeyi ölçüyordu.
//
// ⚠️ BU BİR TAŞIMADIR, YENİDEN YAZIM DEĞİL. Kod ve yorumlar rota dosyasından
// BİREBİR geldi; tek satır mantık değişmedi. `passesAutoReplySafetyGate`in
// `automation.ts`te yaşamasıyla aynı desen.
//
// 🚨 ROTA DOSYASINDAN EXPORT ETMEK DENENMEDİ, ÇÜNKÜ RİSKLİ: Next.js App Router
// rota modüllerinde standart dışı DEĞER export'u build'i kırabilir ve bu depoda
// hiçbir rota öyle bir export taşımıyor (emsal yok). Taşıma, hem o riski
// kaldırır hem güvenlik-kritik kapıyı test edilebilir yapar.
// ---------------------------------------------------------------------------

// Intents that must never be answered autonomously to a guest — money,
// cancellation, complaint, or an explicit ask for a human.
export const ESCALATE_INTENTS: ReadonlySet<string> = new Set(["complaint", "refund", "early_departure", "human_request"]);

/**
 * Risksiz bir bilgi sorusunda modelin cevabının gönderilebileceği EN DÜŞÜK güven.
 * Altı = "model gerçekten emin değil" → insana devir. Üstü ama 0.75'in altı =
 * "bilgi eksik olabilir ama cevap dürüst" → gönder ve gerekçeyi kaydet.
 */
const INFORMATIONAL_MIN_CONFIDENCE = 0.45;

/**
 * Bant, gerçek model eval'i yapılana kadar VARSAYILAN KAPALI (Codex şartı:
 * "genişleyen otomatik gönderim davranışını güvenli biçimde sınırla"). Kapalıyken
 * davranış eskisiyle birebir aynıdır: 0.75 altı her güven insana devredilir.
 */
function informationalBandEnabled(): boolean {
  return process.env.QR_INFORMATIONAL_BAND_ENABLED === "1";
}

/**
 * KAYNAKSIZ SOMUT İDDİA — bandın asıl güvenlik kapısı.
 *
 * `usedSources` kodda doğrulanır (`verifyUsedSources`): boş liste "bu cevap hiçbir
 * bilgi kalemine/mülk alanına dayanmıyor" demektir. Böyle bir cevap SOMUT bir şey
 * söylüyorsa (bir yer tarifi, bir sayı/saat/kod) bu uydurma olabilir ve misafir
 * onu mülkün gerçeği sanar. Dayanaksız ama SOMUT OLMAYAN cevap ("bu konuda kayıtlı
 * bilgim yok", "hangi konuda yardımcı olayım?") güvenlidir ve bandın amacı zaten odur.
 *
 * Dar ve deterministik: kaynak varsa hiç bakılmaz; kaynak yoksa rakam veya yer
 * ifadesi aranır. Yanılma yönü GÜVENLİ tarafa (fazladan devir).
 */
const SPECIFIC_PLACE_WORDS =
  /(arkasında|arkasinda|önünde|onunde|yanında|yaninda|altında|altinda|üstünde|ustunde|karşısında|karsisinda|katta|kat[ıi]nda|numaralı|numarali|sokak|cadde|kapıda|kapida|asansör|asansor|bodrum|teras)/i;
export function hasUnsourcedSpecificClaim(reply: string, usedSources: string[]): boolean {
  if (usedSources.length > 0) return false;
  return /\d/.test(reply) || SPECIFIC_PLACE_WORDS.test(reply);
}

/**
 * KAPALI KÜME devir gerekçeleri — `RiskEvent.reason` ile BİREBİR (PII taşımaz).
 * Canlıda "her soruya ilettim" gözlendiğinde hangi dalın kapattığı görünsün diye
 * eklendi: karar tek boolean iken teşhis yalnız yeniden üretimle yapılabiliyordu.
 */
/**
 * 🚨 DİZİ, ELLE YAZILMIŞ BİRLEŞİM TİPİ DEĞİL (09-12 incelemesi).
 *
 * Tip, ÇALIŞMA ZAMANINDA yok. Parite testi (`risk-event-reason-parity`) bu
 * listeyi önce KAYNAK TARAYARAK çıkarıyordu ve o yaklaşım tam da korumak
 * istediği yerde körleşiyordu: üyeler arasındaki JSDoc bloklarından birine tek
 * bir `;` girse tarama erken kesiliyor (ölçüldü: 13 üye → 6) ve kesme SON
 * yorumda olursa anti-vakum çapaları da geçiyor — yani EN YENİ gerekçe sessizce
 * denetimden düşüyordu. Liste artık gerçek bir değer; tip ondan TÜRETİLİYOR.
 *
 * Anlamları:
 *  · `history_injection` — GEÇMİŞ mesajlardan birinde injection (displacement);
 *    güncel mesaj zararsızdı. `injection`dan AYRI ki canlıda hangi dalın
 *    kapattığı görünsün.
 *  · `unsourced_claim` — bant içindeydi AMA cevap kaynaksız somut iddia taşıyordu.
 *  · `absence_admission` — cevabın KENDİSİ bilginin kayıtlarda olmadığını
 *    söylüyordu → misafire GİTMEZ (09-11).
 *  · `informational_low_confidence` — DEVİR DEĞİL: risksiz soru, orta güven,
 *    kaynaksız iddia yok → dürüst cevap gitti.
 */
export const ESCALATION_REASONS = [
  "guest_name_injection",
  "model_unavailable",
  "escalate_intent",
  "model_risk_type",
  "keyword_escalated",
  "injection",
  "history_injection",
  "keyword_risk_type",
  "model_risk_level",
  "low_confidence",
  "unsourced_claim",
  "absence_admission",
  "informational_low_confidence",
  // Çıktı vetosu (§A) — `output-veto.ts` `OutputVetoReason` ile BİREBİR (K10, 09-30: devir / bildirim cümlesi `handoff_notice`).
  "placeholder_in_reply",
  "unverified_commitment",
  "handoff_notice",
  // Müsaitlik vetosu (09-24) — `availability-claims.ts` `AVAILABILITY_VETO_REASONS` ile BİREBİR.
  "availability_claim",
  "availability_unconfirmed",
  "price_claim",
  // Anlama katmanının risk niyeti (09-24) — `intent-risk.ts` `INTENT_RISK_REASON` ile BİREBİR.
  "understanding_risk",
  // Saat kaynağı çelişkisi (P4-b kodda, 09-25) — kanal kapısıyla AYNI yüklem (`time-conflict-gate.ts`).
  "kb_time_conflict",
  // Eylem beyanı (MÇ §4, bayrak kapalıyken yazılmaz) — `action-claims.ts` `ACTION_CLAIM_REASONS` ile BİREBİR.
  "action_claim",
  "action_claim_undeclared",
  // Misafirin dilinde değil (Sabah Kararları 56, kurucu onayı 10-02 akşam) — kanal kapısıyla AYNI yüklem (`language-signal.ts`).
  "reply_language_mismatch",
  // Fiziksel tehlike (Sabah Kararları 51 + 55, kurucu onayı 10-02 akşam; `hazard-evidence.ts`): AÇIK tehlike modeli beklemeden devir
  // (misafire metin YOK — güvenlik satırı 10-11'de kurucu kararıyla kalktı); bağlamla kaldırılan alarmda kaynaksız güvence gitmez.
  "physical_hazard",
  "hazard_reassurance",
  // Çıktıda kapı kodu (kurucu kararı 10-11): bir kez yeniden yazdırıldı, ikinci taslak da kapı / kutu kodu taşıdı → cevap gitmedi.
  // Kapının kendisi bu dalı döndürmez; rota `qrReplyHasDoorCode` ile koyar (`chat/[token]/route.ts`).
  "door_code_in_reply",
  // Cevap misafiri acil numarayı / acil servisi aramaya yönlendirdi (kurucu kararı 10-11) → gitmez; QR'da önce bir kez yeniden yazdırılır.
  "emergency_directive",
  // Kanıtsız arıza adımı (kurucu 10-15: "BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN ÖNERİLER VEREMEZ"; anahtar `AI_FIX_SUPPORT_GATE_ENABLED`) —
  // kanal kapısıyla AYNI yüklem (`relation.fixSupportHolds`).
  "fix_unsupported",
  // Kıdemli okuyucu (T-b, kurucu 10-22; anahtar `AI_SENIOR_READER_ENABLED`): ev sahibine platform dışı ödeme (T-d) · özür / kusur kabulü (T-a).
  "offplatform_payment",
  "reply_apology",
  // Kurucu 10-22: cevap bilgiyi NEREDEN bildiğini anlatıyor (bilgi tabanı / kayıt / not / sistem) — kanal kapısıyla AYNI yüklem.
  "reply_internal_source",
  // Kurucu 10-23 akşam 4.4 (seçenek A) — kanal kapısıyla AYNI kural: evcil hayvandan söz eden cevap yalnız bilgi tabanı kodla "ücretsiz kabul"
  // diyorsa gider; yardımcı hayvan hiç.
  "reply_pet_policy",
] as const;

export type EscalationReason = (typeof ESCALATION_REASONS)[number];

/**
 * Real-time public chat gate. Unlike the Airbnb auto-reply gate (whose failure
 * mode is "leave a draft for the host"), here the failure mode is "escalate" —
 * there is no human at the doorway. Returns true when the bot must NOT answer.
 *
 * (Bu açıklama rotadan BURAYA taşındı: kod taşınırken yorum geride kalmış ve
 * artık hiçbir şeyi belgelemeyen yetim bir blok hâline gelmişti — 09-11.)
 *
 * Devir kararı + GEREKÇESİ. `reason: null` → kapı geçildi (otomatik cevap).
 */
/** QR kapısı ile QR karar kaydı AYNI politika girdisini kullanır (gerekçe ↔ hüküm ayrışamaz). */
export function qrAvailabilityPolicy(
  result: { intent?: string; stayChange?: StayChangeDeclaration | null; source?: string },
  stayCtx?: {
    stayTimes?: StayTimes | null;
    stayGuard?: StayGuardOutcome;
    understanding?: UnderstandingStaySignal | null;
    understandingFailed?: boolean;
    kbFacts?: readonly string[] | null;
    /** Doğrulanmış müsaitlik / uzatma KOD metni (QR anahtarı `AI_VERIFIED_QR_ENABLED`); muafiyet şartları `availability-claims.ts`. */
    verifiedAvailability?: { text: string } | null;
    verifiedExtension?: { text: string } | null;
  },
): AvailabilityPolicyOptions {
  return {
    declared: result.stayChange ?? null,
    // Kanal kapısıyla AYNI iki girdi (`availabilityPolicyFor`): niyet etiketi + şablon cevabı ayrımı.
    replyIntent: result.intent ?? null,
    deterministicReply: result.source === "fallback",
    guard: stayCtx?.stayGuard,
    understanding: stayCtx?.understanding ?? null,
    understandingFailed: stayCtx?.understandingFailed === true,
    stayTimes: stayCtx?.stayTimes ?? null,
    // Modelin gördüğü bilgi tabanı (24 EK): yazılı sabit otopark yeri tahsisi takvim iddiası sayılmaz — kanal kapısıyla parite.
    kbFacts: stayCtx?.kbFacts ?? null,
    verifiedAvailability: stayCtx?.verifiedAvailability ?? null,
    verifiedExtension: stayCtx?.verifiedExtension ?? null,
  };
}

export function evaluateEscalation(
  result: {
    intent: string;
    riskLevel: string;
    confidence: number;
    source: string;
    riskType?: string | null;
    /** Modelin gönderdiği metin — kaynaksız somut iddia taraması için. */
    reply?: string;
    /** Kodda doğrulanmış kaynak etiketleri (`verifyUsedSources`). Boş = dayanaksız. */
    usedSources?: string[];
    /** Modelin konaklama değişikliği ŞEMA BEYANI (yalnız sıkılaştırır). */
    stayChange?: StayChangeDeclaration | null;
    /** İstemin gördüğü giriş/çıkış saati çelişkileri (`suggestReply` taşır; P4-b kodda). */
    timeConflicts?: readonly TimeConflict[] | null;
    /** Modelin eylem beyanı (`ai/action-claims.ts`); yokluğu = beyan istenmedi → kural koşmaz. */
    claimedActions?: ClaimedActionsDeclaration | null;
  },
  message: string,
  /** Reservation guest name (Airbnb-controlled) — the model sees it in the prompt,
   *  so an injection planted in the NAME must escalate even on a benign message. */
  guestName?: string | null,
  /**
   * 🚨 MODELE GİDEN GEÇMİŞ PENCERESİ (`buildGuestChatContextWindow` çıktısı).
   *
   * Bu parametre 09-12'de eklendi ve KANAL YOLUNDAKİ `dfd1683` DÜZELTMESİNİN
   * AYNISIDIR. QR rotası 09-08'den beri modele kronolojik geçmiş veriyor ama
   * kapı yalnız GÜNCEL mesaja bakıyordu — yani model görüyor, kapı görmüyordu.
   *
   * Saldırı (ölçüldü): misafir 1. turda injection yazar → devredilir AMA mesaj
   * konuşmaya KAYDEDİLİR → 2. turda zararsız bir soru yazar → pencere yükü
   * modele taşır. QR devri yapışkan olmadığı için 2. tur temiz sayılıyordu.
   *
   * ⚠️ Verilmezse davranış BİREBİR eski (geriye dönük uyumlu).
   */
  history?: readonly { body: string }[],
  /**
   * Anlam katmanı (09-24): mülkün standart saatleri + bağımsız bekçinin sonucu + anlama katmanı.
   * Kanal kapısıyla AYNI politika (`evaluateAvailability`); verilmezse deterministik yedek + beyan.
   */
  stayCtx?: {
    stayTimes?: StayTimes | null;
    stayGuard?: StayGuardOutcome;
    understanding?: UnderstandingStaySignal | null;
    understandingFailed?: boolean;
    /** Anlama katmanının en ağır risk niyeti; verilmezse sinyal yok. */
    understandingRisk?: IntentRiskKind | null;
    /** Modelin gördüğü bilgi tabanı (`kbFactsOf`) — yalnız 24 EK otopark tahsisi istisnası için. */
    kbFacts?: readonly string[] | null;
    /**
     * Modelin bildirdiği misafir dili (anlama katmanı, yoksa cevap modelinin `detectedLanguage`ı). YALNIZ kodun dil tespiti emin
     * değilken ve mesaj en az iki sözcükken dil kapısına girdi olur (56: "Y a-t-il un fer à repasser ?" kodca belirsiz).
     */
    guestLanguageHint?: string | null;
    /**
     * 51 (kurucu onayı 10-02 akşam): kelime ağının fiziksel tehlike sözcüğünden gelen "acil" etiketi bağlamla KALDIRILDI
     * (`hazardDecisionFor().lexicalCleared` — olası / anılış düzeyi + model "acil değil"). Açık tehlikede asla true olmaz.
     */
    hazardCleared?: boolean;
    /** Kalkan etiket olası fiziksel tehlikedendi → acil değil ama şikâyet olarak sayılır (`contextLabels`). */
    hazardClearedAsIssue?: boolean;
    /** Olası fiziksel tehlike + anlama katmanı koşmadı (`hazardDecisionFor().unverifiedPossible`) → karar verecek model yok: devir. */
    hazardUnverified?: boolean;
    /** Doğrulanmış müsaitlik / uzatma KOD metni (QR anahtarı `AI_VERIFIED_QR_ENABLED`); yalnız birebir metne ve bütün şartlarla muaf. */
    verifiedAvailability?: { text: string } | null;
    verifiedExtension?: { text: string } | null;
    /** Kanıtsız arıza adımı kemeri (`relation.fixSupportContextOf`; anahtar kapalıyken alan yok → kural koşmaz). */
    kbFixSupport?: KbFixSupport;
    /** "Bilgim yok" bağlam hakemi (`AI_ABSENCE_JUDGE_ENABLED`) + okuduğu metin; hüküm yalnız birebir aynı cevaba uygulanır. */
    absenceJudge?: { reply: string; outcome: AbsenceJudgeOutcome };
    /** Modelin gördüğü bilgi tabanı evcil hayvanı kodla okunduğunda açıkça ÜCRETSİZ ve KOŞULSUZ kabul ediyor (`pet-policy.kbPetsFreeAllowed`). */
    petsFreeAllowed?: boolean;
  },
): { escalate: boolean; reason: EscalationReason | null } {
  const yes = (reason: EscalationReason) => ({ escalate: true, reason });
  if (guestName && detectPromptInjection(guestName)) return yes("guest_name_injection");
  if (result.source !== "openai") return yes("model_unavailable"); // canned fallback → host handles it
  if (ESCALATE_INTENTS.has(result.intent)) return yes("escalate_intent"); // money/complaint/human
  // Parity with the inbox auto-send gate: a high-stakes riskType LABEL from the
  // model (review_threat / platform_policy / access_security / money_refund / …)
  // is itself a red flag — escalate even when the model scored riskLevel low. No
  // handoff-ack exemption here: at the doorway there's no human to hand off to in
  // real time, so human_request escalates too (already covered by ESCALATE_INTENTS).
  if (result.riskType && HIGH_STAKES_RISK_TYPES.has(result.riskType)) return yes("model_risk_type");
  // Cross-check the guest's own words against the deterministic detector — catches
  // an angry/refund message the model under-rated as benign.
  const fb = classifyFallback(message);
  if (fb.isComplaint || fb.intent === "refund" || fb.intent === "early_departure" || fb.intent === "human_request") {
    return yes("keyword_escalated");
  }
  // Deterministic high-risk backstops (mirror the inbox auto-send gate): a classic
  // injection or a safety/rule/discrimination message is escalated even if the
  // model under-rated it as benign — the guest chat has no human-review draft.
  if (detectPromptInjection(message)) return yes("injection");
  // 🚨 GEÇMİŞ DE TARANIR — model onu GÖRÜYOR (displacement açığı, 09-12).
  //
  // ⚠️ KAPSAM BİLEREK DAR: geçmişte YALNIZ injection aranır. Şikâyet/risk kelime
  // ağlarını eski mesajlara yeniden koşturmak normal bir sohbeti KALICI olarak
  // bloklardı — dünkü çözülmüş şikâyet, bugünkü wifi cevabını engellemek için
  // sebep değildir. Kanal kapısındaki (`automation.ts`) gerekçenin aynısı.
  //
  // ⚠️ BİLİNEN SINIR (09-12 incelemesi): tarama YÖN FİLTRESİ UYGULAMAZ, yani
  // GİDEN satırlar da (bot/host metni) taranır. Teorik olarak host kendi
  // cevabında "jailbreak"/"developer mode" gibi bir sözcük kullanırsa konuşma
  // pencere boyunca kendini kilitler. KANAL YOLUYLA PARİTE (`automation.ts`
  // aynası da `selectHistoryForPrompt(messages)` çıktısını yön ayırmadan tarar)
  // ve yön GÜVENLİ (yalnız fazladan devir) → bilinçli olarak dokunulmadı.
  if (history?.some((m) => m.body.trim() !== "" && detectPromptInjection(m.body))) {
    return yes("history_injection");
  }
  // 🚨 AYNI KÜMEYİ KULLAN, ELLE YAZILMIŞ ÜÇLÜYÜ DEĞİL (denetim, 08-09). Üstteki
  // yorum "inbox oto-gönderim kapısının aynası" diyordu ve bu satır o iddiayı
  // YALANLIYORDU: model ETİKETİ için (:144) tam küme kullanılırken, misafirin
  // KENDİ SÖZLERİ için yalnız üç etiket kontrol ediliyordu. Inbox kapısı
  // 08-06'da tam kümeye genişletildi, bu satır güncellenmedi.
  // Ölçülen sonuç: "IBAN'ınızı atar mısınız? Parayı doğrudan göndereyim."
  // → `detectRiskType` = `platform_policy` (yüksek bahis) ama üçlüde yok →
  // halka açık QR botu platform-dışı ödeme talebine CEVAP VERİYORDU.
  // ⚠️ DAVRANIŞ DEĞİŞİKLİĞİ: küme `complaint`i de içerir, yani modelin "low"
  // dediği hafif bir şikâyet de artık insana devredilir. Yön KISITLAYICI
  // (yalnız DAHA ÇOK devir) ve ürünün 3-seviye modeliyle uyumlu: şikâyet
  // zaten Seviye-2'dir. `human_request` için muafiyet YOK — kapıda gerçek
  // zamanlı devredilecek insan yok (↑:142-143'teki gerekçe aynen geçerli).
  // 51: bağlamla kaldırılan fiziksel tehlike etiketi bu kontrolde sayılmaz; aynı mesajdaki başka etiket (öncelik sırasıyla) aynen sayılır.
  const dr = stayCtx?.hazardCleared
    ? (contextLabels(detectRiskTypes(message), { lexicalCleared: true, clearedAsIssue: stayCtx.hazardClearedAsIssue === true })[0] ?? null)
    : detectRiskType(message);
  if (dr && HIGH_STAKES_RISK_TYPES.has(dr)) return yes("keyword_risk_type");
  // Kelime ağının SESSİZ kaldığı olası fiziksel tehlike ("Kısa devre oldu, wifi şifresi neydi?"), anlama katmanı koşmadıysa cevap
  // modelinin "risk yok" demesine bırakılmaz (Haiku 10-14; kanal kapısıyla parite `automation.ts`).
  if (stayCtx?.hazardUnverified) return yes("physical_hazard");
  if (result.riskLevel !== "none" && result.riskLevel !== "low") return yes("model_risk_level");
  // ── "BİLGİM YOK" MİSAFİRE GİTMEZ (kurucu kuralı, 09-11) ───────────────────
  //
  // 🚨 GÜVEN EŞİĞİNDEN BAĞIMSIZ ve BANTTAN ÖNCE: ölçüldü ki modelin güveni 0.75
  // ÜSTÜNDE olan bir "kayıtlı bilgim yok" cevabı bu kapıdan geçip misafire
  // gidiyordu (2. gerçek koşu: güven .8, kaynak 0/0). Kurucu kuralı: host neden
  // "bilgim yok" mesajı göndersin? O cevabın işe yarar tek parçası zaten devir
  // metninin kendisi ("mesajınız kaydedildi") — devredince misafir onu ZATEN alır.
  //
  // ⚠️ ÖLÇÜT CEVABIN KENDİ İTİRAFIDIR, "kaynak yok" DEĞİL: `usedSources` yalnız KB
  // kalemlerini sayar; "Giriş saati kaçta?" cevabı MÜLK ALANINDAN gelir, kaynaksız
  // görünür ama DAYANAKLIDIR ve gitmeye devam eder (test-pinli).
  // BAĞLAM HAKEMİ (kurucu 10-21, anahtar KAPALI): hakem bu metni okuduysa karar onun; yoksa kelime kuralı (kanal kapısıyla aynı yüklem).
  const judged = stayCtx?.absenceJudge && stayCtx.absenceJudge.reply === result.reply ? stayCtx.absenceJudge.outcome : undefined;
  if (absenceHolds(admitsMissingKnowledge(result.reply ?? ""), judged)) return yes("absence_admission");
  // ── KIDEMLİ OKUYUCU (T-b, kurucu 10-22; anahtar `AI_SENIOR_READER_ENABLED` KAPALI) — kanal kapısıyla AYNI hükümler, yalnız TUTAR. QR bir
  // OTA kanalı değil: platform dışı iletişim kuralı (Airbnb) burada koşmaz.
  const senior = seniorChecksOf(judged);
  if (senior?.payHost) return yes("offplatform_payment");
  if (senior?.apology && noApologyRuleEnabled()) return yes("reply_apology");
  // ── ÇIKTI VETOSU (Codex denetimi §A, 09-12) ───────────────────────────────
  //
  // 🚨 Gerekçe KAPALI KÜMEDEN ve AYRI: canlıda "yer tutucu mu, makbuzsuz söz
  // mü kapattı" sorusu farklı bir teşhis. `output-veto.ts` iki değer döndürür
  // ve ikisi de `EscalationReason` birliğinde + `risk-events.ts` REASONS'ta.
  //
  // Kapsam ÖLÇÜLEREK daraltıldı (yalnız ETKEN dallar): Türkçe edilgen çatı
  // yüzeyde ayrışmıyor, "Gürültü şikâyetleri yönetime bildirilir" (MEŞRU SSS)
  // ile "Konu yönetime bildirilmiştir" (makbuzsuz) BİREBİR aynı şablon.
  const vetoed = vetoOutgoingReply(result.reply);
  if (vetoed !== null) return yes(vetoed);
  // ── EYLEM BEYANI (MÇ §4) — kanal kapısıyla AYNI yüklem ve AYNI yer (çıktı vetosunun ardında). Makbuz yok → devir. ──
  const claim = actionClaimHold(result.claimedActions);
  if (claim !== null) return yes(claim);
  // ── 51: ALARM BAĞLAMLA KALKTIYSA KAYNAKSIZ GÜVENCE GİTMEZ (kurucu: "'normaldir, güvenlidir' diye kaynaksız güvence verilmesin") ──
  if (stayCtx?.hazardCleared && hasSafetyReassurance(result.reply) && !kbSupportsReassurance(stayCtx.kbFacts)) {
    return yes("hazard_reassurance");
  }
  // ── ACİL ARAMA YÖNERGESİ MİSAFİRE GİTMEZ (kurucu kararı 10-11: "112'yi arayın yazmasın … hiçbir şekilde") ──
  if (hasEmergencyCallDirective(result.reply)) return yes("emergency_directive");
  // Kurucu 10-22 ("bilgi tabanıyla ilgili … hiçbir şey müşteriye gitmemeli"; çıktı vetosunun ve acil arama yönergesinin ARDINDA — kanal
  // kapısıyla aynı sıra (Opus 10-22): aynı taslakta yer tutucu / "112'yi arayın" varsa kayıt o sebebi taşır ve boşuna ücretli yeniden yazma
  // koşmaz): okuyucu okuduysa onun hükmü; ayrıca kodun açık sözcük yedeği (okuyucu kapalı / düştü / kaçırdı) — ANAHTARSIZ. Okuyucu açıksa
  // rota bir kez yeniden yazdırır.
  if (senior?.internalSource || namesInternalSource(result.reply ?? "")) return yes("reply_internal_source");
  // Evcil / yardımcı hayvan (kurucu 10-23 akşam 4.4) — kanal kapısıyla AYNI kural ("model sallamasın").
  // QR'da öğe kipi yok → misafirin mesajı da okunur (Opus 10-23 akşam B3): belirsiz "evet" ve yalnız misafirin andığı yardımcı hayvan.
  if (
    (mentionsPets(result.reply) || mentionsPets(message)) &&
    (stayCtx?.petsFreeAllowed !== true ||
      mentionsAssistanceAnimal(result.reply) ||
      mentionsAssistanceAnimal(message) ||
      petReplyStraysFromFreeKb(result.reply, mentionsPets(message)))
  ) {
    return yes("reply_pet_policy");
  }
  // ── KANITSIZ ARIZA ADIMI (kurucu 10-15; anahtar `AI_FIX_SUPPORT_GATE_ENABLED`) — kanal kapısıyla AYNI yüklem. Bilgi tabanında tarifi /
  // konusu olmayan cihaz için adım misafire gitmez, ev sahibine devredilir. ──
  // Koddan kurulan doğrulanmış müsaitlik / uzatma metni muaf (kanal kapısındaki `codeBuiltGrant` paritesi — Haiku 10-15 gece).
  const qrCodeBuilt = result.reply != null && (result.reply === stayCtx?.verifiedAvailability?.text || result.reply === stayCtx?.verifiedExtension?.text);
  if (!qrCodeBuilt && fixSupportHolds(result.reply, stayCtx?.kbFixSupport, message)) return yes("fix_unsupported");
  // ── MÜSAİTLİK VETOSU (kurucu kararı 09-24) ────────────────────────────────
  // Kanal kapısıyla AYNI yüklem. QR'da cevaplanan tek mesaj GÜNCEL mesajdır (eşzamanlı sohbet;
  // önceki turlar ya o anda cevaplandı ya da ev sahibine DEVREDİLDİ — devredilen tur yapay zekâ cevabı
  // almaz, alarmı ve açık konu notu kendi yolundan taşınır; Haiku 10-11: eski yorum "zaten cevaplandı"
  // diyordu, devredilen turda yanlıştı). Devir muafiyeti burada GEREKMEZ: `human_request` yukarıda
  // `escalate_intent` ile zaten devredildi.
  const availability = vetoAvailability(result.reply, [message], qrAvailabilityPolicy(result, stayCtx));
  if (availability !== null) return yes(availability);
  // ── SAAT KAYNAĞI ÇELİŞKİSİ (P4-b kodda, 09-25) — kanal kapısıyla AYNI yüklem ve AYNI yer (müsaitlikten sonra). ──
  if (timeConflictHolds(result.timeConflicts, { intent: result.intent, reply: result.reply, guestTexts: [message] })) {
    return yes("kb_time_conflict");
  }
  // ── ANLAMA KATMANININ RİSK NİYETLERİ (09-24, `semantic/intent-risk.ts`) ──────
  // Kanal kapısıyla AYNI yüklem; iki "geçiş" çıkışının (bilgi bandı + tam güven) hemen önünde uygulanır →
  // gerekçe yalnız başka HİÇBİR kontrol devretmediğinde `understanding_risk` olur. Katman koştuysa her zaman karar
  // verir (birleşim değişmezi 09-24, gölge kip YOK).
  const intentRisk = evaluateIntentRisk(stayCtx?.understandingRisk, { modelIntent: result.intent }).reason;
  // ── EKSİK BİLGİDE DÜRÜST CEVAP — DAR BANT (kurucu, 09-08) ─────────────────
  //
  // Buraya gelen mesaj, YUKARIDAKİ SEKİZ KAPININ HEPSİNDEN geçmiştir: model
  // yanıt verdi, model riski yok, modelin intent'i devir kümesinde değil,
  // misafirin kendi sözleri kelime ağı/injection/riskType dedektörlerinden
  // temiz çıktı. Yani elimizde RİSKSİZ bir bilgi sorusu var ve tek eksik,
  // modelin kendi güveninin tam olmaması (çoğu zaman: bilgi tabanında karşılığı
  // yok). Eski davranış bunu da insana devrediyordu — canlıda "nasılsın" bile
  // "ev sahibine ilettim" cevabı alıyordu ve asistan kullanılamaz hâldeydi.
  //
  // Bandın ALTI hâlâ devirdir: model gerçekten emin değilse (0.45'in altı)
  // cevabı göndermek dürüst olmaz. Bandın İÇİ, modelin "bilgim yok" demeyi de
  // kapsayan dürüst yanıtıdır ve karar ayrı bir gerekçeyle KAYDEDİLİR, yani
  // canlıda ölçülebilir (gereksiz devir azaldı mı, yanlış cevap arttı mı).
  if (
    informationalBandEnabled() &&
    result.confidence >= INFORMATIONAL_MIN_CONFIDENCE &&
    result.confidence < 0.75
  ) {
    // 🚨 DÜŞÜK GÜVEN "DÜRÜST BİLMİYORUM"UN KANITI DEĞİLDİR (Codex, 09-08).
    // Model aynı güvenle UYDURABİLİR. Bandı açan şey güven değil, cevabın
    // DAYANAĞIDIR: kaynak göstermeyen bir cevap mülke özgü somut bir şey
    // iddia ediyorsa (yer, sayı, saat, kod) o cevap gönderilmez — insana gider.
    if (hasUnsourcedSpecificClaim(result.reply ?? "", result.usedSources ?? [])) {
      return yes("unsourced_claim");
    }
    if (intentRisk) return yes(intentRisk);
    if (qrLanguageMismatch(message, result.reply, stayCtx?.guestLanguageHint)) return yes("reply_language_mismatch");
    return { escalate: false, reason: "informational_low_confidence" };
  }
  // Sonlu olmayan güven (NaN / Infinity / eksik) "yüksek güven" değildir — kanal kapısının `confidence_invalid` paritesi (F01; 10-01, 15 ajan
  // A05: QR'da `NaN < 0.75` yanlış olduğu için kapı GEÇİYORDU). Yapay zekâ katmanı bugün güveni sonlu sayıya zorluyor; kapı ona güvenmez.
  if (!Number.isFinite(result.confidence) || result.confidence < 0.75) return yes("low_confidence");
  if (intentRisk) return yes(intentRisk);
  if (qrLanguageMismatch(message, result.reply, stayCtx?.guestLanguageHint)) return yes("reply_language_mismatch");
  return { escalate: false, reason: null };
}

/**
 * MİSAFİRİN DİLİNDE DEĞİL (Sabah Kararları 56, kurucu onayı 10-02 akşam: "QR'a dil kontrolü eklenmesi mantıklı. Kısa mesaj, dil
 * değişimi, özel ad ve karışık dil vakalarını sınasın; basit kelime kontrolüyle meşru cevapları engellemesin."). Kanal kapısının
 * AYNI yüklemi (`replyLanguageMismatch`): yalnız misafirin mesajı VE cevabın tamamı ya da bir cümlesi EMİNCE farklı dildeyse tutar;
 * belirsizlik (kısa mesaj, karışık yazı, desteklenmeyen dil, özel ad) engel değildir. QR'da cevaplanan tek mesaj GÜNCEL mesajdır
 * (eşzamanlı sohbet). EN SONDA: kalite gerekçesi hiçbir güvenlik gerekçesini gölgelemez. Önceki gerekçe ("devir metni + arayüz yalnız
 * Türkçe") K10 ile düştü: devirde misafire metin gitmiyor; yanlış dildeki cevap da gitmez, ev sahibi panelde görür.
 */
const QR_HINT_LANGUAGES: ReadonlySet<string> = new Set<ConfidentLanguage>(["tr", "en", "de", "fr", "es", "ru", "ar"]);

function qrLanguageMismatch(message: string, reply: string | null | undefined, hint?: string | null): boolean {
  // Kodun kesin tespiti önce; emin değilse (kısa / karışık soru) MODELİN bildirdiği dil — yalnız en az iki sözcükte ("Merci !", "Wifi?"
  // gibi tek sözcükte hüküm verilmez: kısa mesaj kuralı).
  const words = (message.match(/\p{L}+/gu) ?? []).length;
  const hinted = hint && QR_HINT_LANGUAGES.has(hint) ? (hint as ConfidentLanguage) : null;
  const guest = guestTurnLanguage(message, []) ?? (words >= 2 ? hinted : null);
  if (!replyLanguageMismatch(guest, reply)) return false;
  // KARIŞIK DİL: cevabın (emin) dili misafirin mesajında da iz taşıyorsa ("Hi! Wifi şifresi ne acaba?" → İngilizce cevap) meşrudur.
  const replyLang = confidentLanguage(reply);
  return !(replyLang !== null && languageEvidence(message).has(replyLang));
}
