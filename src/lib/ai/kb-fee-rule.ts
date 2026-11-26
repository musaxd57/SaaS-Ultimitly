// ---------------------------------------------------------------------------
// BİLGİ TABANINDA YAZAN SABİT HİZMET ÜCRETİ — KURAL-4 netleştirmesi (kurucu onayı 09-30: "iki modelde ölç"; YALNIZ ÖLÇÜM).
//
// 09-25 model kıyası: gpt-6-luna KURAL-4'ü ("Fiyat … ASLA yazma") harfiyen okuyup bilgi tabanındaki sabit ücreti ("otopark
// günlük 150 TL") söylemedi, "ücret ev sahibinizin kararıdır" dedi ve bu cevaplar otomatik gidiyordu; gpt-5.1 kuralı dar
// okuyup ücreti söylüyordu. Varyant, KURAL-4'e TEK istisna ekler: misafir bir hizmetin ücretini soruyor ve bilgi tabanı o
// hizmetin sabit ücretini açıkça yazıyorsa tutar AYNEN aktarılır. Konaklama / gece fiyatı, erken giriş / geç çıkış ücreti
// (Bölüm 7.5 + ev sahibinin teklif bloğu), iade, indirim, tazminat istisnaya GİRMEZ.
//
// 🚨 Anahtar `AI_KB_FEE_RULE_ENABLED` VARSAYILAN KAPALI; kapalıyken sistem istemi bayt bayt aynı (pinli). Canlıda açmak =
// iki modelde cevap kıyası + kurucu onayı. YAPRAK modül (hiçbir şey içe aktarmaz).
// ---------------------------------------------------------------------------

export function kbFeeRuleEnabled(): boolean {
  return process.env.AI_KB_FEE_RULE_ENABLED === "1";
}
