// ---------------------------------------------------------------------------
// BİLGİ TABANINDAKİ ÜÇÜNCÜ ŞAHIS CÜMLEYİ BİRİNCİ KİŞİYE ÇEVİR (kurucu 11-06 gece: "misafire 3. şahıs gitmesin, yasaklamadan en aza düşsün";
// 11-07: istem örneği için ücretli ölçüm onayı). Ücretsiz ölçüm (`docs/olcum/host-voice-replay-2026-11-06.md`): ev sahibi sesi kapısının
// YALNIZ kendisinin tuttuğu iyi cevapların başlıcası bilgi tabanındaki "Ev sahibine … ulaşılır" cümlesini aynen kopyalayan cevaplar.
// Katman bu cümleyi birinci kişiye çevirmeyi tek örnekle öğretir; K-1029-A yasak katmanına bağlıdır (o kapalıyken çapa yok, katman boş).
// 🚨 Anahtar `AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED` VARSAYILAN KAPALI (yalnız "1"); kapalıyken sistem istemi bayt bayt aynı (pinli).
// Misafire gideni değiştirir → açmadan önce ücretli ölçüm + kurucu. YAPRAK modül.
// ---------------------------------------------------------------------------

export function hostVoiceKbFirstPersonEnabled(): boolean {
  return process.env.AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED === "1";
}
