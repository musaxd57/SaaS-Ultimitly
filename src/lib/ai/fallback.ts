import type { Priority } from "@/lib/constants";
import type { ClassifyResult, SuggestReplyInput, SuggestReplyResult } from "./types";

// Deterministic, keyword-based AI fallback. Used when no OPENAI_API_KEY is set,
// or when the OpenAI call fails. Keeps the product usable without external APIs.

type Intent =
  | "complaint"
  | "early_departure"
  | "human_request"
  | "early_checkin"
  | "late_checkout"
  | "checkin"
  | "checkout"
  | "wifi"
  | "parking"
  | "location"
  | "cleaning"
  | "refund"
  | "amenity"
  | "general";

// Bad-review / rating threats — THREAT-ANCHORED forms only: bare "kötü ..." already
// matches via "kötü" in the complaint list, and unanchored "1 star"/"negative
// review" false-positived on compliments ("4.91 star rating", "siz bir
// yıldızsınız", "we read a negative review before booking"). Named so the
// holding-ack eligibility check can exclude review-threats specifically.
const REVIEW_THREAT_PHRASES = [
  "yıldız veririm", "yildiz veririm", "yıldız vereceğim", "yildiz verecegim",
  "bir yıldız ver", "1 yıldız ver", "tek yıldız ver",
  "leave a bad review", "leave a negative review", "write a bad review",
  "give you a bad review", "leave you a bad review", "1 star review", "one star review",
  "leave 1 star", "give 1 star", "one-star review",
  // Turkish review threats (threat-anchored so pre-booking "yorumları okudum"
  // and praise "siz bir yıldızsınız" never match). Without these a TR review
  // threat only reads as a generic "complaint", mislabeling riskType and
  // (for opt-in orgs) failing to block the tier-2 holding-ack.
  "kötü yorum yaz", "kotu yorum yaz", "kötü yorum bırak", "kotu yorum birak",
  "kötü yorum yapacağım", "kotu yorum yapacagim", "kötü yorum yaparım", "kotu yorum yaparim",
  "olumsuz yorum yaz", "olumsuz yorum bırak", "olumsuz yorum yapacağım",
  "düşük puan ver", "dusuk puan ver", "düşük puan veririm", "dusuk puan veririm",
];

// OFF-PLATFORM payment asks — an Airbnb/Booking policy landmine for the host;
// the bot must never engage. Anchored phrases (not bare "cash"/"iban", which
// false-positive: e.g. "Liban"). Named so riskType can label them platform_policy.
const OFFPLATFORM_PAYMENT_PHRASES = [
  "platform dışı öde", "platform disi ode", "elden ödeme", "elden odeme", "elden nakit",
  "banka havalesi", "havale yapsam", "havale yapayım", "havale yapayim", "iban gönder", "iban gonder",
  "pay outside", "pay you directly", "pay in cash instead", "off the platform", "western union",
  // English money rails / P2P apps a guest might propose to skip the platform.
  "bank transfer", "wire transfer", "money transfer", "venmo", "paypal", "zelle", "revolut", "papara",
];

