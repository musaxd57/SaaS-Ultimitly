import type { Priority } from "@/lib/constants";
import type { ClassifyResult, SuggestReplyInput, SuggestReplyResult } from "./types";

// Deterministic, keyword-based AI fallback. Used when no OPENAI_API_KEY is set,
// or when the OpenAI call fails. Keeps the product usable without external APIs.

type Intent =
  | "complaint"
  | "early_checkin"
  | "late_checkout"
  | "checkin"
  | "checkout"
  | "wifi"
  | "parking"
  | "location"
  | "cleaning"
  | "refund"
  | "general";

const KEYWORDS: Record<Exclude<Intent, "general">, string[]> = {
  complaint: [
    "çalışmıyor", "calismiyor", "kirli", "bozuk", "problem", "sorun", "şikayet", "sikayet",
    "kötü", "kotu", "berbat", "leak", "su akıyor", "koku", "böcek", "bocek", "broken",
    "dirty", "not working", "complaint", "rezalet", "iğrenç", "igrenc",
  ],
  refund: ["iade", "geri ödeme", "geri odeme", "refund", "para iadesi", "ücret iade"],
  early_checkin: ["erken giriş", "erken giris", "early check", "erken check", "early arrival"],
  late_checkout: ["geç çıkış", "gec cikis", "late check", "geç check", "gec check", "late departure"],
  checkin: ["giriş", "giris", "check-in", "check in", "checkin", "anahtar", "key", "nasıl gir", "nasil gir", "kapı kodu", "kapi kodu", "access"],
  checkout: ["çıkış", "cikis", "check-out", "check out", "checkout", "ne zaman çık", "ne zaman cik"],
  wifi: ["wifi", "wi-fi", "internet", "şifre", "sifre", "password", "wireless"],
  parking: ["otopark", "park yeri", "araç", "arac", "parking", "araba", "garaj"],
  location: ["adres", "konum", "nerede", "address", "location", "yol tarifi", "directions", "nasıl gelir", "nasil gelir"],
  cleaning: ["temizlik", "havlu", "çarşaf", "carsaf", "cleaning", "towel", "bed sheet", "ek temizlik"],
};

function detectIntent(message: string): Intent {
  const m = message.toLowerCase();
  // Order matters: complaints & refunds take precedence.
  const order: Exclude<Intent, "general">[] = [
    "complaint", "refund", "early_checkin", "late_checkout",
    "checkin", "checkout", "wifi", "parking", "location", "cleaning",
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
  const greeting = name ? `Merhaba ${name},` : "Merhaba,";
  const closing = input.tone === "short" ? "" : "\n\nİyi günler dileriz.";
  const p = input.property;

  let body: string;
  let risk: string | null = null;

  switch (intent) {
    case "complaint":
      body =
        "Yaşadığınız sorun için çok üzgünüz. Durumu hemen ekibimize iletiyoruz ve en kısa sürede sizinle ilgileneceğiz. Bu arada size yardımcı olabileceğimiz acil bir şey varsa lütfen belirtin.";
      risk = "Şikayet/olası sorun algılandı. Yöneticiye iletilmeli; otomatik karar verilmedi.";
      break;
    case "refund":
      body =
        "Talebinizi aldık. İade ve ücret konuları yöneticimiz tarafından değerlendirilecektir; en kısa sürede size dönüş yapacağız.";
      risk = "İade/ücret talebi. Finansal karar gerektirir, yönetici onayı şart.";
      break;
    case "early_checkin": {
      body = `Check-in saatimiz ${p.checkInTime}. Erken giriş, o günkü müsaitliğe bağlı olarak mümkün olabilir. Müsaitliği kontrol edip size en kısa sürede bilgi vereceğiz.`;
      break;
    }
    case "late_checkout": {
      body = `Check-out saatimiz ${p.checkOutTime}. Geç çıkış, sonraki rezervasyon ve temizlik programına bağlı olarak mümkün olabilir. Kontrol edip size dönüş yapacağız.`;
      break;
    }
    case "checkin": {
      const kb = findKb(input, "checkin");
      body = kb
        ? `Giriş bilgileri: ${kb}\n\nCheck-in saatimiz ${p.checkInTime}.`
        : `Check-in saatimiz ${p.checkInTime}. Giriş talimatlarını girişten önce sizinle paylaşacağız.`;
      break;
    }
    case "checkout": {
      body = `Check-out saatimiz ${p.checkOutTime}. Çıkışta anahtarları/kartı belirtilen yere bırakmanız yeterli olacaktır.`;
      break;
    }
    case "wifi": {
      const kb = findKb(input, "wifi");
      body = kb
        ? `Wi-Fi bilgileri: ${kb}`
        : "Wi-Fi bilgilerini kontrol edip en kısa sürede sizinle paylaşacağız.";
      break;
    }
    case "parking": {
      const kb = findKb(input, "parking");
      body = kb
        ? `Otopark bilgisi: ${kb}`
        : "Otopark durumunu kontrol edip size bilgi vereceğiz.";
      break;
    }
    case "location": {
      const kb = findKb(input, "location");
      const addr = p.address ? `${p.address}${p.city ? ", " + p.city : ""}` : null;
      body = kb
        ? `Konum bilgisi: ${kb}`
        : addr
          ? `Adresimiz: ${addr}. Detaylı yol tarifini girişten önce paylaşacağız.`
          : "Konum ve yol tarifi bilgisini en kısa sürede sizinle paylaşacağız.";
      break;
    }
    case "cleaning": {
      const kb = findKb(input, "cleaning");
      body = kb
        ? `Temizlik bilgisi: ${kb}`
        : "Temizlik talebinizi aldık, ekibimizle planlayıp size dönüş yapacağız.";
      break;
    }
    default:
      body =
        "Mesajınız için teşekkürler. Talebinizi aldık ve en kısa sürede size dönüş yapacağız. Bu sırada başka bir sorunuz olursa çekinmeden yazabilirsiniz.";
  }

  return {
    intent,
    confidence,
    reply: `${greeting}\n\n${body}${closing}`.trim(),
    risk,
    priority,
    source: "fallback",
  };
}
