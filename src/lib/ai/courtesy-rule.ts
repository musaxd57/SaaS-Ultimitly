// ---------------------------------------------------------------------------
// HÂL HATIR KURALI (kurucu tarifi 10-02 akşam: "Karşılık sorsun, ama her 'nasılsın'a aynı cevabı vermesin. Doğru ölçü 'kaç mesaj geçti?'
// değil: misafir bu cümleyi ne amaçla söyledi, önce ne konuşuldu ve AI daha önce nasıl karşılık verdi?").
//  · Kök neden (selam-yalnız mesajın ev sahibine düşmesi): taban istem "soru sormadıysa / yalnız teşekkür-onay-kapanış → güven 0,4 altı"
//    kuralında hâl hatır sorusunu kapanışla AYNI kefeye koyuyordu (Ayarlar testinde "nasılsınız" → güven 0,30 → otomatik gitmez). Katman
//    hâl hatırı bu kuralın dışında tutar; güveni YÜKSELTME talimatı VERMEZ (kurucu: "çözüm 'sohbet cevaplarının güvenini yüksek yaz'
//    talimatı değil").
//  · Güvenlik kapısı aynen: "nasılsın" geçen mesaj hiçbir kontrolden MUAF DEĞİL (şikâyet / insan talebi / tehlike / enjeksiyon aynı
//    mesajda olabilir).
// 🚨 Anahtar `AI_COURTESY_RULE_ENABLED` VARSAYILAN KAPALI; kapalıyken sistem istemi bayt bayt aynı (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function courtesyRuleEnabled(): boolean {
  return process.env.AI_COURTESY_RULE_ENABLED === "1";
}
