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
