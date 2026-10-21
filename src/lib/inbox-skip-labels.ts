import { HANDOFF_NOTICE_REASON } from "@/lib/ai/output-veto";
import { MESSAGE_TOO_LONG_REASON } from "@/lib/ai/message-length";
import { RESERVATION_CANCELLED_NOTE } from "@/lib/inbox-skip-note";
import { HAZARD_UNVERIFIED_REASON } from "@/lib/hazard-unverified-alert";
import { BILLING_PAUSED_REASON } from "@/lib/outbox/billing-hold";

// ---------------------------------------------------------------------------
// Konuşma sayfası "yapay zekâ neden cevap vermedi" bandının metinleri (yaprak sabit; sayfadan taşındı ki test her KAYDEDİLEN gerekçenin
// etiketi olduğunu sınayabilsin — `tests/unit/inbox-skip-labels.test.ts`). Etiketi olmayan gerekçe "Otomatik yanıt beklemede" yedeğine
// düşer; bu, yapay zekânın sonra cevap vereceğini ima eder.
// ---------------------------------------------------------------------------

export const SKIP_REASON_LABELS: Record<string, string> = {
  escalated_to_human: "Hassas bir konu — yapay zekâ cevap göndermedi. Mesajı okuyup siz yanıtlayın.",
  complaint: "Şikayet algılandı — otomatik cevap gönderilmedi, size bırakıldı",
  low_confidence_or_risky: "Yapay zekâ emin olamadı — taslağı kontrol edip siz gönderin.",
  // K10 (kurucu kararı 09-30): cevap konuyu size bırakıyordu ("mesajınız kaydedildi" gibi) → misafire hiçbir şey gönderilmedi.
  [HANDOFF_NOTICE_REASON]: "Misafir cevabınızı bekliyor — yapay zekâ bu mesajı size bıraktı, misafire bir şey gönderilmedi",
  closing_ack: "Misafir sohbeti kapattı — cevap gerekmedi",
  // Kapanışa yine cevap gitmedi ama konuşmada açık bir konu olabilir (teklif kabulü, devir, bekleyen soru).
  closing_ack_open: "Misafir teşekkür etti; otomatik cevap gönderilmedi. Açık bir konu varsa yanıtlayın.",
  human_hold: "Misafir sizinle görüşmek istedi — yapay zekâ bu konuşmada bekliyor. Siz yanıtlayın.",
  // Kurucu T2 (10-21): olası tehlike + anlama katmanı koşmadı → konuşma Sorunlu, yapay zekâ susar. Eskiden etiket yoktu ve bant
  // "Otomatik yanıt beklemede" diyordu (UX incelemesi 10-21 N) — yapay zekâ sonra cevap verecekmiş gibi.
  [HAZARD_UNVERIFIED_REASON]: "Misafir olası bir tehlike bildirdi — yapay zekâ cevap vermedi. Mesajı okuyup misafire hemen siz ulaşın.",
  reservation_ended: "Konaklama bitti — otomatik yanıt bu konuşmada kapalı",
  // Kurucu 10-12: iptal ayrı söylenir (gerekçe kodu aynı kalır — senkronun onarım mantığı `reservation_ended`e bağlı).
  [RESERVATION_CANCELLED_NOTE]: "Rezervasyon iptal edilmiş — yapay zekâ cevap vermiyor, yapay zekâ kullanımınızdan da düşülmüyor",
  // Kota dolduğunda sebep GÖRÜNÜR olmalı: aksi hâlde host "AI neden sustu?"
  // sorusunun cevabını hiçbir yerde bulamaz (denetim, 07-31).
  daily_budget:
    "Günlük AI sınırınıza ulaşıldı — bu konuşma sınır yenilenince otomatik yanıtlanacak",
  not_connected:
    "Airbnb / Booking bağlantısı kurulu değil — otomatik yanıt gönderilemiyor. Ayarlar'dan bağlantınızı kontrol edin.",
  // "Model emin olamadı"dan AYRI: buna ulaşılamadı demek. Geçici olduğu için
  // konuşma damgalanmaz, servis dönünce kendiliğinden yeniden denenir.
  ai_unavailable:
    "AI servisine geçici olarak ulaşılamadı — bağlantı düzelince bu konuşma otomatik olarak yeniden denenecek",
  // Model cevap verdi ama çıktı üst üste kullanılamadı (3 deneme, 09-28): bu mesaj bir daha OTOMATİK denenmez.
  ai_unusable: "AI bu mesaja kullanılabilir bir cevap üretemedi — lütfen elle yanıtlayın",
  // Y5 (10-14): genel otomatik yanıt anahtarı kapalıyken hazırlanmış cevap kuyrukta iptal edildi.
  auto_reply_disabled: "Otomatik yanıt kapalıyken hazırlanan cevap gönderilmedi — lütfen elle yanıtlayın",
  // N1 (kurucu 10-17, "tek gösterimlik uyarı"): abonelik kapalıyken gelen mesaj / hazırlanmış cevap — ödeme sonrası bayat cevap gitmez.
  billing_paused: "Abonelik aktif değilken bu mesaja otomatik yanıt gönderilmedi — lütfen elle yanıtlayın",
  // Kurucu W7 (10-21): kanal bağlantısının aboneliği kapalıyken hazırlanan cevap, bağlantı dönünce bayat olduğu için gönderilmedi.
  channel_paused: "Kanal bağlantısı kapalıyken hazırlanan cevap gönderilmedi — lütfen elle yanıtlayın",
  // K10-t (kurucu kararı 09-28): tek mesaj 8.000 karakteri aşıyor — yapay zekâ cevap üretmedi, metin modele verilmedi.
  [MESSAGE_TOO_LONG_REASON]: "Mesaj çok uzun (8.000 karakterden fazla) — yapay zekâ cevap üretmedi; lütfen mesajı okuyup elle yanıtlayın",
  // Mevcut müşterilerin gündüz mesajlarının sessizce cevapsız kalmasının TEK
  // sebebi buydu ve hiçbir ekranda yazmıyordu (şema varsayılanı hâlâ gece-only).
  outside_hours:
    "Otomatik cevabın açık olduğu saatlerin dışında geldi — saatleri Ayarlar › AI ve Otomasyon'dan değiştirebilirsiniz.",
  // Gönderim kanalı reddetti. Konuşma kaybolmaz: bir süre sonra kendiliğinden
  // yeniden denenir (denetim, 08-01 — eskiden 2 dakikada bir sessizce yeniden
  // denenip her seferinde kota yakıyor, host hiçbir yerde sebebi göremiyordu).
  // ⚠️ SÜRE GERÇEK OLMALI (denetim, 08-01). Eski metin "birazdan" diyordu ama
  // geri çekilme penceresi 4 SAAT (`SEND_FAILURE_HOLD_MS`) — host 10 dakika
  // sonra bakıp hiçbir şey olmayınca "ürün bozuk" diyor ya da boşuna bekliyor.
  send_failed:
    "Mesaj kanala iletilemedi — bağlantınızı kontrol edin. Otomatik deneme yaklaşık 4 saat sonra tekrarlanır; acilse mesajı elle yanıtlayın.",
  // Sistem yenilenmeyi İZLEMİYOR — sabit aralıklarla yeniden deniyor. Metin de
  // bunu söylemeli (denetim, 08-01).
  subscription_inactive:
    "Kanal bağlantınızın aboneliği pasif görünüyor — mesaj gönderilemiyor. Abonelik yenilendikten sonra en geç birkaç saat içinde yeniden denenir.",
  rate_limited:
    "Kanal geçici olarak yoğun — bu konuşma kısa süre sonra otomatik olarak yeniden denenecek",
  // ⚠️ BELİRSİZ SONUÇ (denetim, 08-01 — üçüncü tur). Mesaj misafire ULAŞMIŞ
  // OLABİLİR: gönderim isteği zaman aşımına/5xx'e düştü ve sağlayıcı geçmişinden
  // güvenle doğrulanamadı, bu yüzden satır bilerek incelemeye park edildi ve
  // ASLA kör tekrar gönderilmedi. Metin host'u "elle yanıtla"ya çağırırsa misafir
  // ÇİFT mesaj alabilir — o yüzden ÖNCE kontrol etmesini söylüyor.
  delivery_unverified:
    "Gönderim sonucu doğrulanamadı — mesaj iletilmiş OLABİLİR. Elle yanıtlamadan önce konuşmayı kanal üzerinden kontrol edin.",
  // G10 (kurucu kararı 10-13): aynı belirsizlik, sebebi kanal sağlayıcısındaki arıza — aynı uyarı (çift mesaj riski).
  provider_outage:
    "Kanal sağlayıcısında arıza — mesaj iletilmiş OLABİLİR. Elle yanıtlamadan önce konuşmayı kanal üzerinden kontrol edin.",
};

