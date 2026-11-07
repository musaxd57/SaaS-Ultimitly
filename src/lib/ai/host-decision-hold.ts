// ---------------------------------------------------------------------------
// "EV SAHİBİNİZİN KARARIDIR" MİSAFİRE GİTMEZ (kurucu kararı 10-01: "ev sahibinizin kararıdır hiç bir şekilde gitmemeli, sussa
// bile daha iyi … ertelemeyi gönderme"; gece notu: "Erken giriş ev sahibinizin kararına bağlıdır demesin sakın … gerekirse bir şey
// yazmaz, host panelinde 'karar bekliyor' açık kalır, host'a bir bildirim gider; tekrar tekrar gönderilmez").
//
// Anahtar açıkken: (1) kararı EV SAHİBİNE bırakan cümle (7 dil, dar liste `defersDecisionToHost`) her bağlamda devir sayılır —
// çıktı vetosu `handoff_notice`, K10 yolu ("Misafir cevabınızı bekliyor" e-postası, mesaj başına tek); (2) hassas konaklama
// isteğinde iki modelin doğruladığı erteleme de (ev sahibini adlandırmasa da) gitmez (`evaluateAvailability.deferralHeld`).
// Koddan kurulan doğrulanmış erken giriş ONAYI muaftır (birebir metin). Konuşma öğesi açık kalır (gönderilmeyen cevap öğeyi
// kapatmaz). 🚨 Anahtar `AI_HOST_DECISION_HOLD_ENABLED` VARSAYILAN KAPALI; kapalıyken davranış birebir (pinli). YAPRAK modül.
// ---------------------------------------------------------------------------

export function hostDecisionHoldEnabled(): boolean {
  return process.env.AI_HOST_DECISION_HOLD_ENABLED === "1";
}
