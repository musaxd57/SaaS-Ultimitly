// ---------------------------------------------------------------------------
// GERÇEK MİSAFİR MESAJI ANONİMLEŞTİRİCİSİ (09-24, kurucu: "host hesabımdaki mesajları salt okuma ile
// kullanalım"). Saf: ağ yok, DB yok, `server-only` yok — operatör betiği (`scripts/eval-real-export.ts`)
// kurucunun makinesinde çalıştırır. Çıktı yalnız yerel, git'e girmeyen `evals/private/` altına yazılır.
//
// Amaç: konaklama değişikliği eval'i için mesajın ANLAMI kalır (saat, tarih, küçük sayılar, dil), kişiyi ya da
// yeri gösteren her şey gider. Anonimleştirme kusursuz OLAMAZ (serbest metindeki tanınmayan adlar yakalanamaz) →
// son kapı insandır: etiketleme aracında kurucu "kişisel bilgi kaldı" diyerek öğeyi çıkarır.
//
// Kurallar (düşmanca inceleme 09-24 sonrası):
//  · Bilinen KİŞİ adları: tam ad + her anlamlı parçası; Türkçe büyük/küçük harf (İ/ı — JS `iu` bayrağı eşlemez) ve
//    ASCII yazım biçimleri; kesmesiz Türkçe hâl ekleri ("Fatihle", "Ayşeye"). Hem ad hem sıradan sözcük olan parçalar
//    ("Can", "Deniz", "Kaya", "Will") yalnız AD KONUMUNDA maskelenir: büyük harfle ve cümle başında DEĞİL — "Can we
//    check in early?" bozulmaz, "Ben Can" maskelenir.
//  · Sistemin kendi yer tutucu adları ("Misafir", "Eski misafir", "Rezervasyon <kod>") ad SAYILMAZ; koddaki kod ayrıca
//    maskelenir.
//  · YER adları (mülk, işletme, adres): tam ad + İLK ayırt edici parça ("Lale Stay" → "Lale"); "Stay/Home/Suites"
//    gibi genel sözcükler tek başına maskelenmez. İşletmenin gerçek adı yalnız çalışma anında DB'den gelir.
//  · E-posta, bağlantı, IBAN, plaka, rezervasyon kodu, harf+rakam kodu (Wi-Fi şifresi, kapı kodu), telefon biçimli
//    diziler, 4+ haneli sayılar, 3+ parçalı rakam dizileri ("4 8 2 6") ve GEÇMİŞ yıllı tarihler (doğum tarihi)
//    maskelenir. Geçerli tarih/saat dizileri, yakın tarihler ve küçük sayılar ("11 gibi", "14 - 16 Ekim", "2 kişi")
//    ile saat/süre biçimleri ("13h30", "11Uhr", "2nights", "1gece") KORUNUR. Tarih/saat kuralı tek kaynak
//    `ai/semantic/date-time-tokens.ts`. Arap-Hint ve tam genişlikli rakamlar önce ASCII'ye çevrilir.
// ---------------------------------------------------------------------------

import { isProtectedNumericRun, NUMERIC_RUN_SOURCE } from "@/lib/ai/semantic/date-time-tokens";

export const ANON = {
  person: "[AD]",
  place: "[MÜLK]",
  email: "[E-POSTA]",
  url: "[BAĞLANTI]",
  iban: "[IBAN]",
  number: "[NUMARA]",
  code: "[KOD]",
  date: "[TARİH]",
} as const;

export interface AnonymizeContext {
  /** Misafirin görünen adı, rezervasyondaki ad, ev sahibi ve ekip üyelerinin adları. */
  personNames: readonly string[];
  /** Mülk adları, işletme adı, adres satırları. */
  placeNames: readonly string[];
  /** Geçmiş-yıl kuralı için bugünün yılı (varsayılan: şimdi). Testlerde sabitlenir. */
  nowYear?: number;
}

