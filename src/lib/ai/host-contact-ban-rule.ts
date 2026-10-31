// ---------------------------------------------------------------------------
// "EV SAHİBİNİZE YAZIN" İSTEM YASAĞI (kurucu K-1029-A, 10-29 gece: "istem + kod — her dilde, her biçimde yasak").
// Kod tarafı (`host-contact-filler.ts`) her durumda çıkarır; bu katman modelin o cümleyi HİÇ yazmamasını ister. Kurucu istemi de açıkça
// istediği için VARSAYILAN AÇIK; acil durdurma `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=1` → sistem istemi bugünküyle bayt bayt aynı (pinli).
// Ücretli ölçüm (kredi gelince) Railway açılmadan önce şart: yasaklı cümle oranı, cevaplanan oran, tutma oranı (tasarım §E).
// YAPRAK modül.
// ---------------------------------------------------------------------------

export function hostContactPromptBanEnabled(): boolean {
  return process.env.AI_HOST_CONTACT_PROMPT_BAN_DISABLED !== "1";
}

/**
 * KISMİ GÖNDERİM ACİL DURDURMA (tasarım A12, 10-30; varsayılan KAPALI, yalnız "1" açar): yönlendirme cümlesi silinince kalan doğru cevap bugün
 * gider. Bu anahtar açıkken KONULU bir silme (genel kapanış değil) ya da misafirin olasılık sorusuna bağlı her silme cevabın TAMAMINI tutar
 * (`hostContactOnly`) — kanal, QR, AI öner hepsinde. Yasak yine geçerli: taslak silinmiş metindir, ev sahibine e-posta yine gider.
 */
export function hostContactPartialDisabled(): boolean {
  return process.env.AI_HOST_CONTACT_PARTIAL_DISABLED === "1";
}
