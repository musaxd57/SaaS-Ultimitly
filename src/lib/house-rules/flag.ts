import { understandingEnabled } from "@/lib/ai/semantic/understand";

// ---------------------------------------------------------------------------
// EV KURALLARI BAYRAKLARI — TEK OKUMA NOKTASI (#188).
//
// `HOUSE_RULES_CARD_ENABLED` (dilim 2): kart ve kayıt rotası; VARSAYILAN KAPALI. Kart açıkken bile yapay zekâ kuralları
// KULLANMAZ (kart bunu söyler).
//
// `AI_HOUSE_RULES_SHADOW` (dilim 3, gölge ölçüm): anlama katmanı her isteğe ev kuralı konusu + misafirin tutumunu ekler;
// "kural açık olsaydı ne olurdu" YALNIZ karar kaydına yazılır (`shadow.ts`, kanıtta `hr`). KARAR DEĞİL: hiçbir kapı okumaz,
// cevap değişmez. Yalnız tam "1" açar; anlama katmanı kapalıyken açık SAYILMAZ (konu/tutum onun çıktısıdır). Kapalıyken
// katmanın şeması / istemi / önbellek anahtarı bayt bayt eskisi ve kural deposu hiç okunmaz. Açmadan önce konaklama
// değişikliği eval'i kural kipinde yeniden koşulur (anlama istemi değişir).
// ---------------------------------------------------------------------------

export function houseRulesCardEnabled(): boolean {
  return process.env.HOUSE_RULES_CARD_ENABLED?.trim() === "1";
}

export function houseRulesShadowEnabled(): boolean {
  return process.env.AI_HOUSE_RULES_SHADOW === "1" && understandingEnabled();
}
