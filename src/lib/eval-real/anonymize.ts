// ---------------------------------------------------------------------------
// GERÇEK MİSAFİR MESAJI ANONİMLEŞTİRİCİSİ (09-24, kurucu: "host hesabımdaki mesajları salt okuma ile
// kullanalım"). Saf: ağ yok, DB yok, `server-only` yok — operatör betiği (`scripts/eval-real-export.ts`)
// kurucunun makinesinde çalıştırır. Çıktı yalnız yerel, git'e girmeyen `evals/private/` altına yazılır.
//
// Amaç: konaklama değişikliği eval'i için mesajın ANLAMI kalır (saat, tarih, küçük sayılar, dil), kişiyi ya da
// yeri gösteren her şey gider. Anonimleştirme kusursuz OLAMAZ (serbest metindeki "Ahmet bey" gibi adlar
// yakalanamaz) → son kapı insandır: etiketleme aracında kurucu "kişisel bilgi kaldı" diyerek öğeyi çıkarır.
//
// Kurallar:
//  · Bilinen adlar (misafir, ev sahibi / ekip, mülk, işletme) — tam ad + her anlamlı parçası. Kısa ya da
//    yaygın sözcük olan ad parçası ("Can", "Will", "May") yalnız TAM ADLA eşleşir: "Can we check in early?"
//    cümlesini bozmamak için. İşletmenin gerçek adı yalnız çalışma anında DB'den gelir, koda YAZILMAZ.
//  · E-posta, bağlantı, IBAN, rezervasyon kodu, harf+rakam kodu (Wi-Fi şifresi, kapı kodu), 4+ haneli sayı ve
//    telefon biçimli diziler maskelenir. Geçerli tarih/saat dizileri ve 1–3 haneli yalın sayılar ("11 gibi",
//    "2 kişi", "3'te") KORUNUR — tek kaynak `ai/semantic/date-time-tokens.ts`.
// ---------------------------------------------------------------------------

import { isProtectedNumericRun, NUMERIC_RUN } from "@/lib/ai/semantic/date-time-tokens";

export const ANON = {
  person: "[AD]",
  place: "[MÜLK]",
  email: "[E-POSTA]",
  url: "[BAĞLANTI]",
  iban: "[IBAN]",
  number: "[NUMARA]",
  code: "[KOD]",
} as const;

export interface AnonymizeContext {
  /** Misafirin görünen adı, rezervasyondaki ad, ev sahibi ve ekip üyelerinin adları. */
  personNames: readonly string[];
  /** Mülk adları, işletme adı, adres satırları. */
  placeNames: readonly string[];
}

/**
 * Ad PARÇASI olarak tek başına aranmayacak yaygın sözcükler (EN/TR/DE/FR/ES). Tam adla eşleşme sürer.
 * Kapalı liste: amaç "Can we…" / "Will you…" / "Deniz manzarası" gibi cümleleri bozmamak.
 */
const COMMON_WORDS = new Set([
  "can", "will", "may", "june", "april", "august", "mark", "bill", "hope", "joy", "rose", "grace", "faith", "summer",
  "sunny", "honey", "star", "sky", "ray", "art", "max", "don", "sue", "pat", "dawn", "eve", "iris", "ali", "may",
  "deniz", "umut", "bahar", "yaz", "ay", "gül", "ilk", "nur", "su", "can", "ece", "ege", "gece", "sevgi", "barış",
  "aslan", "kaya", "yıldız", "güneş", "doğan", "tan", "ege", "derya", "ozan", "onur", "ümit", "şeker",
  "home", "house", "apart", "apartment", "suite", "suites", "residence", "flat", "loft", "studio", "villa", "otel",
  "hotel", "ev", "daire", "rezidans", "konak", "pansiyon", "the", "and", "und", "der", "die", "das", "le", "la", "les",
  "el", "los", "las", "de", "del", "di", "da", "van", "von",
]);

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}⠀]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/giu;
/** Airbnb onay kodu biçimi (HM + 8) ve genel harf+rakam kodları (≥ 5 karakter, en az bir harf VE bir rakam). */
const RES_CODE_RE = /\bHM[A-Z0-9]{8}\b/gu;
const ALNUM_TOKEN = /[\p{L}\p{N}]+/gu;

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

/**
 * Bir addan aranacak biçimler: tam ad + anlamlı parçalar (≥ 3 harf, yaygın sözcük değil) + her birinin
 * Türkçe-küçük ve ASCII-katlanmış biçimi (JS `iu` bayrağı "İ"yi "i" ile eşlemez). Uzun olan önce.
 */
export function nameVariants(names: readonly string[]): string[] {
  const out = new Set<string>();
  const add = (v: string) => {
    for (const x of [v, v.toLocaleLowerCase("tr"), foldTr(v)]) if (x.length >= 3) out.add(x);
  };
  for (const raw of names) {
    const full = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    if (full.length < 3) continue;
    add(full);
    for (const part of full.split(/[\s,/()&+-]+/)) {
      const p = part.trim();
      if (p.length < 3 || /^\d+$/.test(p)) continue;
      if (COMMON_WORDS.has(p.toLocaleLowerCase("tr")) || COMMON_WORDS.has(p.toLowerCase())) continue;
      add(p);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

function replaceNames(text: string, names: readonly string[], mark: string): string {
  let out = text;
  for (const n of nameVariants(names)) {
    // Kelime sınırı Unicode harf/rakam üzerinden (Türkçe ekler "Ayşe'ye" ayrı kalır: kesme sınırdır).
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "giu"), mark);
  }
  return out;
}

export function anonymizeGuestText(text: string, ctx: AnonymizeContext): string {
  let out = text.normalize("NFC").replace(INVISIBLE, "").replace(CONTROL, " ");
  // Bağlantının sonundaki noktalama cümleye aittir ("…/rooms/1, IBAN") — maskeden sonra geri konur.
  out = out.replace(URL_RE, (m) => ANON.url + (/[.,;:!?]+$/.exec(m)?.[0] ?? "")).replace(EMAIL_RE, ANON.email).replace(IBAN_RE, ANON.iban).replace(RES_CODE_RE, ANON.code);
  // Yer adları önce: işletme adı bir kişi adını da içerebilir, daha uzun/özgül olan önce gider.
  out = replaceNames(out, ctx.placeNames, ANON.place);
  out = replaceNames(out, ctx.personNames, ANON.person);
  // Harf + rakam karışık kodlar (Wi-Fi şifresi "Lale2024", kapı kodu "A7F3K"): ≥ 5 karakter. "11am", "3pm",
  // "14th" gibi kısa saat/sıra biçimleri (≤ 4) korunur.
  out = out.replace(ALNUM_TOKEN, (tok) => (tok.length >= 5 && /\p{L}/u.test(tok) && /\p{N}/u.test(tok) ? ANON.code : tok));
  // Rakam dizileri: geçerli tarih/saat (tek kaynak) kalır. Diğer diziler telefon biçimliyse (toplam ≥ 7 rakam) ya da
  // 4+ haneli bir grup taşıyorsa (kapı kodu, yıl, hesap no) maskelenir; "14 - 16 Ekim", "11 gibi", "2 kişi" kalır.
  out = out.replace(new RegExp(NUMERIC_RUN.source, "g"), (run) => {
    if (isProtectedNumericRun(run)) return run;
    const groups = run.match(/\d+/g) ?? [];
    const digits = groups.join("").length;
    return digits >= 7 || groups.some((g) => g.length >= 4) ? ANON.number : run;
  });
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
