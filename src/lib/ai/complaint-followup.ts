// ---------------------------------------------------------------------------
// ŞİKÂYET TAKİBİ KURALI (kök neden, kurucu kararı 10-01 "İkisi + yeni kör set"; Luna kör kabul bulgusu): "Gürültü yüzünden
// uyuyamadık, yine olursa ne yapacağız?" TEK şikâyet + ona bağlı yardım talebidir.
//  · Anlama katmanı eki: şikâyete bağlı yardım sorusu AYRI istek değildir (şikâyet isteğinin parçası).
//  · Cevap istemi katmanı: şikâyet edene kural hatırlatması yazılmaz; misafire 112 / acil servis arama yönergesi HİÇ yazılmaz (kurucu 10-11).
// Kod koruması (`conversation-items/core.ts complaintDependent`) anahtardan BAĞIMSIZ her zaman açıktır; bu anahtar yalnız modellerin
// talimatını düzeltir. 🚨 Anahtar `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` VARSAYILAN KAPALI; kapalıyken iki istem ve anlama önbellek
// anahtarı bayt bayt aynı (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function complaintFollowupRuleEnabled(): boolean {
  return process.env.AI_COMPLAINT_FOLLOWUP_RULE_ENABLED === "1";
}
