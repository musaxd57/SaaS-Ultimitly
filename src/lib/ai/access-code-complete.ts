// ---------------------------------------------------------------------------
// GİRİŞ TARİFİNDE KOD (Luna ölçümü 09-30; YALNIZ ÖLÇÜM — canlıda açmak kurucu onayı).
//
// Canlı hatta gpt-6-luna "binanın önündeyiz, anahtarı nereden alacağız?" / "how do we get the keys?" sorusuna kutunun yerini ve
// "kodu girip kapağı çekin" adımını yazıp KODU YAZMADI (bilgi tabanında yazıyor; cevap misafire gitti) — kod açıkça sorulunca
// veriyordu; gpt-5.1 iki soruda da kodu yazıyordu. Anahtar açıkken KURAL-3'e tek cümle girer: giriş / anahtar sorusunda bilgi
// tabanının yazdığı kod tarifle birlikte AYNEN yazılır. Onaylanmamış rezervasyon ve QR blokları (kod ASLA) önceliklidir; kodun
// isteme girip girmemesi zaten kodda (konaklama kapsamı + sır süzgeci) — kural hiçbir kodu uydurtmaz ve kapıyı açmaz.
//
// 🚨 Anahtar `AI_ACCESS_CODE_COMPLETE_ENABLED` VARSAYILAN KAPALI; kapalıyken sistem istemi bayt bayt aynı (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function accessCodeCompleteEnabled(): boolean {
  return process.env.AI_ACCESS_CODE_COMPLETE_ENABLED === "1";
}
