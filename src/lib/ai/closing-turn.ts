// ---------------------------------------------------------------------------
// KAPANIŞ MESAJINA SESSİZLİK (kurucu kuralı 09-25): misafir yalnız teşekkür / onay yazdıysa ("Teşekkürler", "Tamamdır",
// "👍", "Anladım") ve cevapsız başka bir soru/istek yoksa yapay zekâ HİÇBİR ŞEY göndermez
// ("Anladım teşekkürler ama 12'de gelebilir miyiz?" → normal akış). Kanal oto-yanıtı ve QR sohbeti AYNI yüklemleri
// kullanır. İki yol, ikisi de yalnız SUSTURUR (asla metin üretmez):
//  · SÖZCÜK (hızlı yol, model çağrısı yok): cevapsız misafir mesajlarının HEPSİ `isClosingAck` beyaz listesinde. TEK
//    mesaja değil TÜMÜNE bakılır ("Bir gece daha kalabilir miyiz?" + "Teşekkürler 🙏" → modele).
//    🚨 `isPositiveFeedback` (övgü listesi) BU YOLDA YOK (inceleme 09-25, P1): dolgu sözcükleriyle ("is/the/we/are")
//    soru işaretsiz soruyu da kabul ediyordu ("is the apartment clean" → sessizlik + gizleme). Övgü modele gider.
//  · ANLAM (listenin kaçırdığı "Anladım", "Kolay gelsin", başka diller): anlama katmanı cevapsız mesajların TAMAMINI
//    gördü ve YALNIZ `greeting_thanks` buldu + cevap modeli de kendi istem kuralına göre "soru/talep yok" dedi (niyet
//    `general`, güven < 0.4) + kapı YALNIZ düşük güvenden kapandı (o denetim çağıranda). İki bağımsız modelin uyuşması
//    YETMEZ (inceleme 09-25, P2): istem aynı hükmü bilgi tabanının cevaplayamadığı soruya da verdirir ve anlama katmanı
//    beş istekten sonrasını keser → soru işareti, sözcük ağının niyeti, kesilmiş istek listesi, modelin eksik bilgi /
//    eylem önerisi ve teşekkür/onay sinyalinin YOKLUĞU susturmayı engeller (sözcük kuralları yalnız SIKILAŞTIRIR).
//  · Her iki yol da ÖNCEKİ BİR CEVAP ister: ilk mesaj "İyi akşamlar" / "Merhaba" bir selamdır, kapanış değil.
// SESSİZLİK ≠ GİZLEME: misafire hiçbir şey gitmez; ama konuşmanın ev sahibinin listesinden "cevap gerekmedi" diye
// düşmesi (`closingMayHide`) yalnız açık iş olmadığı KESİNSE — teklif kabulü ("Tamam olur"), devirden sonraki teşekkür,
// ev sahibine bırakılmış bir soru görünür kalır (yanlış gizleme gerçek bir işi kaybettirir; gereksiz görünürlük ucuzdur).
// Saf; DB/ağ yok.
// ---------------------------------------------------------------------------

import { classifyFallback, isClosingAck } from "./fallback";
import { hasMoneyStatement } from "./stay-money";
import { MAX_UNDERSTOOD_REQUESTS, type MessageUnderstanding } from "./semantic/understanding-schema";
import { UNDERSTANDING_WINDOW } from "./semantic/understand";
import { resolveMessageAuthor } from "@/lib/message-author";

/** İstemin kapanış kuralındaki güven tavanı (`prompts.ts` BÖLÜM 11: "confidence değerini 0.4'ün ALTINA koy"). */
export const CLOSING_MAX_MODEL_CONFIDENCE = 0.4;

/**
 * Anlam yolunun kısa-mesaj tavanı: saf kapanış kısadır; uzun mesajda anlama katmanının kesme payı (maske metni
 * uzatabilir) ve gizli bir soru riski büyür → hüküm verilmez.
 */
const SEMANTIC_CLOSING_MAX_CHARS = 280;

/** Soru işareti (Latin, tam genişlik, İspanyolca açılış, Arapça). Soru soran mesaj kapanış değildir. */
const QUESTION_MARK = /[?？¿؟]/u;

const NL = "(?<!\\p{L})";
const NR = "(?!\\p{L})";