// UX incelemesi 10-21 C: bant sebebi yazıyordu ama çoğu sebepte ne yapılacağına giden yol yoktu. Sebep başına tek bağlantı; sekme
// adları `settings-nav.ts`teki kalıcı `?tab=` sözleşmesi (görünmeyen sekme varsayılana düşer — rol kapısı ayarlar sayfasında).
const HOURS = { href: "/settings?tab=ai-otomasyon", label: "Saatleri değiştirin" } as const;
const CONNECTION = { href: "/settings?tab=baglantilar", label: "Bağlantıyı açın" } as const;
const PLAN = { href: "/settings?tab=faturalandirma", label: "Planı görün", ownerOnly: true } as const;

/** `ownerOnly`: hedef sekmeyi yalnız hesap sahibi görür (Faturalandırma) — başka role bağlantı çizilmez (Haiku 10-21 #4). */
export const SKIP_REASON_ACTIONS: Record<string, { href: string; label: string; ownerOnly?: boolean }> = {
  outside_hours: HOURS,
  not_connected: CONNECTION,
  send_failed: CONNECTION,
  subscription_inactive: CONNECTION,
  daily_budget: PLAN,
  [BILLING_PAUSED_REASON]: PLAN,
};

/** Bu kullanıcıya gösterilecek eylem (rol süzgeci tek yerde). */
export function skipReasonActionFor(reason: string | null | undefined, role: string): { href: string; label: string } | null {
  const action = reason ? SKIP_REASON_ACTIONS[reason] : undefined;
  if (!action || (action.ownerOnly && role !== "owner")) return null;
  return action;
}
