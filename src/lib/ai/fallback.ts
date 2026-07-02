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

const KEYWORDS: Record<Exclude<Intent, "general">, string[]> = {
  complaint: [
    // NB: bare "problem"/"sorun" are NOT listed here — they appear in very common
    // positive closings ("no problem", "sorun yok"). They're matched separately,
    // negation-guarded, in hasUnnegatedProblemWord() below.
    "çalışmıyor", "calismiyor", "kirli", "bozuk", "şikayet", "sikayet",
    "kötü", "kotu", "berbat", "leak", "su akıyor", "koku", "böcek", "bocek", "broken",
    "dirty", "not working", "complaint", "rezalet", "iğrenç", "igrenc",
    // Strong, unambiguous English complaint signals (enriched — the cross-check
    // must catch these even when the model mislabels; over-escalation is safe).
    "terrible", "awful", "horrible", "unacceptable", "disgusting", "filthy",
    "cockroach", "cockroaches", "bed bug", "bedbug", "bed bugs", "no hot water", "no heating",
    // Re-opened / recurring issue signals ("klima hâlâ soğutmuyor", "temizlikçi
    // gelmedi") — a guest re-raising an unresolved problem must route to a human.
    "soğutmuyor", "sogutmuyor", "ısıtmıyor", "isitmiyor", "düzelmedi", "duzelmedi",
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
  ],
  refund: [
    "iade", "geri ödeme", "geri odeme", "refund", "para iadesi", "ücret iade", "paramı geri",
    "rückerstattung", "geld zurück", "remboursement", "rembourser",
    "reembolso", "devolución", "devolver", "devuelv", "money back",
    "rimborso", "rimborsare", // Italian (was missing)
    "استرداد", "استرجاع", "возврат", "вернуть деньги",
    // Concession / partial-refund asks. Anchored — NOT bare "indirim"/"discount",
    // which would wrongly match pre-booking pricing ("indirimli sezon").
    "telafi", "indirim mümkün", "indirim yapabilir", "fiyattan düş", "ücretten düş",
    "compensate", "compensation", "give us a discount", "offer a discount",
    "إعادة المال", "restituire i soldi", "soldi indietro",
    // Escalation / chargeback threats — always route to a human, never auto-answer.
    "chargeback", "charge back", "dispute", "resolution center",
  ],
  // Leaving the stay EARLY / shortening / cancelling — a revenue/refund-sensitive
  // signal that must always route to a human (also used as an auto-send veto).
  early_departure: [
    "erken ayrıl", "erken ayril", "erken çık", "erken cik", "ayrılmak zorunda", "ayrilmak zorunda",
    "ayrılmamız gerek", "ayrilmamiz gerek", "rezervasyonu kısalt", "rezervasyonu kisalt", "iptal et",
    "iptal edebilir", "iptal etmek", "konaklamayı kısalt", "leave early", "leave sooner", "check out early",
    "checking out early", "cut short", "shorten my stay", "end our reservation", "end the reservation",
    "end our stay", "ahead of schedule", "sooner than planned", "head home early",
    "cancel my", "cancel the", "cancel our", "won't be staying", "wont be staying", "can't stay", "cant stay",
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
    "yetkiliyle", "temsilci", "ev sahibiyle", "ev sahibi ile", "real person", "real human",
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

export function suggestReplyFallback(input: SuggestReplyInput): SuggestReplyResult {
  const { intent, priority, confidence } = classifyFallback(input.guestMessage);
  const name = input.reservation?.guestName?.split(" ")[0];
  const p = input.property;

  // Detect the guest's language (basic heuristic). Default is ENGLISH — Turkish
  // only when clear Turkish markers are present — matching the product policy
  // (English by default, mirror the guest when they use another language).
  const msgLower = input.guestMessage.toLowerCase();
  let detectedLanguage = "en";
  if (/[çğıöşü]/.test(msgLower) || /\b(merhaba|teşekkür|nasıl|nerede|şifre|için|değil|var mı|selam|günaydın)\b/.test(msgLower)) {
    detectedLanguage = "tr";
  } else if (/\b(ich |sie |bitte|danke|hallo|ist |und |für )\b/.test(msgLower)) {
    detectedLanguage = "de";
  } else if (/\b(je |vous |bonjour|merci|est |les |pour )\b/.test(msgLower)) {
    detectedLanguage = "fr";
  } else if (/[؀-ۿ]/.test(input.guestMessage)) {
    detectedLanguage = "ar"; // Arabic script
  } else if (/[Ѐ-ӿ]/.test(input.guestMessage)) {
    detectedLanguage = "ru"; // Cyrillic script
  }
  // We only carry full Turkish + English phrasings; any non-Turkish guest gets
  // the (internationally understood) English fallback.
  const isTr = detectedLanguage === "tr";

  const greeting = isTr
    ? name ? `Merhaba ${name},` : "Merhaba,"
    : name ? `Hi ${name},` : "Hi,";
  const closing = input.tone === "short" ? "" : isTr ? "\n\nİyi günler dileriz." : "\n\nKind regards,";

  let body: string;
  let risk: string | null = null;

  switch (intent) {
    case "complaint":
      body = isTr
        ? "Yaşadığınız sorun için çok üzgünüz. Durumu hemen ekibimize iletiyoruz ve en kısa sürede sizinle ilgileneceğiz. Bu arada size yardımcı olabileceğimiz acil bir şey varsa lütfen belirtin."
        : "We're very sorry about the issue you've experienced. We've notified our team right away and will take care of it as soon as possible. In the meantime, please let us know if there's anything urgent we can help with.";
      risk = "Şikayet/olası sorun algılandı. Yöneticiye iletilmeli; otomatik karar verilmedi.";
      break;
    case "refund":
      body = isTr
        ? "Talebinizi aldık. İade ve ücret konuları yöneticimiz tarafından değerlendirilecektir; en kısa sürede size dönüş yapacağız."
        : "We've received your request. Refunds and charges are reviewed by our manager, and we'll get back to you as soon as possible.";
      risk = "İade/ücret talebi. Finansal karar gerektirir, yönetici onayı şart.";
      break;
    case "early_departure":
      body = isTr
        ? "Bunu duyduğuma üzüldüm. Erken ayrılış / rezervasyon değişikliği talebinizi hemen ekibimize ilettim; platform üzerinden gerekli adımları kontrol edip en kısa sürede size dönüş yapacağız."
        : "I'm sorry to hear that. I've passed your early-departure / booking-change request to our team right away; we'll review the necessary steps through the platform and get back to you as soon as possible.";
      risk = "Erken ayrılma / iptal sinyali. Gelir ve iade süreci, operatör kararı gerektirir.";
      break;
    case "human_request":
      body = isTr
        ? "Tabii ki. Talebinizi ev sahibimize ilettim; en kısa sürede kendisi sizinle iletişime geçecektir."
        : "Of course. I've passed your request to our host, who will get in touch with you as soon as possible.";
      break;
    case "early_checkin":
      body = isTr
        ? `Check-in saatimiz ${p.checkInTime}. Erken giriş, o günkü müsaitliğe bağlı olarak mümkün olabilir. Müsaitliği kontrol edip size en kısa sürede bilgi vereceğiz.`
        : `Our check-in time is ${p.checkInTime}. An early check-in may be possible depending on availability that day. We'll check and let you know as soon as we can.`;
      break;
    case "late_checkout":
      body = isTr
        ? `Check-out saatimiz ${p.checkOutTime}. Geç çıkış, sonraki rezervasyon ve temizlik programına bağlı olarak mümkün olabilir. Kontrol edip size dönüş yapacağız.`
        : `Our check-out time is ${p.checkOutTime}. A late check-out may be possible depending on the cleaning schedule and the next booking. We'll check and get back to you.`;
      break;
    case "checkin": {
      const kb = findKb(input, "checkin");
      body = isTr
        ? kb
          ? `Giriş bilgileri: ${kb}\n\nCheck-in saatimiz ${p.checkInTime}.`
          : `Check-in saatimiz ${p.checkInTime}. Giriş talimatlarını girişten önce sizinle paylaşacağız.`
        : kb
          ? `Check-in details: ${kb}\n\nOur check-in time is ${p.checkInTime}.`
          : `Our check-in time is ${p.checkInTime}. We'll share the entry instructions with you before arrival.`;
      break;
    }
    case "checkout":
      body = isTr
        ? `Check-out saatimiz ${p.checkOutTime}. Çıkışta anahtarları/kartı belirtilen yere bırakmanız yeterli olacaktır.`
        : `Our check-out time is ${p.checkOutTime}. On your way out, simply leave the keys/card in the agreed place.`;
      break;
    case "wifi": {
      const kb = findKb(input, "wifi");
      body = isTr
        ? kb ? `Wi-Fi bilgileri: ${kb}` : "Wi-Fi bilgilerini kontrol edip en kısa sürede sizinle paylaşacağız."
        : kb ? `Wi-Fi details: ${kb}` : "We'll check the Wi-Fi details and share them with you shortly.";
      break;
    }
    case "parking": {
      const kb = findKb(input, "parking");
      body = isTr
        ? kb ? `Otopark bilgisi: ${kb}` : "Otopark durumunu kontrol edip size bilgi vereceğiz."
        : kb ? `Parking info: ${kb}` : "We'll check the parking options and let you know.";
      break;
    }
    case "location": {
      const kb = findKb(input, "location");
      const addr = p.address ? `${p.address}${p.city ? ", " + p.city : ""}` : null;
      body = isTr
        ? kb
          ? `Konum bilgisi: ${kb}`
          : addr
            ? `Adresimiz: ${addr}. Detaylı yol tarifini girişten önce paylaşacağız.`
            : "Konum ve yol tarifi bilgisini en kısa sürede sizinle paylaşacağız."
        : kb
          ? `Location info: ${kb}`
          : addr
            ? `Our address is: ${addr}. We'll share detailed directions before arrival.`
            : "We'll share the location and directions with you shortly.";
      break;
    }
    case "cleaning": {
      const kb = findKb(input, "cleaning");
      body = isTr
        ? kb ? `Temizlik bilgisi: ${kb}` : "Temizlik talebinizi aldık, ekibimizle planlayıp size dönüş yapacağız."
        : kb ? `Cleaning info: ${kb}` : "We've received your cleaning request and will arrange it with our team and get back to you.";
      break;
    }
    case "amenity": {
      const kb = findKb(input, "general");
      body = isTr
        ? kb ? `Ekipman bilgisi: ${kb}` : "Ekipman veya eşya ile ilgili sorunuzu ekibimize ilettik; en kısa sürede size dönüş yapacağız."
        : kb ? `Amenity info: ${kb}` : "We've passed your question about the equipment to our team and will get back to you shortly.";
      break;
    }
    default:
      body = isTr
        ? "Mesajınız için teşekkürler. Talebinizi aldık ve en kısa sürede size dönüş yapacağız. Bu sırada başka bir sorunuz olursa çekinmeden yazabilirsiniz."
        : "Thanks for your message. We've received your request and will get back to you as soon as possible. Feel free to write if you have any other questions.";
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
    actionSuggestion = "Misafir bizzat ev sahibiyle görüşmek istiyor — İsa'ya ilet, kişisel dönüş yapsın.";
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
    actionSuggestion,
    riskLevel,
    detectedLanguage,
    statedCheckoutTime: null,
  };
}