/**
 * TEŞEKKÜR / ONAY / VEDA / ÖVGÜ SİNYALİ — yalnız ANLAM yolunun GEREKLİ koşulu (tek başına hiçbir şeyi susturmaz).
 * "Merhaba, bir sorum olacaktı" / "Hi, are you there" gibi selam ve habercilerin iki model tarafından "yalnız selam"
 * sayılıp susturulmasını engeller. Kapsayıcı tutulur: fazladan eşleşme yalnız öteki koşullara bırakır.
 */
const ACK_SIGNAL = new RegExp(
  [
    `${NL}(?:te[şs]ekk[üu]r\\p{L}*|sa[ğg]\\s?ol\\p{L}*|eyvallah|tamam\\p{L}*|anla[dşs]\\p{L}*|peki|oldu|olur|harika\\p{L}*|s[üu]per\\p{L}*` +
      `|m[üu]kemmel\\p{L}*|g[üu]zel\\p{L}*|rica\\s+eder\\p{L}*|kolay\\s+gelsin|iyi\\s+(?:g[üu]nler|ak[şs]amlar|geceler|tatiller|yolculuklar)` +
      `|g[öo]r[üu][şs][üu]r[üu]z|ho[şs][çc]a\\s+kal\\p{L}*|eline\\p{L}*\\s+sa[ğg]l[ıi]k|var\\s?ol\\p{L}*|memnun\\p{L}*|bay[ıi]ld\\p{L}*|mersi)${NR}`,
    `${NL}(?:thank\\p{L}*|thx|ty|cheers|got\\s+it|understood|ok|okay|okey|alright|all\\s+right|perfect|great|awesome|wonderful|amazing` +
      `|lovely|noted|sounds\\s+good|all\\s+good|will\\s+do|bye|goodbye|see\\s+you|appreciate\\p{L}*|cool|fine|super|excellent|fantastic)${NR}`,
    `${NL}(?:danke\\p{L}*|vielen\\s+dank|alles\\s+klar|verstanden|perfekt|prima|toll|tsch[üu]ss|wunderbar|merci|parfait|d'accord|compris` +
      `|entendu|g[ée]nial|au\\s+revoir|gracias|perfecto|entendido|vale|de\\s+acuerdo|adi[oó]s|estupendo|grazie|perfetto)${NR}`,
    `${NL}(?:спасибо|благодар\\p{L}*|понял\\p{L}*|понятно|хорошо|отлично|ок|ладно|до\\s+свидания|супер)${NR}`,
    "شكر|تمام|حسنا|فهمت|ممتاز|رائع|مع السلامة",
    "[👍🙏👌❤♥😊🙂😀😃😄😁🤗💯✅🥰😍👏]",
  ].join("|"),
  "iu",
);

/** Metin bir teşekkür / onay / veda / övgü sinyali taşıyor mu (iki küçük harf katlamasıyla: standart + Türkçe). */
export function hasAckSignal(text: string): boolean {
  return [text.toLowerCase(), text.toLocaleLowerCase("tr")].some((f) => ACK_SIGNAL.test(f));
}

function nonEmpty(texts: readonly string[]): string[] {
  return texts.filter((t) => t.trim() !== "");
}

/** Sözcük yolu: cevapsız misafir mesajlarının HEPSİ kapanış/teşekkür/onay (en az bir mesaj). Önceki cevap şartı çağıranda. */
export function lexicalClosingOnly(unanswered: readonly string[]): boolean {
  const texts = nonEmpty(unanswered);
  return texts.length > 0 && texts.every((t) => isClosingAck(t));
}

/**
 * Anlam yolu: iki bağımsız model "yalnız teşekkür/kapanış" diyor VE hiçbir sözcüksel sinyal buna itiraz etmiyor. Kapı
 * koşulu (yalnız düşük güvenden kapandı) ÇAĞIRANDA denetlenir — bu yüklem onu varsaymaz.
 */