const KEYWORDS: Record<Exclude<Intent, "general">, string[]> = {
  complaint: [
    // NB: bare "problem"/"sorun" are NOT listed here — they appear in very common
    // positive closings ("no problem", "sorun yok"). They're matched separately,
    // negation-guarded, in hasUnnegatedProblemWord() below.
    "çalışmıyo", "calismiyo", "kirli", "bozuk", "şikayet", "sikayet",
    "kötü", "kotu", "berbat", "leak", "su akıyor", "koku", "böcek", "bocek", "broken",
    "dirty", "not working", "complaint", "rezalet", "iğrenç", "igrenc",
    // Strong, unambiguous English complaint signals (enriched — the cross-check
    // must catch these even when the model mislabels; over-escalation is safe).
    "terrible", "awful", "horrible", "unacceptable", "disgusting", "filthy",
    "cockroach", "cockroaches", "bed bug", "bedbug", "bed bugs", "no hot water", "no heating",
    // Re-opened / recurring issue signals ("klima hâlâ soğutmuyor", "temizlikçi
    // gelmedi") — a guest re-raising an unresolved problem must route to a human.
    "soğutmuyo", "sogutmuyo", "ısıtmıyo", "isitmiyo", "düzelmedi", "duzelmedi",
    "temizlikçi gelmedi", "temizlikci gelmedi", "temizlik yapılmadı", "temizlik yapilmadi",
    // Multilingual backstop (DE/FR/ES/IT/AR/RU). Distinctive complaint words only,
    // to avoid English false matches (e.g. "sale"). Catches a foreign-language
    // complaint even if the model mislabels it.
    "funktioniert nicht", "kaputt", "schmutzig", "dreckig", "beschwerde", "schimmel",
    "ne fonctionne pas", "cassé", "problème", "porter plainte", "fuite",
    "no funciona", "está roto", "está rota", "sucio", "queja", "non funziona", "rotto", "sporco",
    "لا يعمل", "معطل", "متسخ", "مشكلة", "شكوى",
    "не работает", "сломан", "грязно", "проблема", "жалоба",
    // Soft / implicit complaints + dissatisfaction (negation-anchored so positives
    // like "tam beklediğim gibi" / "çok temiz" never match). Over-escalation is the
    // safe side: at worst the host gets a flagged non-urgent message.
    "beklediğim gibi değil", "beklediğimiz gibi değil", "hayal kırıklığı", "memnun değil",
    "temiz değil", "hiç hoş değil", "olması gereken gibi değil",
    "not as expected", "not as described", "not clean", "disappointed", "not happy",
    "doesn't work", "does not work",
    // Enriched AR/RU/IT complaint vocabulary (distinctive, unambiguous terms only).
    "وسخ", "رائحة كريهة", "لا يوجد تدفئة", "لا يوجد تكييف", "مكسور", "صراصير", "حشرات",
    "مخيب للآمال", "تسرب",
    "грязный", "воняет", "нет отопления", "шумно", "тараканы", "насекомые", "ужасно",
    "разочарован", "течёт", "протекает",
    "sporca", "cattivo odore", "puzza", "non c'è riscaldamento", "rumoroso", "scarafaggi",
    "insetti", "terribile", "pessimo", "deluso", "delusa", "perdita d'acqua",
    // Bad-review / rating threats (REVIEW_THREAT_PHRASES below) — extortion-adjacent.
    ...REVIEW_THREAT_PHRASES,
  ],
  refund: [
    "iade", "geri ödeme", "geri odeme", "refund", "para iadesi", "ücret iade", "paramı geri",
    "rückerstattung", "geld zurück", "remboursement", "rembourser",
    "reembolso", "devolución", "devolver", "devuelv", "money back",
    "rimborso", "rimborsare", // Italian (was missing)
    "استرداد", "استرجاع", "возврат", "вернуть деньги",
    // Concession / partial-refund asks. Anchored — NOT bare "indirim"/"discount",
    // which would wrongly match pre-booking pricing ("indirimli sezon").
    "telafi", "tazminat", "indirim mümkün", "indirim yapabilir", "fiyattan düş", "ücretten düş",
    "compensate", "compensation", "give us a discount", "offer a discount",
    "إعادة المال", "restituire i soldi", "soldi indietro",
    // Escalation / chargeback threats — always route to a human, never auto-answer.
    "chargeback", "charge back", "dispute", "resolution center",
    // Damage / deposit / penalty disputes — financial/liability, always to a human.
    "hasar bedeli", "hasar ücret", "hasar ucret", "para cezası", "para cezasi",
    "depozito iade", "depozitomu", "security deposit", "deposit back", "damage charge", "charged for damage",
    // OFF-PLATFORM payment asks (OFFPLATFORM_PAYMENT_PHRASES below).
    ...OFFPLATFORM_PAYMENT_PHRASES,
  ],
  // Leaving the stay EARLY / shortening / cancelling — a revenue/refund-sensitive
  // signal that must always route to a human (also used as an auto-send veto).
  early_departure: [
    "erken ayrıl", "erken ayril", "erken çık", "erken cik", "ayrılmak zorunda", "ayrilmak zorunda",
    "ayrılmamız gerek", "ayrilmamiz gerek", "rezervasyonu kısalt", "rezervasyonu kisalt", "iptal et",
    // "iptal ed" covers the declarative softened forms the old net missed:
    // "iptal edeceğim", "iptal ediyorum", "iptal ederim" (t→d consonant softening).
    "iptal ed", "iptal edebilir", "iptal etmek", "konaklamayı kısalt", "leave early", "leave sooner", "check out early",
    // Noun-form cancellation phrasings the verb-only net missed (TR/EN).
    "iptali", "iptal taleb", "iptal işlem", "iptal islem",
    "checking out early", "cut short", "shorten my stay", "end our reservation", "end the reservation",
    "end our stay", "ahead of schedule", "sooner than planned", "head home early",
    "cancel my", "cancel the", "cancel our", "cancellation", "cancel this", "cancel it",
    "won't be staying", "wont be staying", "can't stay", "cant stay",
    // Multilingual cancel / leave-early signals (DE/FR/ES/IT/AR/RU).
    "stornieren", "früher abreisen", "annuler", "partir plus tôt", "cancelar", "salir antes",
    "annullare", "cancellare", "partire prima", "accorciare", "lasciare prima", // Italian (was missing)
    "إلغاء", "المغادرة مبكرا", "отменить", "уехать раньше",
    "إنهاء الحجز", "تقصير الإقامة", "съехать раньше", "сократить проживание",
    "andare via prima", "terminare la prenotazione",
  ],
  // Guest explicitly wants a real person / the host.
  human_request: [
    "gerçek kişi", "gercek kisi", "gerçek bir kişi", "gercek bir kisi", "bir insanla", "insanla konuş",
    "yetkiliyle", "temsilci",
    // Anchored to talk/reach verbs — a mere MENTION of the host ("ev sahibiyle dün
    // konuştuk, sorun çözüldü") must not read as a request to reach one.
    "ev sahibiyle konuş", "ev sahibiyle görüş", "ev sahibi ile konuş", "ev sahibi ile görüş",
    "ev sahibine ulaş", "ev sahibiyle iletişim", "real person", "real human",
    "speak to a human", "talk to a human", "speak to someone", "talk to someone", "speak to the host",
    "talk to the host",
  ],
  early_checkin: ["erken giriş", "erken giris", "early check", "erken check", "early arrival"],
  late_checkout: ["geç çıkış", "gec cikis", "late check", "geç check", "gec check", "late departure"],
  checkin: ["giriş", "giris", "check-in", "check in", "checkin", "anahtar", "key", "nasıl gir", "nasil gir", "kapı kodu", "kapi kodu", "access"],
  checkout: ["çıkış", "cikis", "check-out", "check out", "checkout", "ne zaman çık", "ne zaman cik"],
  wifi: ["wifi", "wi-fi", "internet", "şifre", "sifre", "password", "wireless"],
  parking: ["otopark", "park yeri", "araç", "arac", "parking", "araba", "garaj"],
  location: ["adres", "konum", "nerede", "address", "location", "yol tarifi", "directions", "nasıl gelir", "nasil gelir"],
  cleaning: ["temizlik", "havlu", "çarşaf", "carsaf", "cleaning", "towel", "bed sheet", "ek temizlik"],
  amenity: ["klima", "air conditioning", "buzdolabı", "fridge", "çamaşır makinesi", "washing machine", "tv", "televizyon", "fırın", "oven", "mikrodalga", "microwave", "elektrikli", "ekipman", "eşya"],
};

