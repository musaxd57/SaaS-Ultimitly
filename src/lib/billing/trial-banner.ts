// Deneme bandının "kapat" kuralı (09-24, kurucu önerisi: "isterlerse kapanabilir olsa, 4 saat sonra tekrar gelir").
// Saf + istemci-güvenli (server-only YOK): düzen (sunucu) çerezi okur, bant (istemci) yazar.
//
// Neden çerez (tarayıcı deposu değil): düzen SUNUCUDA çizilir. Çerezi sunucu okuyabildiği için kapatılmış bant
// sayfa yenilemede hiç çizilmez — önce görünüp sonra kaybolma (titreme / kayma) olmaz. Çerezin ömrü 4 saattir;
// süre dolunca tarayıcı onu siler ve bant kendiliğinden geri gelir. İçerik tek bir "1": kişisel veri yok.

export const TRIAL_BANNER_COOKIE = "lx_trial_banner_snooze";
export const TRIAL_BANNER_SNOOZE_SECONDS = 4 * 60 * 60;

/**
 * Deneme bandı gösterilsin mi? Süre DOLMUŞSA (0 gün) kapatma yok sayılır: o durumda bant bir hatırlatma değil,
 * otomatik mesajların durmak üzere olduğunun tek işaretidir.
 */
export function showTrialBanner(opts: { trialing: boolean; daysLeft: number | null; snoozed: boolean }): boolean {
  if (!opts.trialing || opts.daysLeft == null) return false;
  if (opts.daysLeft <= 0) return true;
  return !opts.snoozed;
}

/** Bant yalnız süre dolmamışken kapatılabilir. */
export function trialBannerDismissible(daysLeft: number): boolean {
  return daysLeft > 0;
}

/** Kapatma çerezi (yol tüm uygulama; 4 saatlik ömür; yalnız aynı site). */
export function trialBannerSnoozeCookie(secure: boolean): string {
  return `${TRIAL_BANNER_COOKIE}=1; Path=/; Max-Age=${TRIAL_BANNER_SNOOZE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
