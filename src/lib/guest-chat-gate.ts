import "server-only";

import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { classifyFallback, detectPromptInjection, detectRiskType } from "@/lib/ai/fallback";
import { HIGH_STAKES_RISK_TYPES } from "@/lib/automation";

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
const ESCALATE_INTENTS = new Set(["complaint", "refund", "early_departure", "human_request"]);

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
  const dr = detectRiskType(message);
  if (dr && HIGH_STAKES_RISK_TYPES.has(dr)) return yes("keyword_risk_type");
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
  if (admitsMissingKnowledge(result.reply)) return yes("absence_admission");
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
    return { escalate: false, reason: "informational_low_confidence" };
  }
  if (result.confidence < 0.75) return yes("low_confidence");
  return { escalate: false, reason: null };
}