// "problem"/"sorun" are strong complaint words that also appear in extremely
// common POSITIVE closings ("no problem", "sorun yok", "sorunsuz", "hiç sorun
// yaşamadık"). Match them only when NOT inside such a negated/positive phrase, so
// a polite guest isn't flagged as an urgent complaint (which e-mails the host and
// diverts the thread to the "problem" queue, blocking it from automation).
const PROBLEM_NEGATIONS = [
  "no problem", "no problems", "not a problem", "without problem", "without any problem",
  "sorun yok", "sorun yoktu", "sorunsuz", "hiç sorun", "hic sorun", "hiçbir sorun", "hicbir sorun",
  "sorun olmadı", "sorun olmadi", "sorun yaşama", "sorun yasama", "sorun değil", "sorun degil",
  // Permission questions about the FUTURE are asks, not complaints:
  // "arkadaşım uğrayacak, sorun olur mu?" must never flag the thread.
  "sorun olur mu", "sorun olmaz", "sorun olmasın", "sorun teşkil eder mi",
  "problem olur mu", "problem olmaz", "a problem if", "any problem if",
  "is that a problem", "would that be a problem", "is it a problem",
  "problem yok", "problemsiz",
  "kein problem", "keine probleme", "pas de problème", "pas de probleme", "sans problème", "sans probleme",
  "ningún problema", "ningun problema", "sin problema", "nessun problema", "senza problemi",
  "нет проблем", "без проблем", "بدون مشكلة", "لا مشكلة",
];

/** True when a bare "problem"/"sorun" survives after stripping negated phrases. */
function hasUnnegatedProblemWord(m: string): boolean {
  if (!m.includes("problem") && !m.includes("sorun")) return false;
  let stripped = m;
  for (const neg of PROBLEM_NEGATIONS) stripped = stripped.split(neg).join(" ");
  return stripped.includes("problem") || stripped.includes("sorun");
}

function detectIntent(message: string): Intent {
  const m = message.toLowerCase();
  // Order matters: complaint / refund / early-departure (sensitive) take precedence,
  // then an explicit human request, then the operational intents.
  const order: Exclude<Intent, "general">[] = [
    "complaint", "refund", "early_departure", "human_request", "early_checkin", "late_checkout",
    "checkin", "checkout", "wifi", "parking", "location", "cleaning", "amenity",
  ];
  for (const intent of order) {
    if (KEYWORDS[intent].some((kw) => m.includes(kw))) return intent;
    // "problem"/"sorun" live outside the keyword list — negation-guarded here.
    if (intent === "complaint" && hasUnnegatedProblemWord(m)) return "complaint";
  }
  return "general";
}

export function classifyFallback(message: string): ClassifyResult {
  const intent = detectIntent(message);
  const isComplaint = intent === "complaint";
  let priority: Priority = "standard";
  if (isComplaint) priority = "urgent";
  else if (intent === "general") priority = "low";
  return {
    intent,
    priority,
    isComplaint,
    confidence: intent === "general" ? 0.3 : isComplaint ? 0.7 : 0.55,
  };
}

