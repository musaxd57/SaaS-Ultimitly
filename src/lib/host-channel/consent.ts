// ---------------------------------------------------------------------------
// WhatsApp bildirim RIZASI (tasarım §5.4, §9 madde 11). Yaprak modül. Ev sahibi Ayarlar'da numarasını bağlarken bu kutuyu işaretler; metnin
// SÜRÜMÜ bağlantı satırına yazılır (`optInTextVersion`) — metin değişirse sürüm değişir, eski rızanın hangi metne verildiği izlenebilir.
// ⚠️ TASLAK: metin kurucu + avukat onayını bekliyor (sabah raporu); onaylanınca sürüm "-taslak" ekini kaybeder.
// ---------------------------------------------------------------------------

export const HOST_CHANNEL_CONSENT_VERSION = "v1-taslak-2026-10-30";

export const HOST_CHANNEL_CONSENT_TEXT =
  "Misafir sorularının bu WhatsApp numarasına gönderilmesini kabul ediyorum. Mesajlar Meta (WhatsApp) üzerinden iletilir; istediğim zaman buradan ya da WhatsApp'tan DUR yazarak kapatabilirim.";
