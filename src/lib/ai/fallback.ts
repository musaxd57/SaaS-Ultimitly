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
    "çalışmıyor", "calismiyor", "kirli", "bozuk", "problem", "sorun", "şikayet", "sikayet",
    "kötü", "kotu", "berbat", "leak", "su akıyor", "koku", "böcek", "bocek", "broken",
    "dirty", "not working", "complaint", "rezalet", "iğrenç", "igrenc",
  ],
  refund: ["iade", "geri ödeme", "geri odeme", "refund", "para iadesi", "ücret iade"],
  // Leaving the stay EARLY / shortening / cancelling — a revenue/refund-sensitive
  // signal that must always route to a human (also used as an auto-send veto).
  early_departure: [
    "erken ayrıl", "erken ayril", "erken çık", "erken cik", "ayrılmak zorunda", "ayrilmak zorunda",
    "ayrılmamız gerek", "ayrilmamiz gerek", "rezervasyonu kısalt", "rezervasyonu kisalt", "iptal et",
    "iptal edebilir", "leave early", "check out early", "checking out early", "cut short", "shorten my stay",
    "cancel my", "cancel the", "won't be staying", "wont be staying", "can't stay", "cant stay",
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