// ---------------------------------------------------------------------------
// Closing/acknowledgement detector. After a reply (human or AI), guests very
// often send a bare "tamam / teşekkürler / ok / thanks 👍" that needs NO answer.
// The auto-reply pass uses this to (a) skip a pointless model call and (b) stay
// out of a thread a human just closed. DELIBERATELY conservative: any question
// mark, any non-closing word, or anything longer than a short line fails the
// check and proceeds to the model — a real question can never be swallowed.
// ---------------------------------------------------------------------------
const CLOSING_TOKENS = new Set([
  // Turkish
  "tamam", "tamamdır", "tamamdir", "teşekkür", "tesekkur", "teşekkürler", "tesekkurler",
  "ederim", "ederiz", "çok", "cok", "sağol", "sagol", "sağolun", "sagolun", "sağ", "sag",
  "ol", "olun", "peki", "anlaştık", "anlastik", "olur", "süper", "harika", "mükemmel",
  "mukemmel", "eyvallah", "görüşürüz", "gorusuruz", "iyi", "günler", "gunler", "geceler",
  "akşamlar", "aksamlar", "rica",
  // English
  "ok", "okay", "okey", "thanks", "thank", "thx", "you", "so", "much", "many", "great",
  "perfect", "awesome", "alright", "all", "right", "cool", "got", "it", "sounds", "good",
  "fine", "noted", "cheers", "bye", "goodbye", "super",
  // DE / FR / ES / IT
  "danke", "dankeschön", "dankeschon", "schön", "schon", "vielen", "dank", "alles", "klar", "perfekt", "gut",
  "merci", "beaucoup", "parfait", "gracias", "vale", "perfecto", "genial",
  "grazie", "mille", "perfetto", "va", "bene",
  // RU / AR
  "спасибо", "хорошо", "ладно", "отлично", "понятно", "شكرا", "تمام", "حسنا", "ممتاز",
]);

// ---------------------------------------------------------------------------
// PURE POSITIVE FEEDBACK detector ("Çok teşekkürler, her şey harikaydı!").
// The praise sibling of isClosingAck: lets the courtesy path answer a pure
// compliment deterministically instead of the model improvising an emotional
// draft. DENY-LIST based (holdingAckBlockedSignals emsali) and DELIBERATELY
// over-blocking — any question mark, digit, contrast word ("ama/but"), ANY
// intent keyword (refund/checkout/wifi/…), injection, review-threat,
// off-platform-payment or safety signal sends the message down the NORMAL
// model + safety-gate flow, exactly as today. A false negative costs nothing;
// a false positive could mark a hidden request "answered" — so we never guess.
// ---------------------------------------------------------------------------
const PRAISE_PHRASES = [
  // Turkish
  "harika", "harikaydı", "harikaydi", "mükemmel", "mukemmel", "süper", "super",
  "çok güzel", "cok guzel", "çok iyi", "cok iyi", "çok rahat", "cok rahat",
  "bayıldık", "bayildik", "bayıldım", "bayildim", "memnun kal", "çok memnun", "cok memnun",
  "tertemiz", "pırıl pırıl", "piril piril", "muhteşem", "muhtesem", "şahane", "sahane",
  "efsane", "keyif aldık", "keyif aldik", "çok beğendik", "cok begendik",
  // English
  "amazing", "wonderful", "fantastic", "great stay", "was great", "everything was great",
  "loved", "lovely", "excellent", "awesome", "beautiful", "spotless", "very clean",
  "so clean", "had a great time", "enjoyed", "highly recommend",
];
const PRAISE_CONTRAST = /(^|\s)(ama|fakat|ancak|keşke|keske|lakin|yalnız|yalniz|but|however|except|although|though|unfortunately)(\s|,|\.|$)/;

/** True only for a SHORT, pure compliment with zero request/risk signals. */
export function isPositiveFeedback(message: string): boolean {
  const raw = message.trim();
  if (!raw || raw.length > 200) return false; // essays → model
  const m = raw.toLowerCase();
  if (m.includes("?") || m.includes("？")) return false; // a question is never pure praise
  if (/\d/.test(m)) return false; // times/dates/amounts = a request hiding in praise
  if (!PRAISE_PHRASES.some((p) => m.includes(p))) return false;
  if (PRAISE_CONTRAST.test(m)) return false; // "harikaydı AMA…" smuggles a complaint
  if (detectPromptInjection(raw)) return false;
  if (hasUnnegatedProblemWord(m)) return false;
  if (REVIEW_THREAT_PHRASES.some((p) => m.includes(p))) return false;
  if (OFFPLATFORM_PAYMENT_PHRASES.some((p) => m.includes(p))) return false;
  if (SAFETY_CRITICAL_WORDS.some((w) => m.includes(w))) return false;
  // ANY operational intent keyword (refund/cancel/checkout/wifi/parking/…)
  // disqualifies — praise wrapped around a request must reach the model+gate.
  const intents = Object.keys(KEYWORDS) as Exclude<Intent, "general">[];
  if (intents.some((i) => matchesIntentKeywords(raw, i))) return false;
  return true;
}

