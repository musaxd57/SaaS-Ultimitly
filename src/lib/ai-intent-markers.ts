// ---------------------------------------------------------------------------
// `Message.aiIntent` alanına yazılan KOD İŞARETLERİ — misafirin sorduğu bir KONU değildir. YAPRAK (hiçbir şey içe aktarmaz).
// Tur 5 (11-05, ölçüldü): kapanış nezaket cevabının döngü koruması işareti "En Çok Sorulanlar" raporunda konu gibi sayılıp ham kodla
// ("closing_courtesy 3") listenin başına çıkıyordu. Raporlar bu kümeyi konu saymaz.
// ---------------------------------------------------------------------------

/** Kapanış nezaket cevabı ("Rica ederiz") — döngü koruması: son giden bu ise misafirin teşekkürüne yeniden cevap verilmez. */
export const CLOSING_COURTESY_INTENT = "closing_courtesy";

/** Konu sayılmayan işaretler (rapor süzgeci). */
export const NON_TOPIC_INTENT_MARKERS: readonly string[] = [CLOSING_COURTESY_INTENT];