/** Tek başına HİÇ maskelenmeyen parçalar: işlev sözcükleri ve konaklama / adres genel sözcükleri. */
const NEVER_ALONE = new Set([
  "the", "and", "und", "der", "die", "das", "le", "la", "les", "el", "los", "las", "de", "del", "di", "da", "van", "von",
  "home", "house", "apart", "apartment", "apartments", "suite", "suites", "residence", "residences", "flat", "flats",
  "loft", "studio", "villa", "hotel", "otel", "ev", "evi", "evleri", "daire", "daireleri", "rezidans", "konak", "konağı",
  "pansiyon", "stay", "stays", "rooms", "room", "oda", "odalar", "inn", "lodge", "hostel", "butik", "boutique", "cad",
  "caddesi", "sok", "sokak", "sokağı", "mah", "mahallesi", "no", "kat", "blok", "street", "st", "road", "avenue",
]);

/**
 * Hem ad hem sıradan sözcük olan parçalar: YALNIZ ad konumunda (büyük harf + cümle başı değil) maskelenir.
 * Kapalı liste; amaç "Can we…", "Will you…", "deniz manzarası" gibi cümleleri bozmamak.
 */
const AMBIGUOUS_NAME_WORDS = new Set([
  "can", "will", "may", "june", "april", "august", "mark", "bill", "hope", "joy", "rose", "grace", "faith", "summer",
  "sunny", "honey", "star", "sky", "ray", "art", "max", "don", "sue", "pat", "dawn", "eve", "iris", "deniz", "umut",
  "bahar", "yaz", "ay", "gül", "nur", "su", "ece", "ege", "gece", "sevgi", "barış", "aslan", "kaya", "yıldız", "güneş",
  "doğan", "tan", "derya", "ozan", "onur", "ümit", "şeker", "ilk", "cem", "ada", "ırmak", "bulut", "toprak", "çınar",
]);

/** Sistemin yer tutucu adları — gerçek kişi adı değil (`ingest/write-service.ts`, `data-retention.ts`). */
const PLACEHOLDER_NAME = /^(?:misafir|eski misafir|\[misafir\]|guest|anonim|anonymous|bilinmeyen|unknown)$/iu;
const PLACEHOLDER_RESERVATION = /^(?:rezervasyon|reservation)\s+(\S+)$/iu;

/** Türkçe hâl ve iyelik ekleri (kesmesiz yazım: "Fatihle", "Ayşeye", "Mehmetin"). Kapalı küme. */
const TR_SUFFIX =
  "(?:ler|lar)?(?:ın|in|un|ün|nın|nin|nun|nün|ı|i|u|ü|yı|yi|yu|yü|a|e|ya|ye|da|de|ta|te|dan|den|tan|ten|la|le|yla|yle|ca|ce|ça|çe)?";

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}⠀]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/giu;
/** Türkiye plakası biçimi ("34 ABC 123", "06AB1234"). */
const PLATE_RE = /(?<![\p{L}\p{N}])\d{2}\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}(?![\p{L}\p{N}])/gu;
/** Airbnb onay kodu biçimi (HM + 8). */
const RES_CODE_RE = /\bHM[A-Z0-9]{8}\b/gu;
const ALNUM_TOKEN = /[\p{L}\p{N}]+/gu;
/** Saat / süre / kişi / sıra biçimleri: rakam + kapalı birim listesi (harf+rakam KOD sayılmaz). */
const TIME_OR_UNIT_TOKEN =
  /^(?:\d{1,2}h\d{2}|\d{1,2}(?:h|hs|hrs?|uhr|am|pm|saat|sa)|\d{1,3}(?:nights?|nuits?|noches?|nächte|naechte|nachte|gece|gun|gün|days?|tage?|jours?|dias?|días?|kisi|kişi|people|persons?|pax|adults?|kids?|cocuk|çocuk|min|mins?|minutes?|dk|dakika|hours?|stunden?|heures?|horas?|th|st|nd|rd))$/iu;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Türkçe harfleri ASCII'ye katlar: misafirler adları çoğu zaman Türkçe harfsiz yazar ("Ayse", "Sukru"). */
