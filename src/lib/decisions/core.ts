// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — SAF ÇEKİRDEK (Faz 1, kurucu 10-02 akşam: "panelde 'karar bekliyor' kartı ve Onayla / Reddet düğmeleri …
// en iyi en güzel şekilde doğru UX'li şekilde bitir"; tasarım `docs/TASARIM-2026-10-02-host-karar-motoru.md`, Faz 0 onay paketi
// `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md`). DB'siz, ağsız, modelsiz.
//
// Kurucunun tarifi: "Saat 13:00'te giriş yapabilir miyiz?" → cevap vermek talebi çözmek DEĞİLDİR. Misafir karar bekler; ev
// sahibi karar vermesi gerektiğini öğrenir: panelde "13:00 erken giriş — karar bekliyor" açık kalır, ev sahibine TEK bildirim
// gider (tekrar tekrar değil), ev sahibi onaylayınca ya da reddedince talep sonuçlanır.
//
//  · Karar YALNIZ ev sahibinindir: yapay zekâ karar vermez, karar metnini model YAZMAZ — onay / ret metni KODDA, doğrulanmış
//    veriden (gün, saat, ev sahibinin kayıtlı ücret kuralı) kurulur; ev sahibi göndermeden önce görür ve düzenleyebilir.
//  · Metin taşımaz: karar kaydı = kimlik + kapalı küme kodlar + saat / gün (misafir metni / adı YOK).
//  · "Ev sahibi yazdı", "gün geçti", "rezervasyon iptal" SAKLANMAZ, okuma anında türetilir (kaçan bir yazma yolu olamaz).
// ---------------------------------------------------------------------------

