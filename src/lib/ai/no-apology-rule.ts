// ---------------------------------------------------------------------------
// TARAFSIZLIK / ÖZÜR YASAĞI (kurucu 10-21, aynen: "sofra kirli derse özür dilemesin, haklısınız üzgünüm demesin — olaylar net değilken
// hostu haksız duruma düşürecek hiçbir şey yapmamalı"; "çıkmak istiyorum para vermeyeceğim … model kesinlikle cevap üretmesin").
//  · Kök neden (ölçüldü, `docs/PLAN-2026-10-21-baglam-anlama-ve-kirmizi-takim.md`): taban istem şikâyette "Bunun için özür dileriz"
//    kalıbını ÖĞRETİYORDU ("kısa özür ≠ kusur kabulü", Bölüm 10.6 + dört örnek). Gerçek ölçüm cevaplarının ~%9'u özür içeriyordu;
//    misafire GİDEN 3.329 cevapta 1 açık kusur özrü ("İnternetle ilgili yaşadığınız aksaklık için özür dileriz").
//  · Katman: özür / "haklısınız" / kusur kabulü / tazminat iması / suçlama yasak; şikâyetin kendisi hakkında yorum yok (ev sahibine kalır);
//    ödeme reddi / iade / tehdit mesajında taahhüt, açıklama, savunma yok. Örnekler özürsüz.
// 🚨 Anahtar `AI_NO_APOLOGY_RULE_ENABLED` VARSAYILAN KAPALI; kapalıyken sistem istemi bayt bayt aynı (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function noApologyRuleEnabled(): boolean {
  return process.env.AI_NO_APOLOGY_RULE_ENABLED === "1";
}