export function semanticClosingOnly(input: {
  unanswered: readonly string[];
  /** Bu sohbette misafire daha önce bir cevap gitti mi (ilk mesaj selamdır, kapanış değil). */
  hasPriorReply: boolean;
  understood: MessageUnderstanding | null | undefined;
  reply: {
    intent: string;
    confidence: number;
    source: string;
    missingInfo?: readonly unknown[] | null;
    actionSuggestion?: unknown;
  };
}): boolean {
  if (!input.hasPriorReply) return false;
  const texts = nonEmpty(input.unanswered);
  if (texts.length === 0 || texts.length > UNDERSTANDING_WINDOW.maxMessages) return false;
  if (texts.some((t) => t.length > SEMANTIC_CLOSING_MAX_CHARS)) return false;
  // Sözcüksel itirazlar (yalnız sıkılaştırır): soru işareti, teşekkür/onay sinyali YOK, kelime ağının bir niyeti var.
  if (texts.some((t) => QUESTION_MARK.test(t))) return false;
  if (!texts.every(hasAckSignal)) return false;
  if (texts.some((t) => classifyFallback(t).intent !== "general")) return false;
  const u = input.understood;
  // Anlama katmanı en fazla MAX_UNDERSTOOD_REQUESTS istek döndürür ve fazlasını KESER: tavandaki liste eksik olabilir.
  if (!u || u.requests.length === 0 || u.requests.length >= MAX_UNDERSTOOD_REQUESTS) return false;
  if (!u.requests.every((r) => r.intent === "greeting_thanks")) return false;
  if (u.stay.requested) return false;
  const r = input.reply;
  if ((r.missingInfo?.length ?? 0) > 0 || (r.actionSuggestion !== null && r.actionSuggestion !== undefined)) return false;
  return (
    r.source === "openai" &&
    r.intent === "general" &&
    Number.isFinite(r.confidence) &&
    r.confidence < CLOSING_MAX_MODEL_CONFIDENCE
  );
}

export interface ClosingThreadMessage {
  direction: string;
  senderName: string;
  authorType?: string | null;
  systemEventType?: string | null;
  body: string;
  aiIntent?: string | null;
}

/**
 * Misafirin gördüğü giden mesajın yazarı; sistem olayı / gövdesiz satır / eski QR işareti cevap DEĞİL → null. Sistem
 * olayı ve eski işaret `resolveMessageAuthor`dan "system" döner (ayrı `systemEventType` denetimi ölü koddu — mutasyon
 * turu 09-25).
 */
export function replyAuthorOf(m: ClosingThreadMessage): "ai" | "host" | null {
  if (m.direction !== "outbound" || m.body.trim() === "") return null;
  const a = resolveMessageAuthor(m).authorType;
  return a === "ai" || a === "host" ? a : null;
}

/** Sohbette misafire daha önce bir cevap (yapay zekâ ya da ev sahibi) gitti mi. */
export function hasPriorReply(messages: readonly ClosingThreadMessage[]): boolean {
  return messages.some((m) => replyAuthorOf(m) !== null);
}

/** Yapay zekânın devir / bekletme cevabı (insan talebi, şikâyet bekletmesi): ardından gelen teşekkür açık işi kapatmaz. */
const HANDOFF_REPLY_INTENTS: ReadonlySet<string> = new Set(["human_request", "complaint"]);

/**
 * Kapanıştan sonra konuşma "cevap gerekmedi" diye ev sahibinin listesinden DÜŞEBİLİR mi — yalnız açık iş olmadığı
 * KESİNSE (inceleme 09-25, P1). Kapatır:
 *  · `openHostWork` — son ev sahibi mesajından sonra ev sahibine bırakılmış (tutulan / erteleyen) bir misafir mesajı var
 *    (karar kaydından, çağıranda);
 *  · son cevap yapay zekânın devir / bekletme cevabı;
 *  · son cevap bir SORU ya da TEKLİF taşıyor (soru işareti, tutar/indirim) → "Tamam olur" / "Perfect" bir KABULDÜR.
 * `messages` kronolojik ve kapanış mesaj(lar)ını içerebilir (yalnız son CEVAP okunur).
 */
export function closingMayHide(input: { messages: readonly ClosingThreadMessage[]; openHostWork: boolean }): boolean {
  if (input.openHostWork) return false;
  let last: ClosingThreadMessage | null = null;
  let author: "ai" | "host" | null = null;
  for (const m of input.messages) {
    const a = replyAuthorOf(m);
    if (a !== null) {
      last = m;
      author = a;
    }
  }
  if (!last) return false;
  if (author === "ai" && last.aiIntent && HANDOFF_REPLY_INTENTS.has(last.aiIntent)) return false;
  if (QUESTION_MARK.test(last.body)) return false;
  if (hasMoneyStatement(last.body)) return false;
  return true;
}