import { hhmmToMinutes, normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import type { StayRequestKind } from "@/lib/ai/availability-claims";

/** Kart açılan istek türleri (konuşma öğesi türleriyle aynı adlar). */
export const DECISION_KINDS = ["early_checkin", "late_checkout", "extend_stay", "date_change"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** Onay / ret metni KODDA kurulan türler. Uzatma ve tarih değişikliği kanalda değişiklik ister → metni ev sahibi yazar. */
export const TEXT_DECISION_KINDS: ReadonlySet<DecisionKind> = new Set<DecisionKind>(["early_checkin", "late_checkout"]);

/**
 * Saklanan durum:
 *  · pending            — karar bekliyor;
 *  · sending            — ev sahibi gönder dedi, gönderim sürüyor (CAS kilidi; çift tıklama ikinci kez gönderemez);
 *  · approved/declined  — karar verildi, mesaj misafire gitti;
 *  · send_unverified    — gönderim sonucu doğrulanamadı (mesaj ulaşmış OLABİLİR — ev sahibi konuşmayı kontrol eder);
 *  · superseded         — misafir aynı türde YENİ bir istek yazdı (yeni kart açıldı);
 *  · dismissed          — ev sahibi "gerek kalmadı / kendim hallettim" dedi;
 *  · resolved_by_policy — doğrulanmış otomatik onay (erken giriş kanıt modeli) gitti.
 */
export const DECISION_STATUSES = [
  "pending",
  "sending",
  "approved",
  "declined",
  "send_unverified",
  "superseded",
  "dismissed",
  "resolved_by_policy",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Görünen durum: saklanan + okuma anında türetilenler. */
export type EffectiveDecisionStatus = DecisionStatus | "host_replied" | "expired" | "cancelled";

export const DECISION_RESOLUTIONS = ["approve", "decline"] as const;
export type DecisionResolution = (typeof DECISION_RESOLUTIONS)[number];

export function isDecisionKind(v: unknown): v is DecisionKind {
  return typeof v === "string" && (DECISION_KINDS as readonly string[]).includes(v);
}

export function isDecisionStatus(v: unknown): v is DecisionStatus {
  return typeof v === "string" && (DECISION_STATUSES as readonly string[]).includes(v);
}

/** Konaklama değişikliği istek türü (kapının birleşim kuralı `stayRequestKinds`) → kart türü. Müsaitlik sorusu / tanınmayan tür kart açmaz. */
const STAY_TO_DECISION: Readonly<Partial<Record<StayRequestKind, DecisionKind>>> = {
  early_checkin: "early_checkin",
  late_checkout: "late_checkout",
  extend: "extend_stay",
  date_change: "date_change",
};

/** Bu turun istek türlerinden kart türleri (sabit sıra, tekil). */
export function decisionKindsOf(kinds: Iterable<StayRequestKind>): DecisionKind[] {
  const set = new Set<DecisionKind>();
  for (const k of kinds) {
    const d = STAY_TO_DECISION[k];
    if (d) set.add(d);
  }
  return DECISION_KINDS.filter((k) => set.has(k));
}

/**
 * İstenen saat: model okumalarının (anlama katmanı + bekçi) anlaştığı saat; okuma yoksa / çelişkiliyse `null` — ev sahibi kartta
 * saati kendisi seçer (tahmin YOK). Deterministik yedek: misafirin yazdığı TEK açık saat, tek adaylıysa ("13:00"; "2'de" iki
 * adaylı → yok).
 */
export function requestedTimeOf(
  readings: readonly (string | null | undefined)[],
  explicitMentions: readonly (readonly number[])[] = [],
): string | null {
  const times = [...new Set(readings.map((t) => normalizeHhmm(t)).filter((t): t is string => t !== null))];
  if (times.length === 1) return times[0];
  if (times.length > 1) return null;
  if (explicitMentions.length === 1 && explicitMentions[0].length === 1) {
    const m = explicitMentions[0][0];
    return normalizeHhmm(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`);
  }
  return null;
}

/** Kartın hedef takvim günü: erken giriş = varış günü; geç çıkış / uzatma = çıkış günü; tarih değişikliği = yok. */
export function decisionDayKey(
  kind: DecisionKind,
  reservation: { arrivalKey: string; departureKey: string } | null,
): string | null {
  if (!reservation) return null;
  if (kind === "early_checkin") return reservation.arrivalKey;
  if (kind === "late_checkout" || kind === "extend_stay") return reservation.departureKey;
  return null;
}

/**
 * Görünen durum. Yalnız AÇIK (pending) kart türetilir: ev sahibi talepten SONRA yazdıysa "yanıtladınız" (kurucu kararı 09-26
 * öğelerdeki gibi — tıklama gerekmez), rezervasyon iptalse "iptal", hedef gün geçtiyse "süresi geçti". Sonuçlanmış kart aynen.
 */
export function effectiveDecisionStatus(
  status: DecisionStatus,
  ctx: {
    hostRepliedAfter: boolean;
    reservationCancelled: boolean;
    dayKey: string | null;
    todayKey: string;
    /** Kart `sending`te `DECISION_SENDING_STALE_MS`den uzun kaldı (gönderim sırasında süreç düştü). */
    sendingStale?: boolean;
  },
): EffectiveDecisionStatus {
  // Gönderim yarıda kaldı: mesaj gitmiş OLABİLİR — kart "gönderim doğrulanamadı" görünür (ev sahibi kanaldan bakıp kapatır;
  // kör tekrar yok). Taze `sending` (gönderim sürüyor) açık iş değildir.
  if (status === "sending") return ctx.sendingStale ? "send_unverified" : "sending";
  if (status !== "pending") return status;
  if (ctx.reservationCancelled) return "cancelled";
  if (ctx.dayKey !== null && ctx.dayKey < ctx.todayKey) return "expired";
  if (ctx.hostRepliedAfter) return "host_replied";
  return "pending";
}

/**
 * `sending` bu süreden uzunsa gönderim yarıda kalmıştır (ev sahibi gönderim çekirdeğinin talep süresi 120 sn; kanal çağrısı
 * dahil hiçbir gönderim bu kadar sürmez).
 */
export const DECISION_SENDING_STALE_MS = 5 * 60_000;

/** Ev sahibinin işi mi: karar bekleyen ya da gönderimi doğrulanamayan kart. */
export function isOpenDecision(status: EffectiveDecisionStatus): boolean {
  return status === "pending" || status === "send_unverified";
}

/** Ev sahibinin girdiği saat: yalnız geçerli "SS:DD" (00:00–23:59) → sıfır dolgulu; aksi hâlde `null`. */
export function parseHostTime(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim();
  if (!/^\d{1,2}:\d{2}$/.test(t)) return null;
  return hhmmToMinutes(t) === null ? null : normalizeHhmm(t);
}

/** Saat erken giriş için gerçekten standarttan önce mi / geç çıkış için sonra mı (kart uyarısı; karar ev sahibinin). */
export function timeOnRightSide(kind: DecisionKind, time: string | null, standard: string | null): boolean | null {
  const t = hhmmToMinutes(time);
  const s = hhmmToMinutes(standard);
  if (t === null || s === null) return null;
  if (kind === "early_checkin") return t < s;
  if (kind === "late_checkout") return t > s;
  return null;
}

// ── METİNLER — misafirin dilinde, KODDA (model yazmaz) ─────────────────────────────────────────────────────────────────
// Yedi dil (dil kapısının kesin tanıdığı diller); tanınmayan → İngilizce. Selamsız (konuşmanın ortasında). Günü ADLANDIRIR
// (başka gün / konaklama sanılmasın). Cinsiyet ve "ben/biz" varsaymaz (edilgen onay: ev sahibi bir kişi de şirket de olabilir).
// Türkçe saate ek yazılmaz ("13:00'te / 12:00'de" ünlü uyumu saate göre değişir — panel kuralı, inceleme 09-24).

export const DECISION_LANGS = ["tr", "en", "de", "fr", "es", "ru", "ar"] as const;
export type DecisionLang = (typeof DECISION_LANGS)[number];

export function decisionLang(detected: string | null | undefined): DecisionLang {
  const code = (detected ?? "").trim().toLowerCase().slice(0, 2);
  return (DECISION_LANGS as readonly string[]).includes(code) ? (code as DecisionLang) : "en";
}

const LOCALE: Record<DecisionLang, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  ru: "ru-RU",
  ar: "ar-u-nu-latn",
};

/** Ev sahibine gösterilen dil adı (kart). */
export const DECISION_LANG_LABELS_TR: Readonly<Record<DecisionLang, string>> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  fr: "Fransızca",
  es: "İspanyolca",
  ru: "Rusça",
  ar: "Arapça",
};

/** Takvim günü ("2026-10-14") → misafirin dilinde gün + ay ("14 Ekim"); rakamlar Latin, gün hiçbir dilimde kaymaz. */
export function formatDecisionDay(dayKey: string, lang: DecisionLang): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Ev sahibinin kayıtlı ücreti: tam sayıysa kuruşsuz, değilse iki hane; para birimi ev sahibinin seçtiği. */
export function formatDecisionFee(fee: { amount: number; currency: string }, lang: DecisionLang): string {
  const whole = Number.isInteger(fee.amount);
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency: fee.currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(fee.amount);
}

type Builder = (day: string, time: string) => string;

const EARLY_APPROVE: Record<DecisionLang, Builder> = {
  tr: (d, t) => `Erken giriş talebiniz onaylandı: ${d} günü saat ${t} itibarıyla giriş yapabilirsiniz.`,
  en: (d, t) => `Your early check-in is approved — you can check in on ${d} from ${t}.`,
  de: (d, t) => `Ihr früher Check-in ist bestätigt – Sie können am ${d} ab ${t} Uhr einchecken.`,
  fr: (d, t) => `Votre arrivée anticipée est confirmée : vous pouvez arriver le ${d} à partir de ${t}.`,
  es: (d, t) => `Su entrada anticipada está confirmada: el ${d} puede entrar a partir de las ${t}.`,
  ru: (d, t) => `Ранний заезд подтверждён: ${d} вы можете заселиться с ${t}.`,
  ar: (d, t) => `تمت الموافقة على تسجيل الدخول المبكر: يمكنكم تسجيل الدخول يوم ${d} ابتداءً من الساعة ${t}.`,
};

const EARLY_DECLINE: Record<DecisionLang, Builder> = {
  tr: (d, t) => `Maalesef ${d} günü erken giriş mümkün olmayacak; giriş saatimiz ${t}.`,
  en: (d, t) => `Unfortunately an early check-in won't be possible on ${d}; check-in is from ${t}.`,
  de: (d, t) => `Leider ist ein früher Check-in am ${d} nicht möglich; der Check-in ist ab ${t} Uhr.`,
  fr: (d, t) => `Malheureusement, une arrivée anticipée ne sera pas possible le ${d} ; l'arrivée se fait à partir de ${t}.`,
  es: (d, t) => `Lamentablemente, el ${d} no será posible una entrada anticipada; la entrada es a partir de las ${t}.`,
  ru: (d, t) => `К сожалению, ранний заезд ${d} невозможен; заезд с ${t}.`,
  ar: (d, t) => `للأسف لن يكون تسجيل الدخول المبكر ممكنًا يوم ${d}؛ يبدأ تسجيل الدخول من الساعة ${t}.`,
};

const LATE_APPROVE: Record<DecisionLang, Builder> = {
  tr: (d, t) => `Geç çıkış talebiniz onaylandı: ${d} günü çıkış saatiniz ${t}.`,
  en: (d, t) => `Your late check-out is approved — your check-out time on ${d} is ${t}.`,
  de: (d, t) => `Ihr später Check-out ist bestätigt – am ${d} ist Ihr Check-out um ${t} Uhr.`,
  fr: (d, t) => `Votre départ tardif est confirmé : le ${d}, votre départ est à ${t}.`,
  es: (d, t) => `Su salida tardía está confirmada: el ${d} puede dejar el alojamiento hasta las ${t}.`,
  ru: (d, t) => `Поздний выезд подтверждён: ${d} время выезда — ${t}.`,
  ar: (d, t) => `تمت الموافقة على تسجيل الخروج المتأخر: موعد خروجكم يوم ${d} هو الساعة ${t}.`,
};

const LATE_DECLINE: Record<DecisionLang, Builder> = {
  tr: (d, t) => `Maalesef ${d} günü geç çıkış mümkün olmayacak; çıkış saatimiz ${t}.`,
  en: (d, t) => `Unfortunately a late check-out won't be possible on ${d}; check-out is at ${t}.`,
  de: (d, t) => `Leider ist ein später Check-out am ${d} nicht möglich; der Check-out ist um ${t} Uhr.`,
  fr: (d, t) => `Malheureusement, un départ tardif ne sera pas possible le ${d} ; le départ est à ${t}.`,
  es: (d, t) => `Lamentablemente, el ${d} no será posible una salida tardía; la salida es a las ${t}.`,
  ru: (d, t) => `К сожалению, поздний выезд ${d} невозможен; выезд в ${t}.`,
  ar: (d, t) => `للأسف لن يكون تسجيل الخروج المتأخر ممكنًا يوم ${d}؛ موعد تسجيل الخروج هو الساعة ${t}.`,
};

const EARLY_FEE: Record<DecisionLang, (fee: string) => string> = {
  tr: (f) => `Erken giriş ücreti ${f}.`,
  en: (f) => `The early check-in fee is ${f}.`,
  de: (f) => `Die Gebühr für den frühen Check-in beträgt ${f}.`,
  fr: (f) => `Les frais d'arrivée anticipée s'élèvent à ${f}.`,
  es: (f) => `La tarifa por entrada anticipada es de ${f}.`,
  ru: (f) => `Стоимость раннего заезда — ${f}.`,
  ar: (f) => `رسوم تسجيل الدخول المبكر ${f}.`,
};

export interface DecisionTextInput {
  kind: DecisionKind;
  resolution: DecisionResolution;
  lang: DecisionLang;
  /** Hedef takvim günü (YYYY-MM-DD). */
  dayKey: string | null;
  /** Onayda ev sahibinin seçtiği saat; retde kullanılmaz. */
  time: string | null;
  /** Mülkün standart giriş (erken giriş) / çıkış (geç çıkış) saati — ret metni bunu söyler. */
  standardTime: string | null;
  /** Erken giriş onayında ev sahibinin KAYITLI ücreti (kural); yoksa ücret cümlesi yok — tutar uydurulmaz. */
  fee?: { amount: number; currency: string } | null;
  /** Ev sahibinin kayıtlı onay notu (erken giriş kuralı; süzgeçten geçmiş) — onayın sonuna olduğu gibi. */
  note?: string | null;
}

/**
 * Koddan kurulan karar metni. Kurulamazsa `null` (tür metin desteklemiyor, gün / saat eksik ya da geçersiz) — kart o zaman
 * yalnız "yanıtı siz yazın" der; boş ya da tahminli metin ÖNERİLMEZ.
 */
export function decisionMessageText(input: DecisionTextInput): string | null {
  if (!TEXT_DECISION_KINDS.has(input.kind) || !input.dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(input.dayKey)) return null;
  const day = formatDecisionDay(input.dayKey, input.lang);
  const approve = input.resolution === "approve";
  const time = normalizeHhmm(approve ? input.time : input.standardTime);
  if (!time) return null;
  const table =
    input.kind === "early_checkin" ? (approve ? EARLY_APPROVE : EARLY_DECLINE) : approve ? LATE_APPROVE : LATE_DECLINE;
  const parts = [table[input.lang](day, time)];
  if (approve && input.kind === "early_checkin") {
    if (input.fee && Number.isFinite(input.fee.amount) && input.fee.amount > 0) parts.push(EARLY_FEE[input.lang](formatDecisionFee(input.fee, input.lang)));
    const note = input.note?.trim();
    if (note) parts.push(note);
  }
  return parts.join(" ");
}

/** Kartın saat seçeneklerinin adımı (dakika). */
const TIME_STEP_MIN = 15;

/**
 * Kartın 24 saatlik saat seçenekleri (15 dk): erken girişte 06:00 → standart girişten önceki son adım; geç çıkışta standart
 * çıkıştan sonraki ilk adım → 23:45. Standart bilinmiyorsa makul varsayılan (giriş 15:00 / çıkış 11:00 varsayımıyla). Misafirin
 * istediği ya da seçili saat aralık dışındaysa da listede — ev sahibi misafirin yazdığını görsün (yanlış taraftaysa kart uyarır).
 */
export function decisionTimeOptions(kind: DecisionKind, standard: string | null, extra: readonly (string | null)[]): string[] {
  const std = hhmmToMinutes(standard);
  const [from, to] =
    kind === "early_checkin" ? [6 * 60, (std ?? 15 * 60) - TIME_STEP_MIN] : [(std ?? 11 * 60) + TIME_STEP_MIN, 23 * 60 + 45];
  const set = new Set<string>();
  for (let m = Math.ceil(from / TIME_STEP_MIN) * TIME_STEP_MIN; m <= to; m += TIME_STEP_MIN) {
    set.add(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  for (const e of extra) {
    const p = parseHostTime(e);
    if (p) set.add(p);
  }
  return [...set].sort();
}

// ── EV SAHİBİ GÖRÜNÜMÜ (Türkçe, sade — müşteriye giden metin kuralı) ───────────────────────────────────────────────────

export const DECISION_KIND_LABELS_TR: Readonly<Record<DecisionKind, string>> = {
  early_checkin: "Erken giriş",
  late_checkout: "Geç çıkış",
  extend_stay: "Konaklamayı uzatma",
  date_change: "Tarih değişikliği",
};

export const DECISION_STATUS_LABELS_TR: Readonly<Record<EffectiveDecisionStatus, string>> = {
  pending: "Karar bekliyor",
  sending: "Gönderiliyor",
  approved: "Onaylandı",
  declined: "Reddedildi",
  send_unverified: "Gönderim doğrulanamadı",
  superseded: "Yeni istekle değişti",
  dismissed: "Kapatıldı",
  resolved_by_policy: "Otomatik onaylandı",
  host_replied: "Yanıtladınız",
  expired: "Süresi geçti",
  cancelled: "Rezervasyon iptal",
};

/** Kart başlığı: "13:00 erken giriş — karar bekliyor" (saat bilinmiyorsa "Erken giriş — saat belirtilmedi"). */
export function decisionTitle(kind: DecisionKind, requestedTime: string | null): string {
  const label = DECISION_KIND_LABELS_TR[kind];
  const t = normalizeHhmm(requestedTime);
  if (t) return `${t} ${label.toLocaleLowerCase("tr-TR")}`;
  return TEXT_DECISION_KINDS.has(kind) ? `${label} — saat belirtilmedi` : label;
}
