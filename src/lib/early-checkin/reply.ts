// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — ONAY METNİ KODDA KURULUR (09-24). Model metni DEĞİL: yalnız doğrulanmış veri
// (onaylanan saat, "daire hazır" işareti) ve host'un KAYITLI kuralı (ücret, host notu) girer. Böylece "cevap bu
// verilere uygun mu?" sorusu yapıdan cevaplanır: metinde uydurma saat, takvim iddiası ya da tutar olamaz.
//
// Diller bekletme mesajlarıyla aynı altı dil (tr, en, de, fr, ar, ru); tanınmayan → en. Cümleler cinsiyet
// varsaymaz (ev sahibini ya da yazanı erkek varsayan kuruluşlar 08-08 denetiminde düzeltildi — aynı kural).
// Ücret yalnız host'un girdiği tutar/para birimiyle biçimlenir (rakamlar Latin); yapay zekâ hesaplamaz.
// ---------------------------------------------------------------------------

import type { EarlyCheckinDecision, EarlyCheckinRule } from "./core";

export const EARLY_CHECKIN_LANGS = ["tr", "en", "de", "fr", "ar", "ru"] as const;
export type EarlyCheckinLang = (typeof EARLY_CHECKIN_LANGS)[number];

// Selamsız (konuşmanın ortasında tekrar selam verilmez — `isFirstOperatorReply` kuralı) ve GÜNÜ adlandırır: onay
// yalnız bugünkü varış içindir; başka bir gün / başka bir konaklama sanılmasın (inceleme 09-24).
const APPROVED: Record<EarlyCheckinLang, (time: string, day: string) => string> = {
  tr: (t, d) => `Daireniz hazır; bugün (${d}) saat ${t} itibarıyla giriş yapabilirsiniz.`,
  en: (t, d) => `The apartment is ready — you can check in today (${d}) from ${t}.`,
  de: (t, d) => `Die Wohnung ist bereit – Sie können heute (${d}) ab ${t} Uhr einchecken.`,
  fr: (t, d) => `Le logement est prêt : vous pouvez arriver aujourd'hui (${d}) à partir de ${t}.`,
  ar: (t, d) => `الشقة جاهزة ويمكنكم تسجيل الدخول اليوم (${d}) ابتداءً من الساعة ${t}.`,
  ru: (t, d) => `Квартира готова — сегодня (${d}) заезд возможен с ${t}.`,
};

const FEE: Record<EarlyCheckinLang, (fee: string) => string> = {
  tr: (f) => `Erken giriş ücreti ${f}.`,
  en: (f) => `The early check-in fee is ${f}.`,
  de: (f) => `Die Gebühr für den frühen Check-in beträgt ${f}.`,
  fr: (f) => `Les frais d'arrivée anticipée s'élèvent à ${f}.`,
  ar: (f) => `رسوم تسجيل الدخول المبكر ${f}.`,
  ru: (f) => `Стоимость раннего заезда — ${f}.`,
};

const LOCALE: Record<EarlyCheckinLang, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  ar: "ar-u-nu-latn",
  ru: "ru-RU",
};

export function earlyCheckinLang(detected: string | null | undefined): EarlyCheckinLang {
  const code = (detected ?? "").trim().toLowerCase().slice(0, 2);
  return (EARLY_CHECKIN_LANGS as readonly string[]).includes(code) ? (code as EarlyCheckinLang) : "en";
}

/** Host'un tutarı: tam sayıysa kuruşsuz, değilse iki hane; para birimi host'un seçtiği (rakamlar Latin). */
export function formatEarlyCheckinFee(fee: NonNullable<EarlyCheckinRule["fee"]>, lang: EarlyCheckinLang): string {
  const whole = Number.isInteger(fee.amount);
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency: fee.currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(fee.amount);
}

/** Takvim günü ("2026-10-14") → misafirin dilinde gün + ay ("14 Ekim"); rakamlar Latin. */
export function formatEarlyCheckinDay(dayKey: string, lang: EarlyCheckinLang): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  // Öğlen UTC + UTC dilimi: gün hiçbir dilimde kaymaz (tarih anahtarı zaten mülkün kendi günüdür).
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/**
 * Onay metni — YALNIZ `approvable` karar için. Başka her durumda `null` (çağıran insan akışına döner).
 * Host notu (varsa) en sona OLDUĞU GİBİ eklenir: host'un kendi sözüdür, kayıtta ödeme yöntemi ve çıktı vetosu
 * süzgecinden geçti. `dayKey` = mülk takviminde bugün (varış günü; karar bunu zaten doğruladı).
 */
export function earlyCheckinApprovalText(
  decision: EarlyCheckinDecision,
  lang: EarlyCheckinLang,
  note: string | null,
  dayKey: string,
): string | null {
  if (decision.status !== "approvable" || !decision.approvedTime) return null;
  const parts = [APPROVED[lang](decision.approvedTime, formatEarlyCheckinDay(dayKey, lang))];
  if (decision.fee) parts.push(FEE[lang](formatEarlyCheckinFee(decision.fee, lang)));
  const n = note?.trim();
  if (n) parts.push(n);
  return parts.join(" ");
}
