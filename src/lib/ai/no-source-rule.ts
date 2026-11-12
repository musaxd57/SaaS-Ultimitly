// ---------------------------------------------------------------------------
// KAYNAĞI OLMAYAN İSTEK CEVAPLANMAZ — "YAZMIYORSA YOK DEĞİLDİR" (kurucu 11-12: "promptların içinde bu yanlışlara sebep olan yazılar";
// istem denetimi `docs/INCELEME-2026-11-12-istem-denetimi.md`). YALNIZ ÖLÇÜM — canlıda açmak kurucu onayı.
//
// Ölçülen hata: bilgi tabanında karşılığı olmayan soruda cevap modeli kesin bir cümle uyduruyor ("… servisi bulunmuyor", "… bulunmaktadır",
// başka bir yerin mesafesini sorulan yere yazıyor) ve cevap gidiyor. Geliştirme raporlarında (gpt-5.1) dürüst "bilgim yok" taslaklarının
// 22'sinden 0'ı, uydurma cümlelerin 17'sinden 10'u misafire gitti. Denetimin bulduğu sebep istemin kendisi: bilgisizlik açıklaması, ev
// sahibine yönlendirme, söz ve çekinceli dil ayrı ayrı yasak; "hiçbir soruyu atlama" dört yerde emrediliyor; tek izinli çıkış ("güveni 0,4'ün
// altına yaz, metin gönderilmez") TURUN TAMAMINI tutuyor — iki soruluk mesajda bildiği cevabı da kaybetmemek için model uyduruyor. Öğe
// kipinde (istek defteri) o söz ayrıca yanlış: cevaplanan istekler gider.
//
// Anahtar açıkken (YALNIZ öğe kipinde — istek defteri yoksa atlanan soru iz bırakmadan kaybolurdu):
//  · sistem istemi: kural İSTEK BAŞINA — cevabı kaynakta AÇIKÇA yazmayan isteği cevaplama, `answeredRequests`e koyma; "yok" hükmü de
//    iddiadır; başka bir şeyin kaydındaki değeri taşıma; konu olarak yakın kayıt cevap değildir. "Hiçbir soruyu atlama" cümleleri kaynağı
//    olan sorularla sınırlanır; güven tablosu ve KURAL-3 / 10.5 aynı kurala bağlanır; iki soruluk bir örnek eklenir.
//  · kullanıcı istemi: öğe bloğuna KAYNAK ŞARTI ("cevaplanacak" listesi isteğin TÜRÜNE göre kuruldu, cevabın bilgi tabanında olduğu
//    doğrulanmadı), uzunluk ipucu ve bilgi tabanı başlığı aynı kuralı söyler.
// Kod kapısı DEĞİŞMEZ: model yine de uydurursa bu katman onu durdurmaz — yapısal güvence cevap parçaları kipidir (birebir alıntı, kodla
// doğrulama). Cevaplanmayan istek defterde AÇIK kalır ve ev sahibine bildirilir (bugünkü kısmi cevap davranışı).
//
// 🚨 Anahtar `AI_NO_SOURCE_RULE_ENABLED` VARSAYILAN KAPALI; kapalıyken sistem ve kullanıcı istemi bayt bayt aynı (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function noSourceRuleEnabled(): boolean {
  return process.env.AI_NO_SOURCE_RULE_ENABLED === "1";
}