/** True only for a short, pure closing/ack ("Tamam, teşekkürler!", "ok thanks", "👍"). */
export function isClosingAck(message: string): boolean {
  const raw = message.trim().toLowerCase();
  if (!raw || raw.length > 60) return false;
  if (raw.includes("?") || raw.includes("？")) return false; // a question is never a closing
  // Strip punctuation/emoji; what remains must be ONLY closing words.
  const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return true; // pure emoji/punctuation ("👍", "🙏")
  const tokens = cleaned.split(" ");
  if (tokens.length > 6) return false;
  return tokens.every((t) => CLOSING_TOKENS.has(t));
}

function findKb(input: SuggestReplyInput, category: string): string | null {
  const item = input.knowledgeBase.find((k) => k.category === category);
  return item ? item.content : null;
}

// ---------------------------------------------------------------------------
// Deterministic prompt-injection detector — a CODE-side backstop so the
// auto-send gate never has to trust the model's own injection detection.
// Conservative, high-precision patterns only (classic jailbreak phrasings and
// our own << >> delimiters); a false positive merely means a human reviews the
// message, so over-matching is the safe side — but ordinary guest smalltalk
// must never hit these.
// ---------------------------------------------------------------------------
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the |your )*(previous|prior|above|earlier|your) (instructions|prompts?|rules)/i,
  /disregard (all |the |your )*(previous|prior|above|earlier|your) (instructions|prompts?|rules)/i,
  /forget (all |the |your )*(previous|prior|above|earlier|your) (instructions|prompts?|rules)/i,
  /system prompt/i,
  /developer mode/i,
  /\bjailbreak\b/i,
  /you are now (a|an) (different|new )?(ai|bot|assistant|system|admin|persona|character)/i,
  /pretend (to be|you are|you're)/i,
  /act as (if you|a system|an admin|the admin|the host system)/i,
  /reveal (your|the) (instructions|prompt|rules)/i,
  /<<[A-Z_]{2,}>>/, // our own data-fence delimiters injected into a message
  /önceki (tüm )?talimatları (unut|yok say|görmezden gel|geçersiz kıl)/i,
  /talimatları (unut|yok say|görmezden gel)/i,
  /sistem (promptu|talimatı)/i, // NOT "sistem mesajı" — "Airbnb'den sistem mesajı geldi" is a normal guest sentence
  /artık .{0,30}(rolündesin|olarak davran)/i,
  /yeni rolün/i,
];

/** True when a guest message contains classic prompt-injection phrasing. */
export function detectPromptInjection(message: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(message));
}

/**
 * Detect the guest's language (basic heuristic). Default is ENGLISH — Turkish
 * only when clear Turkish markers are present — matching the product policy
 * (English by default, mirror the guest when they use another language).
 */
export function detectGuestLanguage(message: string): string {
  const msgLower = message.toLowerCase();
  if (/[çğıöşü]/.test(msgLower) || /\b(merhaba|teşekkür|nasıl|nerede|şifre|için|değil|var mı|selam|günaydın)\b/.test(msgLower)) {
    return "tr";
  }
  if (/\b(ich |sie |bitte|danke|hallo|ist |und |für )\b/.test(msgLower)) return "de";
  if (/\b(je |vous |bonjour|merci|est |les |pour )\b/.test(msgLower)) return "fr";
  if (/[؀-ۿ]/.test(message)) return "ar"; // Arabic script
  if (/[Ѐ-ӿ]/.test(message)) return "ru"; // Cyrillic script
  return "en";
}

/** Order-independent check: does the message hit ANY keyword of this intent net?
 * (detectIntent's precedence hides co-present signals — complaint wins over
 * refund — so eligibility checks need direct access.) */
export function matchesIntentKeywords(message: string, intent: Exclude<Intent, "general">): boolean {
  const m = message.toLowerCase();
  return KEYWORDS[intent].some((kw) => m.includes(kw));
}

// Safety-critical signals: a generic holding acknowledgement must never replace
// the model's safety-aware draft (gas/fire/injury/lockout class) — these always
// stay on the silent-escalate path. Substring over-matching here is fine: it
// only means "no holding ack", never a wrong message.
const SAFETY_CRITICAL_WORDS = [
  "gaz", "yangın", "yangin", "duman", "yaraland", "düştü", "dustu", "kaza", "ambulans",
  "polis", "acil", "kilitli kaldı", "kilitli kaldi", "içeri giremiyor", "iceri giremiyor",
  "fire", "smoke", "gas leak", "carbon monoxide", "injured", "hurt", "bleeding",
  "ambulance", "police", "emergency", "locked out", "can't get in", "cant get in",
  // English / other-language safety vocab (TR is well-covered above; EN was thin,
  // e.g. "I smell gas" only matched "gas leak"). Bare "gas", a sparking outlet, a
  // burning smell, flooding. Over-matching is the safe side (never a wrong send).
  "gas", "smell of gas", "smells like gas", "sparks", "sparking", "burning smell",
  "smells burning", "flooding", "water pouring", "pouring through", "electric shock", "monoxide",
];

