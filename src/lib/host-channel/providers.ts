// ---------------------------------------------------------------------------
// Ev sahibi soru kanalının SAĞLAYICI KİMLİKLERİ (yaprak modül; hiçbir şey import etmez). Bağlantı satırında saklanan dize numara arama
// anahtarının da parçasıdır (`addressHash` = sağlayıcı + numara): bağlamayı başlatan Ayarlar rotası, kodu doğrulayan web kancası ve gönderen
// bağdaştırıcı AYNI sabiti kullanmalı — biri "whatsapp", öteki "whatsapp_cloud" yazarsa numara hiç bulunamaz (sessiz kopukluk).
// ---------------------------------------------------------------------------

/** WhatsApp Cloud API (Meta). */
export const WHATSAPP_CLOUD_PROVIDER = "whatsapp_cloud";
