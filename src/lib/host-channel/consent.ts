// ---------------------------------------------------------------------------
// WhatsApp bildirim RIZASI (tasarım §5.4, §9 madde 11). Yaprak modül. Ev sahibi Ayarlar'da numarasını bağlarken bu kutuyu işaretler; metnin
// SÜRÜMÜ bağlantı satırına yazılır (`optInTextVersion`) — metin değişirse sürüm değişir, eski rızanın hangi metne verildiği izlenebilir.
// ⚠️ TASLAK: metin kurucu + avukat onayını bekliyor (sabah raporu); onaylanınca sürüm "-taslak" ekini kaybeder.
// ---------------------------------------------------------------------------

// v2 (kurucu 10-31 "Rıza metnini güncelle"): kapsam soru + acil bildirim + karar isteği (dilim 3–4). v1'le bağlanmış canlı numara YOK (Railway
// kapalı, anahtarlar kapalı) — yeniden rıza akışı gerekmedi.
export const HOST_CHANNEL_CONSENT_VERSION = "v2-taslak-2026-10-31";

export const HOST_CHANNEL_CONSENT_TEXT =
  "Misafir sorularının, acil misafir bildirimlerinin ve karar isteklerinin bu WhatsApp numarasına gönderilmesini kabul ediyorum. Mesajlar Meta (WhatsApp) üzerinden iletilir; istediğim zaman buradan ya da WhatsApp'tan DUR yazarak kapatabilirim.";