// RULE VIOLATION (pet in a no-pet listing, party/event, over-capacity guests,
// smoking inside) — the host, not the bot, decides these (deposit / allergy /
// liability / neighbour issues). Over-flagging to a human is the safe side.
const RULE_VIOLATION_PHRASES = [
  "evcil hayvan", "köpeğ", "kopeg", "köpek getir", "kopek getir", "kedimi getir", "köpeğimi", "kopegimi",
  "my dog", "my cat", "bring a dog", "bring my dog", "bring our dog", "bring a pet", "pet friendly",
  "parti", "party", "etkinlik düzenle", "kutlama yap", "eğlence düzenle", "house party", "have a party",
  "fazladan kişi", "fazladan kisi", "ekstra kişi", "ekstra kisi", "fazladan misafir", "ekstra misafir",
  "kaç kişi kalabilir", "kac kisi kalabilir", "kişi daha gel", "kisi daha gel", "kişi geleceğiz", "kisi gelecegiz",
  "kişi geliyoruz", "kisi geliyoruz", "arkadaşlarım da kal", "arkadaslarim da kal", "arkadaşım da kal",
  "extra guest", "more guests", "additional guest", "how many people can stay", "friends stay over", "friends staying over",
  "içeride sigara", "iceride sigara", "sigara içebilir", "smoke inside", "smoking inside",
];

// DISCRIMINATION — a demand to EXCLUDE/prefer people by nationality / ethnicity /
// religion (e.g. a specific cleaner). Anchored to EXCLUSION phrasing so a guest
// merely stating their OWN background ("biz Suriyeliyiz") is NOT flagged.
const DISCRIMINATION_PHRASES = [
  "suriyeli olmasın", "suriyeli istemiyor", "suriyeli göndermeyin", "suriyeli gondermeyin", "suriyeli yollama",
  "arap olmasın", "arap istemiyor", "kürt olmasın", "kurt olmasin", "türk olsun", "turk olsun", "türk olmayan",
  "müslüman olmasın", "musluman olmasin", "hristiyan olmasın", "yabancı olmasın", "yabanci olmasin", "yerli olsun",
  "no syrians", "no arabs", "not syrian", "not arab", "no foreigners", "must be turkish", "only turkish", "no muslims",
  // Race-based exclusion (parallel to the above; still EXCLUSION-anchored).
  "no black", "no blacks", "no africans", "siyahi olmasın", "siyahi istemiyor", "zenci olmasın", "zenci istemiyor",
];

/**
 * Deterministic riskType label from the keyword nets (Faz-B). Order = severity
 * precedence. A LABEL for UI/reports only — the auto-send gate has its own
 * vetoes and may additionally tighten on it.
 */
export function detectRiskType(message: string): string | null {
  if (detectPromptInjection(message)) return "prompt_injection";
  const m = message.toLowerCase();
  if (SAFETY_CRITICAL_WORDS.some((w) => m.includes(w))) return "safety_emergency";
  if (REVIEW_THREAT_PHRASES.some((p) => m.includes(p))) return "review_threat";
  if (OFFPLATFORM_PAYMENT_PHRASES.some((p) => m.includes(p))) return "platform_policy";
  if (matchesIntentKeywords(message, "refund")) return "money_refund";
  if (matchesIntentKeywords(message, "early_departure")) return "cancellation";
  if (matchesIntentKeywords(message, "human_request")) return "human_request";
  // discrimination + rule_violation had NO deterministic detector — the gate
  // relied solely on the model's self-reported label, so a model miss on a
  // pet/party/over-capacity/discriminatory-exclusion message auto-sent an
  // unauthorized approval. These are host-only decisions (see prompts.ts §4).
  if (DISCRIMINATION_PHRASES.some((p) => m.includes(p))) return "discrimination";
  if (RULE_VIOLATION_PHRASES.some((p) => m.includes(p))) return "rule_violation";
  if (classifyFallback(message).isComplaint) return "complaint";
  return null;
}

/**
 * May a MILD complaint get the automatic tier-2 "holding acknowledgement"?
 * Deliberately conservative: complaint-class only, and NONE of the signals that
 * demand a human's judgement (money, cancellation, wanting a human, review
 * threats, safety emergencies, injection). Anything excluded here still follows
 * the normal escalate-to-host path — this gate only ever WITHHOLDS the ack.
 */
export function holdingAckBlockedSignals(message: string): boolean {
  if (detectPromptInjection(message)) return true;
  if (matchesIntentKeywords(message, "refund")) return true;
  if (matchesIntentKeywords(message, "early_departure")) return true;
  if (matchesIntentKeywords(message, "human_request")) return true;
  const m = message.toLowerCase();
  if (REVIEW_THREAT_PHRASES.some((p) => m.includes(p))) return true;
  if (SAFETY_CRITICAL_WORDS.some((w) => m.includes(w))) return true;
  return false;
}

export function holdingAckEligible(message: string): boolean {
  if (!classifyFallback(message).isComplaint) return false;
  return !holdingAckBlockedSignals(message);
}