function foldTr(s: string): string {
  return s
    .replace(/[çÇ]/g, (c) => (c === "ç" ? "c" : "C"))
    .replace(/[ğĞ]/g, (c) => (c === "ğ" ? "g" : "G"))
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/[öÖ]/g, (c) => (c === "ö" ? "o" : "O"))
    .replace(/[şŞ]/g, (c) => (c === "ş" ? "s" : "S"))
    .replace(/[üÜ]/g, (c) => (c === "ü" ? "u" : "U"));
}

/** Arap-Hint (٠-٩, ۰-۹) ve tam genişlikli rakamları ASCII'ye çevirir (telefon bu yazımla kaçmasın). */
function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
}

const lowerTr = (s: string) => s.toLocaleLowerCase("tr");

/** Bir biçimin arama varyantları: kendisi, Türkçe küçük/büyük harf ve ASCII katlamaları. */
function caseVariants(v: string): string[] {
  const out = new Set<string>();
  for (const x of [v, lowerTr(v), v.toLocaleUpperCase("tr")]) {
    out.add(x);
    out.add(foldTr(x));
  }
  return [...out].filter((x) => x.length >= 2);
}

export interface NameVariants {
  /** Her yerde maskelenen biçimler (uzun olan önce). */
  anywhere: string[];
  /** Yalnız AD KONUMUNDA (büyük harf, cümle başı değil) maskelenen yaygın sözcük adlar. */
  namePosition: string[];
  /** Yer tutucu adlardan ayıklanan rezervasyon kodları (kod olarak maskelenir). */
  codes: string[];
}

/**
 * Ad listesinden arama biçimleri. `place` = yer adı kipi: tam ad + İLK ayırt edici parça (genel sözcükler tek
 * başına maskelenmez); kişi kipinde tam ad + her anlamlı parça.
 */
export function nameVariants(names: readonly string[], opts: { place?: boolean } = {}): NameVariants {
  const anywhere = new Set<string>();
  const namePosition = new Set<string>();
  const codes = new Set<string>();
  const isAmbiguous = (p: string) => AMBIGUOUS_NAME_WORDS.has(lowerTr(p)) || AMBIGUOUS_NAME_WORDS.has(p.toLowerCase());
  const isNever = (p: string) => NEVER_ALONE.has(lowerTr(p)) || NEVER_ALONE.has(p.toLowerCase());
  for (const raw of names) {
    const full = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    if (full.length < 2 || PLACEHOLDER_NAME.test(full)) continue;
    const reservation = PLACEHOLDER_RESERVATION.exec(full);
    if (reservation) {
      codes.add(reservation[1]);
      continue;
    }
    const parts = full.split(/[\s,/()&+-]+/).map((p) => p.trim()).filter((p) => p.length >= 2 && !/^\d+$/.test(p));
    // Tek parçalı ad yaygın bir sözcükse ("Can") tam ad da yalnız ad konumunda aranır.
    if (parts.length === 1 && isAmbiguous(parts[0])) {
      for (const v of caseVariants(parts[0])) namePosition.add(v);
      continue;
    }
    if (full.length >= 3) for (const v of caseVariants(full)) anywhere.add(v);
    const candidates = opts.place ? parts.filter((p) => !isNever(p) && !isAmbiguous(p)).slice(0, 1) : parts;
    for (const p of candidates) {
      if (p.length < 3 || isNever(p)) continue;
      for (const v of caseVariants(p)) (isAmbiguous(p) ? namePosition : anywhere).add(v);
    }
  }
  const byLength = (a: string, b: string) => b.length - a.length;
  return { anywhere: [...anywhere].sort(byLength), namePosition: [...namePosition].sort(byLength), codes: [...codes] };
}

