// ---------------------------------------------------------------------------
// KONAKLAMA ERTELEMESİ BİLDİRİMSİZ (Luna ölçümü 09-30; YALNIZ ÖLÇÜM — canlıda açmak kurucu onayı).
//
// K10'dan (09-30) beri "mesajınız kaydedildi / ev sahibiniz görebilir" cümlesi misafire GİTMEZ (çıktı vetosu `handoff_notice`),
// ama istemin Bölüm 7.5 standart erteleme cümlesi ve üç konaklama örneği bu kuyruğu hâlâ öğretiyordu. Canlı hatta gpt-5.1 kuyruğu
// çoğunlukla atıp iki modelin doğruladığı ertelemeyi gönderiyordu (14 konaklama isteğinde 10), gpt-6-luna örneği harfiyen
// izleyip kuyruğu ekliyordu → tutuluyordu (3/14). Anahtar açıkken YALNIZ konaklama ertelemesinin kuyruğu kalkar ("…ev sahibinizin
// kararıdır." erteleme dedektöründe aynen erteleme); devir örnekleri (insan talebi, şikâyet, öz-zarar, çıkışı reddetme, sosyal
// mühendislik) AYNEN kalır — ev sahibine "cevabınızı bekliyor" e-postası o cümleye bağlıdır.
//
// 🚨 Anahtar `AI_STAY_DEFERRAL_PLAIN_ENABLED` VARSAYILAN KAPALI; kapalıyken sistem istemi bayt bayt aynı (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function stayDeferralPlainEnabled(): boolean {
  return process.env.AI_STAY_DEFERRAL_PLAIN_ENABLED === "1";
}