export function suggestReplyFallback(input: SuggestReplyInput): SuggestReplyResult {
  const { intent, priority, confidence } = classifyFallback(input.guestMessage);
  const name = input.reservation?.guestName?.split(" ")[0];
  const p = input.property;

  // SECRET GATE — mirrors the model prompt's pre-booking guard so the
  // deterministic path is at the SAME policy level: access details (Wi-Fi,
  // entry instructions, full address/directions) are only surfaced for a
  // CONFIRMED/completed stay. No reservation / pending / cancelled → the
  // writer may be a prospective guest → use the deferral line even when the
  // KB has the answer. verifiedActiveStay (QR) counts as verified, but that
  // surface's KB is already secret-scrubbed upstream anyway.
  const stayVerified =
    input.verifiedActiveStay === true ||
    (input.reservation != null &&
      (input.reservation.status === "confirmed" || input.reservation.status === "completed"));

  const detectedLanguage = detectGuestLanguage(input.guestMessage);
  // We only carry full Turkish + English phrasings; any non-Turkish guest gets
  // the (internationally understood) English fallback.
  const isTr = detectedLanguage === "tr";

  const greeting = isTr
    ? name ? `Merhaba ${name},` : "Merhaba,"
    : name ? `Hi ${name},` : "Hi,";
  const closing = input.tone === "short" ? "" : isTr ? "\n\nİyi günler dileriz." : "\n\nKind regards,";

  let body: string;
  let risk: string | null = null;
  const usedSources: string[] = [];
  const missingInfo: string[] = [];

  switch (intent) {
    case "complaint":
      body = isTr
        ? "Bunun için özür dileriz. Durumu hemen ekibimize ilettim; en kısa sürede ilgileneceğiz."
        : "Apologies for the issue you've experienced. I've notified our team right away and will get back to you as soon as possible.";
      risk = "Şikayet/olası sorun algılandı. Yöneticiye iletilmeli; otomatik karar verilmedi.";
      break;
    case "refund":
      body = isTr
        ? "Talebinizi aldım. İade ve ücret konularını yöneticimiz değerlendirecek ve en kısa sürede size dönüş yapacak."
        : "I've received your request. Refunds and charges are reviewed by our manager, who will get back to you as soon as possible.";
      risk = "İade/ücret talebi. Finansal karar gerektirir, yönetici onayı şart.";
      break;
    case "early_departure":
      body = isTr
        ? "Bilgilendirdiğiniz için teşekkürler. Erken ayrılış / rezervasyon değişikliği talebinizi hemen ekibimize ilettim; platform üzerinden gerekli adımları kontrol edip en kısa sürede size döneceğim."
        : "Thank you for letting us know. I've passed your early-departure / booking-change request to our team right away; I'll review the necessary steps through the platform and get back to you as soon as possible.";
      risk = "Erken ayrılma / iptal sinyali. Gelir ve iade süreci, operatör kararı gerektirir.";
      break;
    case "human_request":
      body = isTr
        ? "Tabii ki. Talebinizi ev sahibimize ilettim; en kısa sürede kendisi sizinle iletişime geçecektir."
        : "Of course. I've passed your request to our host, who will get in touch with you as soon as possible.";
      break;
    case "early_checkin":
      usedSources.push("property:checkInTime");
      body = isTr
        ? `Check-in saatimiz ${p.checkInTime}. Erken giriş, o günkü müsaitliğe bağlı olarak mümkün olabilir. Müsaitliği kontrol edip size en kısa sürede bilgi vereceğim.`
        : `Our check-in time is ${p.checkInTime}. An early check-in may be possible depending on availability that day. I'll check and let you know as soon as I can.`;
      break;
    case "late_checkout":
      usedSources.push("property:checkOutTime");
      body = isTr
        ? `Check-out saatimiz ${p.checkOutTime}. Geç çıkış, sonraki rezervasyon ve temizlik programına bağlı olarak mümkün olabilir. Kontrol edip size döneceğim.`
        : `Our check-out time is ${p.checkOutTime}. A late check-out may be possible depending on the cleaning schedule and the next booking. I'll check and get back to you.`;
      break;
    case "checkin": {
      const kb = stayVerified ? findKb(input, "checkin") : null;
      usedSources.push("property:checkInTime");
      if (kb) usedSources.push("kb:checkin");
      body = isTr
        ? kb
          ? `Giriş bilgileri: ${kb}\n\nCheck-in saatimiz ${p.checkInTime}.`
          : `Check-in saatimiz ${p.checkInTime}. Giriş talimatlarını girişten önce sizinle paylaşacağım.`
        : kb
          ? `Check-in details: ${kb}\n\nOur check-in time is ${p.checkInTime}.`
          : `Our check-in time is ${p.checkInTime}. I'll share the entry instructions with you before arrival.`;
      break;
    }
    case "checkout":
      usedSources.push("property:checkOutTime");
      body = isTr
        ? `Check-out saatimiz ${p.checkOutTime}. Çıkışta anahtarları/kartı belirtilen yere bırakmanız yeterli olacaktır.`
        : `Our check-out time is ${p.checkOutTime}. On your way out, simply leave the keys/card in the agreed place.`;
      break;
    case "wifi": {
      const kb = stayVerified ? findKb(input, "wifi") : null;
      if (kb) usedSources.push("kb:wifi");
      else missingInfo.push(isTr ? "Wi-Fi bilgisi" : "Wi-Fi details");
      body = isTr
        ? kb ? `Wi-Fi bilgileri: ${kb}` : "Wi-Fi bilgilerini kontrol edip en kısa sürede sizinle paylaşacağım."
        : kb ? `Wi-Fi details: ${kb}` : "I'll check the Wi-Fi details and share them with you shortly.";
      break;
    }
    case "parking": {
      const kb = findKb(input, "parking");
      if (kb) usedSources.push("kb:parking");
      else missingInfo.push(isTr ? "otopark bilgisi" : "parking info");
      body = isTr
        ? kb ? `Otopark bilgisi: ${kb}` : "Otopark durumunu kontrol edip size bilgi vereceğim."
        : kb ? `Parking info: ${kb}` : "I'll check the parking options and let you know.";
      break;
    }
    case "location": {
      const kb = stayVerified ? findKb(input, "location") : null;
      if (kb) usedSources.push("kb:location");
      const addr = stayVerified && p.address ? `${p.address}${p.city ? ", " + p.city : ""}` : null;
      if (!kb && addr) usedSources.push("property:address");
      body = isTr
        ? kb
          ? `Konum bilgisi: ${kb}`
          : addr
            ? `Adresimiz: ${addr}. Detaylı yol tarifini girişten önce paylaşacağım.`
            : "Konum ve yol tarifi bilgisini en kısa sürede sizinle paylaşacağım."
        : kb
          ? `Location info: ${kb}`
          : addr
            ? `Our address is: ${addr}. I'll share detailed directions before arrival.`
            : "I'll share the location and directions with you shortly.";
      break;
    }
    case "cleaning": {
      const kb = findKb(input, "cleaning");
      if (kb) usedSources.push("kb:cleaning");
      body = isTr
        ? kb ? `Temizlik bilgisi: ${kb}` : "Temizlik talebinizi aldım; ekibimizle planlayıp size döneceğim."
        : kb ? `Cleaning info: ${kb}` : "I've received your cleaning request; I'll arrange it with our team and get back to you.";
      break;
    }
    case "amenity": {
      const kb = findKb(input, "general");
      if (kb) usedSources.push("kb:general");
      body = isTr
        ? kb ? `Ekipman bilgisi: ${kb}` : "Ekipman veya eşya ile ilgili sorunuzu ekibimize ilettim; en kısa sürede size döneceğim."
        : kb ? `Amenity info: ${kb}` : "I've passed your question about the equipment to our team and will get back to you shortly.";
      break;
    }
    default:
      body = isTr
        ? "Mesajınız için teşekkürler. Talebinizi aldım; en kısa sürede size döneceğim."
        : "Thanks for your message. I've received your request and will get back to you as soon as possible.";
  }

  // Derive riskLevel and actionSuggestion from intent. actionSuggestion is shown
  // to the (Turkish-speaking) operator, so it stays in Turkish.
  let riskLevel: "none" | "low" | "medium" | "high" = "none";
  let actionSuggestion: string | null = null;

  if (intent === "complaint") {
    riskLevel = "medium";
    actionSuggestion = "Şikayeti değerlendirin ve misafirle iletişime geçin. Gerekirse ekibi mülke gönderin.";
  } else if (intent === "refund") {
    riskLevel = "medium";
    actionSuggestion = "Mali durumu inceleyin ve 24 saat içinde misafire dönüş yapın.";
  } else if (intent === "early_departure") {
    riskLevel = "medium";
    actionSuggestion = "Platform iade/değişiklik politikasını kontrol et, takvimi güncelle, misafire dönüş yap.";
  } else if (intent === "human_request") {
    riskLevel = "low";
    actionSuggestion = "Misafir bizzat ev sahibiyle görüşmek istiyor — ev sahibine iletin, kişisel dönüş yapsın.";
  } else if (intent === "early_checkin") {
    riskLevel = "low";
    actionSuggestion = "Takvimi kontrol edin; müsaitse erken giriş onaylayın.";
  } else if (intent === "late_checkout") {
    riskLevel = "low";
    actionSuggestion = "Temizlik programını ve sonraki rezervasyonu kontrol ederek geç çıkış onaylayın.";
  }

  return {
    intent,
    confidence,
    reply: `${greeting}\n\n${body}${closing}`.trim(),
    risk,
    priority,
    source: "fallback",
    riskType: detectRiskType(input.guestMessage),
    usedSources,
    missingInfo,
    actionSuggestion,
    riskLevel,
    detectedLanguage,
    statedCheckoutTime: null,
  };
}
