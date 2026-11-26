// Deneme bandının kuralı. Saf + istemci-güvenli (server-only YOK): düzen (sunucu) çerezi okur, bant (istemci) yazar.
//
// UX-8 (kurucu 11-13: "milyarlık web siteleri nasıl yapıyorsa öyle yap"): eskiden bant denemenin 14 günü boyunca HER GÜN aynı tonda
// görünüyor, kapatılınca 4 saat sonra geri geliyordu. Büyük ürünlerin kalıbı (Slack: menüde sakin bitiş tarihi; Canva: bitişten 7 gün önce
// hatırlatma; Shopify: son günlerde şerit): ilk yarıda yalnız küçük kalıcı gösterge (kenar çubuğu rozeti — bizde zaten var), bitişe
// yaklaşınca kademeli şerit, bitişte tek net sonuç cümlesi. Araştırma: scratchpad/handoff/UX-8-12-deneme-skor.md.
//
//   kalan gün   aşama   bant                      kapatma
//   14 → 8      calm    YOK (yalnız rozet)        —
//    7 → 4      info    nötr                      24 saat
//    3 → 2      warn    amber                     12 saat
//    1          last    amber, kalın              4 saat
//    0          ended   yalnız faturalandırma ZORUNLUYSA (yoksa hiçbir şey durmaz → "süreniz doldu" baskısı yanlış olurdu);
//                       kapatılamaz. Zorunluyken müşteri zaten "sınırlı mod" bandını görür — bu dal operatör görünümü içindir.
//
// Neden çerez (tarayıcı deposu değil): düzen SUNUCUDA çizilir; kapatılmış bant yenilemede hiç çizilmez (titreme yok). Çerezin değeri
// kapatıldığı AŞAMANIN adıdır: aşama değişince (ör. 5. günde kapatıldı, 3. güne girildi) eski çerez geçersiz olur ve bant tonu değiştiği için
// yeniden görünür. Kişisel veri yok.

export const TRIAL_BANNER_COOKIE = "lx_trial_banner_snooze";

export type TrialBannerStage = "calm" | "info" | "warn" | "last" | "ended";

/** Kapatılabilen aşamalarda kapatma süresi (saniye): bitişe yaklaştıkça kısalır. */
export const TRIAL_BANNER_SNOOZE_SECONDS: Record<"info" | "warn" | "last", number> = {
  info: 24 * 60 * 60,
  warn: 12 * 60 * 60,
  last: 4 * 60 * 60,
};

export function trialBannerStage(daysLeft: number): TrialBannerStage {
  if (daysLeft <= 0) return "ended";
  if (daysLeft === 1) return "last";
  if (daysLeft <= 3) return "warn";
  if (daysLeft <= 7) return "info";
  return "calm";
}

/** Deneme bandı gösterilsin mi? `snoozedStage`: çerezdeki değer (kapatıldığı aşama) ya da yok. */
export function showTrialBanner(opts: {
  trialing: boolean;
  daysLeft: number | null;
  snoozedStage: string | null | undefined;
  /** Faturalandırma zorunlu mu (`BILLING_ENFORCED`) — süre dolunca bir şey gerçekten duruyor mu. */
  enforced: boolean;
}): boolean {
  if (!opts.trialing || opts.daysLeft == null) return false;
  const stage = trialBannerStage(opts.daysLeft);
  if (stage === "calm") return false;
  if (stage === "ended") return opts.enforced;
  return opts.snoozedStage !== stage;
}

/** Bant yalnız süre dolmamışken kapatılabilir. */
export function trialBannerDismissible(daysLeft: number): boolean {
  return trialBannerStage(daysLeft) !== "ended";
}

/** Kapatma çerezi: değeri aşama, ömrü aşamaya göre; yol tüm uygulama; yalnız aynı site. */
export function trialBannerSnoozeCookie(secure: boolean, stage: "info" | "warn" | "last"): string {
  return `${TRIAL_BANNER_COOKIE}=${stage}; Path=/; Max-Age=${TRIAL_BANNER_SNOOZE_SECONDS[stage]}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Bitiş tarihi, işletmenin saat diliminde: "18 Kasım". */
export function trialEndLabel(endsAt: Date, tz: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: tz }).format(endsAt);
}

/** Son günde "bugün" mü "yarın" mı (işletmenin takvim gününe göre; kalan süre 24 saatten az olsa da bitiş yarına düşebilir). */
export function trialEndDayWord(endsAt: Date, now: Date, tz: string): "bugün" | "yarın" {
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d);
  return key(endsAt) === key(now) ? "bugün" : "yarın";
}