function replaceNames(text: string, v: NameVariants, mark: string): string {
  let out = text;
  for (const n of v.anywhere) {
    // Kelime sınırı Unicode harf/rakam üzerinden; ardından isteğe bağlı Türkçe ek ("Fatihle"; "Ayşe'ye" — kesme sınırdır).
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}${TR_SUFFIX}(?![\\p{L}\\p{N}])`, "giu"), mark);
  }
  for (const n of v.namePosition) {
    // AD KONUMU: büyük harfle başlayan biçim, öncesinde bir sözcük + boşluk (cümle başı DEĞİL); harf DUYARLI.
    const cap = n.charAt(0).toLocaleUpperCase("tr") + n.slice(1);
    if (cap === n.toLocaleLowerCase("tr")) continue;
    out = out.replace(new RegExp(`(?<=[\\p{L}\\p{N},;:)'’]\\s+)${escapeRe(cap)}${TR_SUFFIX}(?![\\p{L}\\p{N}])`, "gu"), mark);
  }
  for (const c of v.codes) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(c)}(?![\\p{L}\\p{N}])`, "giu"), ANON.code);
  return out;
}

/** Tarih dizisindeki yıl GEÇMİŞTE mi (doğum tarihi vb.): 4 haneli yıl ≤ bu yıl − 2; 2 haneli yıl > bu yıl + 1 (19xx). */
function hasPastYear(run: string, nowYear: number): boolean {
  for (const m of run.matchAll(/\d+/g)) {
    if (m[0].length === 4 && Number(m[0]) >= 1900 && Number(m[0]) <= nowYear - 2) return true;
  }
  const dmy = /(?:^|\D)\d{1,2}[./-]\d{1,2}[./-](\d{2})(?!\d)/.exec(run);
  return dmy !== null && Number(dmy[1]) > (nowYear % 100) + 1;
}

export function anonymizeGuestText(text: string, ctx: AnonymizeContext): string {
  const nowYear = ctx.nowYear ?? new Date().getFullYear();
  let out = asciiDigits(text.normalize("NFKC")).normalize("NFC").replace(INVISIBLE, "").replace(CONTROL, " ");
  // Bağlantının sonundaki noktalama cümleye aittir ("…/rooms/1, IBAN") — maskeden sonra geri konur.
  out = out
    .replace(URL_RE, (m) => ANON.url + (/[.,;:!?]+$/.exec(m)?.[0] ?? ""))
    .replace(EMAIL_RE, ANON.email)
    .replace(IBAN_RE, ANON.iban)
    .replace(RES_CODE_RE, ANON.code)
    .replace(PLATE_RE, ANON.code);
  // Yer adları önce: işletme adı bir kişi adını da içerebilir, daha uzun/özgül olan önce gider.
  out = replaceNames(out, nameVariants(ctx.placeNames, { place: true }), ANON.place);
  out = replaceNames(out, nameVariants(ctx.personNames), ANON.person);
  // Harf + rakam karışık kodlar (Wi-Fi şifresi "Lale2024", kapı kodu "A7F3K"): ≥ 5 karakter. Saat/süre biçimleri
  // ("13h30", "11Uhr", "2nights", "1gece") ve kısa saat/sıra ("11am", "14th") KOD sayılmaz.
  out = out.replace(ALNUM_TOKEN, (tok) =>
    tok.length >= 5 && /\p{L}/u.test(tok) && /\p{N}/u.test(tok) && !TIME_OR_UNIT_TOKEN.test(tok) ? ANON.code : tok,
  );
  // Rakam dizileri: geçerli tarih/saat (tek kaynak) kalır — geçmiş yıllı tarih (doğum tarihi) hariç. Diğer diziler
  // telefon biçimliyse (toplam ≥ 7 rakam), 4+ haneli grup taşıyorsa (kapı kodu, yıl) ya da 3+ parçalıysa ("4 8 2 6")
  // maskelenir; "14 - 16 Ekim", "11 gibi", "2 kişi" kalır.
  out = out.replace(new RegExp(NUMERIC_RUN_SOURCE, "g"), (run) => {
    if (isProtectedNumericRun(run)) return hasPastYear(run, nowYear) ? ANON.date : run;
    const groups = run.match(/\d+/g) ?? [];
    const digits = groups.join("").length;
    return digits >= 7 || groups.length >= 3 || groups.some((g) => g.length >= 4) ? ANON.number : run;
  });
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
