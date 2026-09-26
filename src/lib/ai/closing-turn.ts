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
//  · Her iki yol da KAPANIŞA UYGUN NOKTA ister (`closableAfter`): bir misafir mesajından SONRA gitmiş bir cevap (hoş
//    geldiniz otomasyonundan sonraki "İyi akşamlar" bir selamdır) VE yapay zekânın son cevabı soru/teklif değil
//    ("Yol tarifini de gönderebilirim" → "Olur" bir cevaptır, modele).
// SESSİZLİK ≠ GİZLEME: misafire hiçbir şey gitmez; ama konuşmanın ev sahibinin listesinden "cevap gerekmedi" diye
// düşmesi (`closingMayHide`) yalnız açık iş olmadığı KESİNSE — ev sahibinin kendi mesajından sonraki onay, teklif kabulü
// ("Tamam olur"), devirden sonraki teşekkür, ev sahibine bırakılmış bir soru görünür kalır (yanlış gizleme gerçek bir işi
// kaybettirir; gereksiz görünürlük ucuzdur).
// Saf; DB/ağ yok.
// ---------------------------------------------------------------------------

import { classifyFallback, isClosingAck } from "./fallback";
import { hasAvailabilityDeferral } from "./availability-claims";
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
 * ⚠️ "İyi akşamlar / iyi günler / iyi geceler" BİLEREK YOK (inceleme 09-25, P1): SELAM da olabilir ("Merhaba, iyi
 * akşamlar" + soru sonraki mesajda) ve anlama katmanı selamı da `greeting_thanks` etiketler.
 */
const ACK_SIGNAL_SRC = [
  `${NL}(?:te[şs]ekk[üu]r\\p{L}*|sa[ğg]\\s?ol\\p{L}*|eyvallah|tamam\\p{L}*|anla[dşs]\\p{L}*|peki|oldu|olur|harika\\p{L}*|s[üu]per\\p{L}*` +
    `|m[üu]kemmel\\p{L}*|g[üu]zel\\p{L}*|rica\\s+eder\\p{L}*|kolay\\s+gelsin` +
    `|g[öo]r[üu][şs][üu]r[üu]z|ho[şs][çc]a\\s+kal\\p{L}*|eline\\p{L}*\\s+sa[ğg]l[ıi]k|var\\s?ol\\p{L}*|memnun\\p{L}*|bay[ıi]ld\\p{L}*|mersi)${NR}`,
  `${NL}(?:thank\\p{L}*|thx|ty|cheers|got\\s+it|understood|ok|okay|okey|alright|all\\s+right|perfect|great|awesome|wonderful|amazing` +
    `|lovely|noted|sounds\\s+good|all\\s+good|will\\s+do|bye|goodbye|see\\s+you|appreciate\\p{L}*|cool|fine|super|excellent|fantastic)${NR}`,
  `${NL}(?:danke\\p{L}*|vielen\\s+dank|alles\\s+klar|verstanden|perfekt|prima|toll|tsch[üu]ss|wunderbar|merci|parfait|d'accord|compris` +
    `|entendu|g[ée]nial|au\\s+revoir|gracias|perfecto|entendido|vale|de\\s+acuerdo|adi[oó]s|estupendo|grazie|perfetto)${NR}`,
  `${NL}(?:спасибо|благодар\\p{L}*|понял\\p{L}*|понятно|хорошо|отлично|ок|ладно|до\\s+свидания|супер)${NR}`,
  "شكر|تمام|حسنا|فهمت|ممتاز|رائع|مع السلامة",
  "[👍🙏👌❤♥😊🙂😀😃😄😁🤗💯✅🥰😍👏]",
].join("|");
const ACK_SIGNAL = new RegExp(ACK_SIGNAL_SRC, "iu");
const ACK_SIGNAL_ALL = new RegExp(ACK_SIGNAL_SRC, "giu");

const folds = (text: string): string[] => [text.toLowerCase(), text.toLocaleLowerCase("tr")];

/** Metin bir teşekkür / onay / veda / övgü sinyali taşıyor mu (iki küçük harf katlamasıyla: standart + Türkçe). */
export function hasAckSignal(text: string): boolean {
  return folds(text).some((f) => ACK_SIGNAL.test(f));
}

/**
 * Teşekkür/onay sözcükleri çıkarıldıktan sonra KALAN sözcük sayısı (iki katlamanın küçüğü). Anlam yolu yalnız "baştan
 * sona kapanış" mesajını susturur: "Anladım, çok teşekkür ederim" (2 kalan) ✓; "Tamam, su akıtıyor tavandan" (3) ✗.
 */
function residualWordCount(text: string): number {
  return Math.min(
    ...folds(text).map((f) => f.replace(ACK_SIGNAL_ALL, " ").split(/[^\p{L}]+/u).filter((w) => w.length > 0).length),
  );
}
/** Anlam yolunda kapanışın yanında izin verilen en fazla yabancı sözcük ("çok", "ederim", "hocam"). */
const SEMANTIC_CLOSING_MAX_RESIDUAL_WORDS = 2;

/**
 * Kapanışın içinde saklanan istek/itiraz işaretleri (anlam yolu; yalnız SIKILAŞTIRIR): rakam (saat/tarih/tutar),
 * karşıtlık ("ama / but / aber / mais / pero / но / لكن") ve rica ("lütfen / please / bitte / por favor / пожалуйста").
 */
const HIDDEN_REQUEST = new RegExp(
  `\\p{N}|${NL}(?:ama|fakat|ancak|lakin|yalnız|lütfen|lutfen|rica\\s+ets\\p{L}*|but|however|please|pls|plz|aber|jedoch|bitte` +
    `|mais|cependant|s'il\\s+vous\\s+pla[iî]t|pero|sin\\s+embargo|por\\s+favor|но|однако|пожалуйста)${NR}|لكن|من\\s+فضلك|رجاء`,
  "iu",
);

/**
 * Türkçe soru eki AYRI sözcüktür ("uygun mu", "yazar mısınız", "ister misiniz") — soru işareti yazılmasa da soru.
 * (İspanyolca "mi casa" da eşleşir: yalnız sıkılaştırır.)
 */
const TR_QUESTION_PARTICLE = new RegExp(`${NL}m[ıiuü](?:s[ıiuü]n(?:[ıiuü]z)?|y[ıiuü]m|y[ıiuü]z|d[ıiuü]r)?${NR}`, "u");

/** Soru: soru işareti (Latin, tam genişlik, İspanyolca açılış, Arapça) ya da Türkçe soru eki. */
function asksQuestion(text: string): boolean {
  return QUESTION_MARK.test(text) || folds(text).some((f) => TR_QUESTION_PARTICLE.test(f));
}

/**
 * CEVAP İSTEYEN TEKLİF (inceleme 09-25, P1): "İsterseniz yol tarifini de gönderebilirim", "I can bring fresh towels",
 * "Geç çıkış 300 TL; isterseniz hemen ayarlayalım". Soru işareti taşımayan teklif kabulü ("Olur", "Tamam") kapanış
 * DEĞİL, bir CEVAPTIR. Birinci şahıs teklif/yeterlilik biçimleri; "I can only / I can't / no puedo / не могу" ve genel
 * "yardımcı olabilirim / I can help" DEĞİL. Ölçüm (1.287 model cevabı): 9 isabet, hepsi teklif ya da teklif-benzeri
 * (fazladan eşleşme yalnız kapanış kısayolunu atlatır → model karar verir).
 */
const OFFER = new RegExp(
  [
    `${NL}(?<!yardımcı\\s{1,3})\\p{L}+(?:ebilir|abilir)im${NR}`,
    `${NL}\\p{L}{3,}(?:[ey]?elim|[ay]?alım)${NR}`,
    `${NL}(?:haber\\s+verirseniz|haber\\s+verin|bildirirseniz|ister\\s+misiniz)${NR}`,
    `${NL}(?:would\\s+you\\s+like|shall\\s+i|should\\s+i|want\\s+me\\s+to|if\\s+you(?:'d|\\s+would)?\\s+like\\s+me\\s+to|let\\s+me\\s+know)${NR}`,
    `${NL}i\\s+(?:can|could)\\s+(?!only|not|help|see|say|confirm|promise|approve)\\p{L}{2,}${NR}`,
    `${NL}(?:i'?d\\s+be\\s+)?happy\\s+to\\s+(?!help)\\p{L}+${NR}`,
    `${NL}(?:soll\\s+ich|gerne\\s+kann\\s+ich|(?:ich\\s+kann|kann\\s+ich|könnte\\s+ich)\\s+(?!ihnen\\s+nur|nur|den|die|das|nicht)\\p{L}+|möchten\\s+sie,?\\s+dass\\s+ich)${NR}`,
    `${NL}(?:voulez-vous\\s+que\\s+je|souhaitez-vous\\s+que\\s+je|je\\s+peux\\s+(?!seulement|uniquement|pas)\\p{L}+|je\\s+pourrais)${NR}`,
    `${NL}(?:quiere\\s+que\\s+(?:le|les)|(?<!no\\s)puedo\\s+(?!solo|sólo|decir)\\p{L}+)${NR}`,
    `${NL}(?:(?<!не\\s)могу\\s+(?!только|сказать)\\p{L}+|если\\s+хотите,?\\s+я)${NR}`,
    `(?:(?<!لا\\s)(?:يمكنني|أستطيع)\\s+(?!أن\\s+أقول)|هل\\s+تريدون?\\s+أن)`,
  ].join("|"),
  "iu",
);

/** Son cevap misafirden bir CEVAP bekliyor mu: soru (işaretli ya da Türkçe soru ekiyle) ya da teklif. */
function invitesAnswer(body: string): boolean {
  const text = body.replace(/[‘’ʼ]/g, "'");
  return asksQuestion(text) || folds(text).some((f) => OFFER.test(f));
}

/**
 * "Mesajınız kaydedildi; ev sahibiniz görebilir" / "is visible to your host" — DEVİR cümlesi (istem bunu misafirin
 * dilinde yazdırır). Aynı cevapta "kaydedildi/görebilir" türü sözcük ile ev sahibi sözcüğü → karar ev sahibinde.
 */
const RECORDED_FOR_HOST: readonly (readonly [RegExp, RegExp])[] = [
  [/ev\s+sahib/u, /kaydedildi|not\s+edildi|görebilir|görecek|görüyor|elinde/u],
  [/(?:your|the)\s+host/u, /recorded|noted|logged|on\s+record|visible\s+to|(?:can|will)\s+see|has\s+your\s+(?:message|request)/u],
  [/gastgeber|vermieter/u, /gespeichert|notiert|vermerkt|erfasst|einsehen|sieht\s+ihre/u],
  [/h[ôo]te/u, /enregistr|not[ée]|consulter|verra|voit\s+votre/u],
  [/anfitri[óo]n/u, /registrad|anotad|puede\s+ver|ver[áa]\s+su|ve\s+su/u],
  [/хозя|владел/u, /зарегистр|записан|отмечен|видит|увидит|сможет\s+увидеть/u],
  [/المضيف|مضيف/u, /تسجيل|سجل|يرى|الاطلاع/u],
];

/**
 * Son cevap işi ev sahibine bıraktı mı (inceleme 09-25, P1): karar ertelemesi (`hasAvailabilityDeferral` — "…ev
 * sahibinizin kararıdır", "is the host's call", altı dil) ya da devir cümlesi. Konaklama DIŞI konuda da ("Evcil hayvan
 * kabulü ev sahibinizin kararıdır") — beyanın `…/defers` alanı yalnız konaklama konularını taşır.
 */
function handsOffToHost(body: string): boolean {
  if (hasAvailabilityDeferral(body)) return true;
  return folds(body).some((f) => RECORDED_FOR_HOST.some(([host, recorded]) => host.test(f) && recorded.test(f)));
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
  // Sözcüksel itirazlar (yalnız sıkılaştırır): soru (işaret ya da Türkçe soru eki), teşekkür/onay sinyali YOK, kelime
  // ağının bir niyeti var, saklı istek işareti (rakam / "ama" / "lütfen"), kapanış sözcüklerinin DIŞINDA ikiden fazla
  // sözcük (inceleme 09-25, P2: "Tamam, su akıtıyor tavandan" / "ok send me the door code" iki model yanılırsa gidiyordu).
  if (texts.some((t) => asksQuestion(t))) return false;
  if (!texts.every(hasAckSignal)) return false;
  if (texts.some((t) => classifyFallback(t).intent !== "general")) return false;
  if (texts.some((t) => folds(t).some((f) => HIDDEN_REQUEST.test(f)))) return false;
  if (texts.some((t) => residualWordCount(t) > SEMANTIC_CLOSING_MAX_RESIDUAL_WORDS)) return false;
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

/**
 * Sohbette misafire daha önce bir CEVAP gitti mi: bir misafir mesajından SONRA yazılmış yapay zekâ / ev sahibi mesajı.
 * 🚨 Misafir hiç yazmadan giden mesaj (hoş geldiniz / giriş talimatı otomasyonu) cevap DEĞİLDİR (inceleme 09-25, P1):
 * onun ardından gelen "İyi akşamlar" bir SELAMDIR, kapanış değil.
 */
export function hasPriorReply(messages: readonly ClosingThreadMessage[]): boolean {
  let guestWrote = false;
  for (const m of messages) {
    if (m.direction === "inbound") guestWrote = true;
    else if (guestWrote && replyAuthorOf(m) !== null) return true;
  }
  return false;
}

/** Son cevap (yapay zekâ ya da ev sahibi) ve yazarı; yoksa null. */
function lastReply(messages: readonly ClosingThreadMessage[]): { message: ClosingThreadMessage; author: "ai" | "host" } | null {
  let found: { message: ClosingThreadMessage; author: "ai" | "host" } | null = null;
  for (const m of messages) {
    const author = replyAuthorOf(m);
    if (author !== null) found = { message: m, author };
  }
  return found;
}

/**
 * Konuşma KAPANIŞA uygun bir noktada mı (her iki yolun ortak ön şartı): önceki bir cevap var VE yapay zekânın son
 * cevabı misafirden bir cevap BEKLEMİYOR (soru ya da teklif). "Yol tarifini de gönderebilirim" / "Yarınki girişinizi mi
 * kastediyorsunuz?" → "Olur" / "Evet" bir CEVAPTIR (inceleme 09-25, P1): kısayol atlanır, model cevaplar. Ev sahibinin
 * sorusuna/teklifine verilen onay ise kapanıştır (yapay zekâ yazmaz; konuşma görünür kalır — `closingMayHide`).
 */
export function closableAfter(messages: readonly ClosingThreadMessage[]): boolean {
  if (!hasPriorReply(messages)) return false;
  const last = lastReply(messages);
  return !(last && last.author === "ai" && invitesAnswer(last.message.body));
}

/** Yapay zekânın devir / bekletme cevabı (insan talebi, şikâyet bekletmesi): ardından gelen teşekkür açık işi kapatmaz. */
const HANDOFF_REPLY_INTENTS: ReadonlySet<string> = new Set(["human_request", "complaint"]);

/**
 * Kapanıştan sonra konuşma "cevap gerekmedi" diye ev sahibinin listesinden DÜŞEBİLİR mi — yalnız açık iş olmadığı
 * KESİNSE (inceleme 09-25, P1). Kapatır:
 *  · `openHostWork` — son ev sahibi mesajından sonra ev sahibine bırakılmış (tutulan / erteleyen) bir misafir mesajı var
 *    (karar kaydından, çağıranda);
 *  · son cevap yapay zekânın devir / bekletme cevabı (niyet etiketi ya da metindeki devir/erteleme cümlesi — QR bot
 *    mesajı niyet taşımaz);
 *  · son cevap — yapay zekânın YA DA ev sahibinin — bir SORU ya da TEKLİF taşıyor (soru işareti, Türkçe soru eki,
 *    "İsterseniz havlu gönderebilirim", "let me know", tutar/indirim) → "Olur" / "Perfect" bir KABULDÜR (ikinci inceleme
 *    09-25, P1: ev sahibinin soru işaretsiz teklifinin kabulü gizleniyordu).
 * Ev sahibinin düz cevabından ya da kendi sözünden ("Kontrol edip döneceğim") sonraki teşekkür gizlenebilir: o mesajla
 * konuşma zaten "cevaplandı" durumuna geçmişti (senkron her ev sahibi mesajını cevap sayar) — gizleme yalnız teşekkürden
 * ÖNCEKİ hâli geri getirir, bir işi kaybettirmez. Ev sahibinin TEKLİFİNİN kabulü ise yeni bilgidir → görünür.
 * `messages` kronolojik ve kapanış mesaj(lar)ını içerebilir (yalnız son CEVAP okunur).
 */
export function closingMayHide(input: { messages: readonly ClosingThreadMessage[]; openHostWork: boolean }): boolean {
  if (input.openHostWork) return false;
  const last = lastReply(input.messages);
  if (!last) return false;
  const body = last.message.body;
  if (last.author === "ai" && last.message.aiIntent && HANDOFF_REPLY_INTENTS.has(last.message.aiIntent)) return false;
  if (invitesAnswer(body)) return false;
  if (hasMoneyStatement(body)) return false;
  if (handsOffToHost(body)) return false;
  return true;
}
