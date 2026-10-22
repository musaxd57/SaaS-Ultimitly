// ---------------------------------------------------------------------------
// CEVAP PARÇASI DOĞRULAYICISI — değer ↔ konu ↔ koşul ↔ olumsuzluk ↔ yön (kurucu 10-23 A; saf, deterministik, LLM'siz).
//
// Kurucu (A, Codex notuyla): "Havuz sorusu → havuzun kapanış bilgisi → 20:00 → gönderilecek cevap. Saunanın 22:00 bilgisi gerçekten
// mevcut olsa bile havuza dayanak olamamalı. Saatin yanında hangi yere, hangi kurala ve koşula ait olduğu doğrulanmalı. Bunun farklı dilde,
// olumsuz ve koşullu cümlelerle test edilmesini isteyelim."
//
// Girdi: bir ihtiyacın cevap parçası + modelin o parça için gösterdiği DAYANAK ALINTISI + alıntının geldiği bilgi tabanı kaleminin metni +
// ihtiyacın kendi sözcükleri (`topic-absence.needTerms`) ve sözlük konuları. Kontroller (biri tutmazsa parça GİTMEZ, ihtiyaç ev sahibinde açık
// kalır — şüphede tut; yanlış tutma kabul, yanlış gönderme hata):
//   1. Alıntı kalemde gerçekten geçiyor (okuyucunun kanıt kuralının aynısı: NFKC + görünmez karakter + benzer harf).
//   2. Parçadaki her somut değer (saat, tutar, süre, kat, kod — `claim-support` ayrıştırıcısı) alıntıda da var; alıntıdaki belirsiz değer
//      ("saat 9" = 09:00 ya da 21:00) parçadaki kesin değere dayanak olmaz.
//   3. O değer alıntıda ihtiyacın KONUSUNA bağlı. Konu = ihtiyacın sözcüklerinden NİTELİK olmayanlar ("havuz temizliği" → "havuz";
//      "temizlik" nitelik — "Sauna temizliği 22:00" havuz sorusuna dayanak olamaz). Değerin yeri: aynı cümlede önceki değerin bitişinden
//      kendi bitişine ("Havuz 20:00'de, sauna 22:00'de kapanır" → 22:00'nin yeri ", sauna 22:00"); kendi yan cümlesinde değerden önce başka
//      içerik sözcüğü varsa yer o yan cümleyle sınırlı ("Havuz temizliği nedeniyle, sauna 22:00'de kapanır" → havuz değil). Aralık tek
//      değerdir ("09:00-20:00"). Konusuz değişke ("…, hafta sonu 11:00'e kadar") önceki değerin konusunu ancak önünde VE ardında yalnız nötr
//      sözcük varsa devralır. Konu sözcüğü SIKI eşleşir ("havuz" ~ "havuzumuz"; "kapı" ≁ "kapıcı") ve NİTELEYEN konumda sayılmaz
//      ("havuzun yanındaki bar", "the bar next to the pool").
//   4. KOŞUL korunur (hafta sonu / hafta içi / gün adı / mevsim / yalnız / hariç / koşullu / talep üzerine / dahil — dil fark etmez, sınıf
//      karşılaştırması). Koşul değerin yan cümlesinden, aynı cümlenin değersiz ama konuyu anan ya da yalnız nötr sözcüklü yan cümlelerinden
//      ("…, pazar hariç") ve konusunu devraldığı yan cümleden (kendi gün / mevsim koşulu yoksa) okunur. Parça kalemde hiç geçmeyen bir gün /
//      mevsim / talep koşulu UYDURAMAZ. Kalemde aynı konunun koşullu bir DEĞİŞKESİ varsa ("Havuz 20:00'de kapanır. Hafta sonu 23:00'e
//      kadar açık.") koşulsuz değeri veren parça o koşulu da anmalı — alıntı onu gizleyemez.
//   5. OLUMSUZLUK aynı (yan cümle düzeyinde; çift olumsuz birbirini götürür: "kapalı değildir" açık).
//   6. YÖN aynı: açılış / "-den itibaren" ↔ kapanış / "-e kadar" ("Havuz 09:00'da açılır" → "09:00'da kapanır" gitmez).
// Değersiz parça ("Evcil hayvan kabul edilmiyor"): konu alıntıda geçmeli; konunun yan cümlesi kendi yüklemini taşıyorsa ("Havuz açıktır,
// sauna kapalıdır") o yan cümle, taşımıyorsa ("Evcil hayvanlar, küçük köpekler hariç, kabul edilmez") bütün cümle okunur.
// Konusu hiç bilinmeyen ihtiyaç (sözcük de sözlük konusu da yok) doğrulanamaz → TUTULUR.
// Bilinen sınır (tutma yönünde): "ücretsizdir" ↔ "ücretli değil" farklı olumluluk; konu değerden sonra gelirse ("09:00-20:00 arası havuz
// açık") bağ kurulamaz; parantezli değişke konusuz kalır. Hepsi cevabı ev sahibine bırakır, yanlış göndermez.
// Doğrusal: bölme / belirteçleme tek geçiş, cümle tabloları bir kez kurulur (ilk sürüm 27.000 karakterde 2 dakikayı aştı — süre pinli).
// ---------------------------------------------------------------------------

import "server-only";

import { claimSpans } from "@/lib/ai/claim-support";
import { tokenize } from "@/lib/ai/retrieval/text";
import { quoteGroundedIn } from "@/lib/ai/semantic/absence-judge";
import { baseForms, needTermsInStrict } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

export const BINDING_ISSUES = [
  "evidence_missing",
  "evidence_not_in_source",
  "subject_unknown",
  "subject_missing",
  "value_not_in_evidence",
  "value_bound_elsewhere",
  "condition_dropped",
  "condition_added",
  "variant_omitted",
  "polarity_mismatch",
  "direction_mismatch",
] as const;
export type BindingIssue = (typeof BINDING_ISSUES)[number];

export interface BindingInput {
  /** İhtiyacın cevap parçası (misafire gidecek metin; selam YOK). */
  part: string;
  /** Modelin bu parça için gösterdiği alıntı (kalemden birebir). */
  evidence: string;
  /** Alıntının geldiği bilgi tabanı kaleminin metni (başlık + içerik). */
  sourceText: string;
  /** İhtiyacın kendi sözcükleri (`needTerms`). */
  needTerms: readonly string[];
  /** İhtiyacın sözlük konuları (`requestTopics` / `topicsWithSymptomsOf`). */
  needTopics: readonly string[];
}

export interface BindingResult {
  ok: boolean;
  issues: BindingIssue[];
}

// ─── koşul sınıfları (katlanmış belirteçler; `tokenize` biçimi) ──────────────────────────────────────────────────────────────────

/** Tek belirteç → koşul sınıfı (alıntıda bulunursa parçada da olmalı). Gün adları kendi sınıfı; çekimli biçim de okunur ("cumartesileri"). */
const CONDITION_TOKENS: Readonly<Record<string, string>> = {
  weekend: "weekend",
  weekends: "weekend",
  wochenende: "weekend",
  wochenenden: "weekend",
  haftasonu: "weekend",
  haftasonlari: "weekend",
  weekday: "weekday",
  weekdays: "weekday",
  werktags: "weekday",
  haftaici: "weekday",
  summer: "summer",
  yazin: "summer",
  yazlari: "summer",
  sommer: "summer",
  winter: "winter",
  kisin: "winter",
  kislari: "winter",
  only: "only",
  sadece: "only",
  yalniz: "only",
  yalnizca: "only",
  nur: "only",
  seulement: "only",
  solo: "only",
  except: "except",
  haric: "except",
  disinda: "except",
  ausser: "except",
  außer: "except",
  sauf: "except",
  excepto: "except",
  unless: "conditional",
  eger: "conditional",
  sartiyla: "conditional",
  kosuluyla: "conditional",
  uygunsa: "conditional",
  musaitse: "conditional",
  halinde: "conditional",
  wenn: "conditional",
  falls: "conditional",
  sofern: "conditional",
  request: "on_request",
  talep: "on_request",
  appointment: "on_request",
  randevu: "on_request",
  anfrage: "on_request",
  demande: "on_request",
  peticion: "on_request",
  dahil: "included",
  dahildir: "included",
  included: "included",
  includes: "included",
  inclusive: "included",
  inklusive: "included",
  inbegriffen: "included",
  inclus: "included",
  incluido: "included",
  monday: "mon",
  pazartesi: "mon",
  montag: "mon",
  tuesday: "tue",
  sali: "tue",
  dienstag: "tue",
  wednesday: "wed",
  carsamba: "wed",
  mittwoch: "wed",
  thursday: "thu",
  persembe: "thu",
  donnerstag: "thu",
  friday: "fri",
  cuma: "fri",
  freitag: "fri",
  saturday: "sat",
  cumartesi: "sat",
  samstag: "sat",
  sunday: "sun",
  sonntag: "sun",
};

/** Yalnız PARÇADA koşulu karşılamış sayılan ek biçimler (alıntıda koşul doğurmaz: "yaz" fiil de olabilir, "istek" genel sözcük). */
const PART_ONLY_CONDITION_TOKENS: Readonly<Record<string, string>> = {
  yaz: "summer",
  kis: "winter",
  istek: "on_request",
  istegi: "on_request",
  isteginiz: "on_request",
};

/** Gün / mevsim aileleri: bir yan cümlenin kendi gün koşulu, konusunu devraldığı yan cümlenin gün koşulunu ezer ("hafta içi …, hafta sonu …"). */
const DAY_CLASSES = new Set(["weekend", "weekday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const SEASON_CLASSES = new Set(["summer", "winter"]);
/** Parçanın kalemde hiç geçmeden EKLEYEMEYECEĞİ koşullar (yalnız / hariç / koşullu cevap üslubunda doğal geçer — denetlenmez). */
const INVENTABLE_CLASSES = new Set([...DAY_CLASSES, ...SEASON_CLASSES, "on_request", "included"]);
const DAY_TOKENS = new Set(Object.entries(CONDITION_TOKENS).filter(([, c]) => DAY_CLASSES.has(c)).map(([t]) => t));

function lookup(t: string, table: Readonly<Record<string, string>>): string | undefined {
  if (table[t]) return table[t];
  for (const b of baseForms(t)) if (table[b]) return table[b];
  return undefined;
}

function conditionClasses(tokens: readonly string[], side: "evidence" | "part"): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    const prev = tokens[i - 1] ?? "";
    // İki belirteçli koşullar; tek başına "hafta" ("haftada bir"), "yaz" (fiil), "rezervasyon" koşul DEĞİL.
    if (t === "hafta" && next.startsWith("son")) out.add("weekend");
    else if (t === "hafta" && next.startsWith("ic")) out.add("weekday");
    else if ((t === "yaz" || t === "kis") && (next.startsWith("ay") || next.startsWith("sezon") || next.startsWith("done"))) {
      out.add(t === "yaz" ? "summer" : "winter");
    } else if ((t.startsWith("rezervasyon") || t.startsWith("reservation") || t.startsWith("booking")) && /^(zorunlu|gerek|sart|requir|necess|needed|mandatory)/.test(next)) {
      out.add("on_request");
    } else if ((t === "subject" && next === "to") || (t === "if" && next === "available")) out.add("conditional");
    // "Pazar" çarşı da demek ("semt pazarı") → gün adı yalnız "pazar günü / pazar hariç / cumartesi ve pazar" gibi.
    else if ((t === "pazar" || t === "pazari" || t === "pazarlari") && (/^(gun|haric|disinda|kapali|acik)/.test(next) || DAY_TOKENS.has(prev) || (prev === "ve" && DAY_TOKENS.has(tokens[i - 2] ?? "")))) {
      out.add("sun");
    } else {
      const c = lookup(t, CONDITION_TOKENS) ?? (side === "part" ? PART_ONLY_CONDITION_TOKENS[t] : undefined);
      if (c) out.add(c);
    }
  }
  return out;
}

// ─── olumsuzluk ve yön ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Olumsuzluk belirteçleri (tam belirteç). İngilizce kesmeli biçim ("isn't" → "isn t") "t" ile okunur, "isn" ayrıca sayılmaz. */
const NEGATION_TOKENS: ReadonlySet<string> = new Set([
  "degil",
  "degildir",
  "yok",
  "yoktur",
  "yasak",
  "yasaktir",
  "yasaklanmistir",
  "izinsiz",
  "kapali",
  "kapalidir",
  "bulunmuyor",
  "bulunmaz",
  "bulunmamaktadir",
  "olmaz",
  "not",
  "no",
  "never",
  "closed",
  "cannot",
  "without",
  "prohibited",
  "forbidden",
  "unavailable",
  "disallowed",
  "nicht",
  "kein",
  "keine",
  "nie",
  "ohne",
  "geschlossen",
  "verboten",
  "gesperrt",
  "untersagt",
  "pas",
  "jamais",
  "sans",
  "ferme",
  "interdit",
  "cerrado",
  "prohibido",
  "nunca",
]);
/** Ardındaki olumsuz sözcüğü OLUMLUYA çeviren olumsuzluk ekleri ("not prohibited", "nicht verboten"). */
const NEGATING_PARTICLES: ReadonlySet<string> = new Set(["not", "never", "no", "nicht", "nie", "pas", "jamais", "t", "kein", "keine", "nunca"]);

/** Türkçe olumsuz fiil ekleri (katlanmış): "edilmiyor / kiralamıyoruz / izin verilmez / giremezsiniz / etmem / kabul edilmemektedir". */
function negativeVerb(t: string): boolean {
  return (
    t.length > 5 &&
    (/m[iu]yor(um|uz|sun|sunuz|lar)?$/.test(t) || /m[ae]z(siniz|sin|lar|ler|iz|im)?$/.test(t) || /m[ae]m[ae]kt[ae]d[iu]r$/.test(t) || /m[ae]m$/.test(t))
  );
}

function negAt(tokens: readonly string[], i: number): boolean {
  const t = tokens[i];
  // İngilizce "can't / don't / isn't": kesme boşluğa döner ("can t") → "-n"den sonraki "t" olumsuzdur.
  return NEGATION_TOKENS.has(t) || negativeVerb(t) || (t === "t" && i > 0 && tokens[i - 1].endsWith("n"));
}

/** Olumsuz mu: çift olumsuz birbirini götürür ("kapalı değildir", "yasak değil", "not prohibited", "isn't forbidden"). */
function negative(tokens: readonly string[]): boolean {
  let neg = false;
  for (let i = 0; i < tokens.length; i++) {
    if (!negAt(tokens, i)) continue;
    const next = tokens[i + 1] ?? "";
    if ((next === "degil" || next === "degildir") && tokens[i] !== "degil" && tokens[i] !== "degildir") {
      i++;
      continue;
    }
    if (NEGATING_PARTICLES.has(tokens[i]) && i + 1 < tokens.length && negAt(tokens, i + 1)) {
      i++;
      continue;
    }
    neg = true;
  }
  return neg;
}

/** Yön: açılış / başlangıç ↔ kapanış / bitiş ("açılır, -den itibaren, from, after" ↔ "kapanır, -e kadar, until, before"). */
const START_TOKENS = new Set(["acilir", "acilis", "aciliyor", "acilmaktadir", "baslar", "baslangic", "itibaren", "sonra", "opens", "opening", "from", "after", "starts", "begins", "oeffnet", "offnet", "ab", "nach", "apres", "desde"]);
const END_TOKENS = new Set(["kapanir", "kapanis", "kapaniyor", "kapanmaktadir", "biter", "bitis", "kadar", "once", "closes", "closing", "until", "till", "before", "ends", "schliesst", "bis", "vor", "avant", "hasta"]);
function directions(tokens: readonly string[]): Set<"start" | "end"> {
  const out = new Set<"start" | "end">();
  for (const t of tokens) {
    if (START_TOKENS.has(t)) out.add("start");
    if (END_TOKENS.has(t)) out.add("end");
  }
  return out;
}

// ─── konu: nitelik sözcükleri ve niteleyen konum ────────────────────────────────────────────────────────────────────────────────

/** İhtiyacın NİTELİK sözcükleri (konu değil): "havuz temizliği" → konu "havuz". Kök başlangıcı (en az 4 harf) ya da tam belirteç. */
const ATTRIBUTE_ROOTS = (
  "ucret fiyat price cost fee preis kosten prix precio sifre password passwort mot temizl clean reinig kural rule regel numara number nummer " +
  "adres address konum location mesafe distance uzak far yakin near kullan usage hour zaman when kisi person kapasite capacity boyut size"
).split(" ");
function isAttribute(t: string): boolean {
  return ATTRIBUTE_ROOTS.some((r) => t === r || (r.length >= 4 && t.startsWith(r)));
}

/** Konuyu NİTELEYEN konumdaki sözcükten önce gelenler ("next to / near / by the pool", "neben dem Pool"). */
const MODIFIER_PREPOSITIONS = new Set(["near", "beside", "behind", "opposite", "by", "around", "neben", "hinter", "nahe", "pres", "cerca", "junto"]);
const ARTICLES = new Set(["the", "a", "an", "der", "die", "das", "dem", "den", "le", "la", "les", "el"]);
function modifierAt(tokens: readonly string[], i: number): boolean {
  // Türkçe "-daki / -deki / -taki / -teki" ("havuzun yanındaki bar"): ardındaki sözcük asıl konuyu niteler.
  if (/[dt][ae]ki$/.test(tokens[i + 1] ?? "")) return true;
  let j = i - 1;
  if (ARTICLES.has(tokens[j] ?? "")) j--;
  const p = tokens[j] ?? "";
  return MODIFIER_PREPOSITIONS.has(p) || (p === "to" && tokens[j - 1] === "next");
}

interface Subject {
  terms: readonly string[];
  topics: readonly string[];
}

/** Metinde konu var mı: SIKI sözcük eşleşmesi (niteleyen konum hariç); sözcük yalnız niteleyen konumda geçiyorsa sözlük konusu da sayılmaz. */
function hasSubject(text: string, subj: Subject): boolean {
  let modifierOnly = false;
  if (subj.terms.length > 0) {
    const tokens = tokenize(text);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].length < 3 || needTermsInStrict(subj.terms, tokens[i]) === 0) continue;
      if (!modifierAt(tokens, i)) return true;
      modifierOnly = true;
    }
  }
  if (modifierOnly || subj.topics.length === 0) return false;
  return topicsWithSymptomsOf(text).some((t) => subj.topics.includes(t));
}

// ─── yapı: cümle → değer grubu → yan cümle ───────────────────────────────────────────────────────────────────────────────────────

type Span = ReturnType<typeof claimSpans>["claims"][number];
interface Group {
  claims: Span[];
  at: number;
  end: number;
}
interface Sentence {
  s: number;
  e: number;
  groups: Group[];
  /** Yan cümleler [başlangıç, bitiş) — virgül / iki nokta / bağlaç; değer grubunun İÇİ bölünmez. */
  clauses: [number, number][];
  /** `groupClause[gi]`: grubun bulunduğu yan cümle. */
  groupClause: number[];
  /** `valuedClause[ci]`: yan cümlede değer grubu var mı. */
  valuedClause: boolean[];
  /** `regionFrom[gi]`: grubun KONU yerinin başladığı konum (devralma ve yan cümle sınırı dahil). */
  regionFrom: number[];
  /** `regionSeg[gi]`: `regionFrom`un düştüğü parça (parça k = önceki grup bitişi → k. grup bitişi). */
  regionSeg: number[];
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Aralık bağlayıcıları ("09:00-20:00", "09:00 ile 20:00 arası", "from 9 to 8", "von 9 bis 20"). Virgül aralık DEĞİLDİR. */
const RANGE_WORDS: ReadonlySet<string> = new Set([
  "ile",
  "ve",
  "and",
  "to",
  "until",
  "till",
  "bis",
  "und",
  "a",
  "den",
  "dan",
  "ten",
  "tan",
  "arasi",
  "arasinda",
  "between",
  "from",
  "von",
  "ab",
  "kadar",
]);

/** Yan cümle bağlaçları (değer grubunun içinde değilse yan cümleyi böler). */
const CLAUSE_WORDS: ReadonlySet<string> = new Set(["ve", "and", "und", "et", "y", "ama", "fakat", "ancak", "but", "however", "aber", "mais", "pero"]);

/**
 * Konuyu DEVRETMEYE engel olmayan sözcükler: aralık / bağlaç / koşul / olumsuzluk / yön sözcükleri + açık-kapalı yüklemleri + 3 harften
 * kısa ekler. Listede olmayan her içerik sözcüğü ("sauna", "misafirler") yabancı konu sayılır → devralma YOK (şüphede tut).
 */
const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  ...RANGE_WORDS,
  ...CLAUSE_WORDS,
  ...START_TOKENS,
  ...END_TOKENS,
  "hafta",
  "sonu",
  "sonlari",
  "sonlarinda",
  "sonunda",
  "ici",
  "icinde",
  "ise",
  "saat",
  "saatleri",
  "pazar",
  "acik",
  "aciktir",
  "kapali",
  "kapalidir",
  "the",
  "open",
  "closed",
  "close",
  "offen",
  "geschlossen",
  "veya",
  "or",
  "also",
  // Fiyat / rezervasyon nitelikleri yeni konu getirmez ("…, KDV dahil", "…, rezervasyon zorunludur").
  "kdv",
  "vat",
  "tax",
  "taxes",
  "vergi",
  "mwst",
  "tva",
  "iva",
  "rezervasyon",
  "reservation",
  "booking",
  "zorunlu",
  "zorunludur",
  "gerekli",
  "gereklidir",
  "required",
  "necessary",
  "mandatory",
]);

function isNeutralWord(w: string): boolean {
  // Olumsuzluk da yeni konu getirmez: "Otopark 3. katta değil, 2. katta" → 2. kat otoparkındır.
  return (
    w.length < 3 ||
    /^\d/.test(w) ||
    NEUTRAL_WORDS.has(w) ||
    NEGATION_TOKENS.has(w) ||
    negativeVerb(w) ||
    lookup(w, CONDITION_TOKENS) !== undefined
  );
}

/** Yüklem taşıyor mu (değersiz parçada yan cümlenin kendi başına okunup okunamayacağı): "açıktır", "var", "bulunmuyor", "are welcome". */
const PREDICATE_WORDS = new Set(["var", "yok", "degil", "mevcut", "is", "are", "was", "were", "has", "have", "allowed", "available", "permitted", "provided", "accepted", "welcome", "ist", "sind", "gibt", "erlaubt", "est", "sont"]);
function hasPredicate(tokens: readonly string[]): boolean {
  return tokens.some(
    (t) => PREDICATE_WORDS.has(t) || NEGATION_TOKENS.has(t) || negativeVerb(t) || /([dt][iu]r|[iu]yor(uz|lar)?|[ae]bilir|[iu]l[iu]r|[ae]n[iu]r|[iu]n[iu]r)$/.test(t),
  );
}

function words(text: string, from: number, to: number): { w: string; at: number }[] {
  const out: { w: string; at: number }[] = [];
  if (to <= from) return out;
  for (const m of text.slice(from, to).matchAll(WORD_RE)) out.push({ w: m[0], at: from + (m.index ?? 0) });
  return out;
}

const allNeutral = (text: string, from: number, to: number) => words(text, from, to).every((x) => isNeutralWord(x.w));

/**
 * Cümleler (dönüştürülmüş metinde): . ! ? ; satır sonu — değerin İÇİNDEKİ nokta ("20.00", "3. kat") bölmez. Her cümlede değer grupları
 * (aralık birleşir), yan cümleler ve her grubun konu yerinin başlangıcı. Tek geçiş + işaret dizileri → metin uzunluğunda doğrusal.
 */
function structure(text: string, claims: readonly Span[]): Sentence[] {
  const sorted = [...claims].sort((a, b) => a.at - b.at);
  const inClaim = new Uint8Array(text.length + 1);
  for (const c of sorted) for (let i = c.at + 1; i < c.end && i < text.length; i++) inClaim[i] = 1;

  const bounds: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const boundary = (c === "!" || c === "?" || c === ";" || c === "\n" || (c === "." && !/\d/.test(text[i + 1] ?? ""))) && !inClaim[i];
    if (boundary) {
      if (i > start) bounds.push([start, i]);
      start = i + 1;
    }
  }
  if (start < text.length) bounds.push([start, text.length]);

  const inGroup = new Uint8Array(text.length + 1);
  let ci = 0;
  return bounds.map(([s, e]) => {
    while (ci < sorted.length && sorted[ci].at < s) ci++;
    const groups: Group[] = [];
    for (; ci < sorted.length && sorted[ci].at < e; ci++) {
      const c = sorted[ci];
      const last = groups[groups.length - 1];
      if (last && c.at >= last.end) {
        const gap = text.slice(last.end, c.at);
        if (gap.length <= 24 && !/[,;:]/.test(gap)) {
          const gw = words(text, last.end, c.at).map((x) => x.w);
          if (gw.every((w) => RANGE_WORDS.has(w)) && (gw.length > 0 || /[-–—/]/.test(gap))) {
            last.claims.push(c);
            last.end = c.end;
            continue;
          }
        }
      }
      groups.push({ claims: [c], at: c.at, end: c.end });
    }
    for (const g of groups) for (let i = g.at; i < g.end && i < text.length; i++) inGroup[i] = 1;

    const cuts: number[] = [];
    for (let i = s; i < e; i++) if ((text[i] === "," || text[i] === ":") && !inGroup[i] && !inClaim[i]) cuts.push(i);
    for (const { w, at } of words(text, s, e)) if (CLAUSE_WORDS.has(w) && !inGroup[at]) cuts.push(at);
    cuts.sort((a, b) => a - b);
    const clauses: [number, number][] = [];
    let from = s;
    for (const cut of cuts) {
      if (cut > from) clauses.push([from, cut]);
      from = Math.max(from, cut + 1);
    }
    if (from < e) clauses.push([from, e]);

    const groupClause: number[] = [];
    const valuedClause = clauses.map(() => false);
    let k = 0;
    for (const g of groups) {
      while (k + 1 < clauses.length && clauses[k][1] <= g.at) k++;
      groupClause.push(k);
      valuedClause[k] = true;
    }

    // Konu yeri: önceki grubun bitişinden. Devralma — ardı (sonraki gruba / cümle sonuna kadar) nötr ve aradaki boşluklar nötr ise geri
    // yürü. Kendi yan cümlesinde değerden önce içerik sözcüğü varsa yan cümle sınırını GEÇMEZ ("Havuz temizliği nedeniyle, sauna 22:00").
    const gapNeutral = groups.map((g, gi) => (gi === 0 ? false : allNeutral(text, groups[gi - 1].end, g.at)));
    const reach: number[] = [];
    groups.forEach((_, gi) => reach.push(gi > 0 && gapNeutral[gi] ? reach[gi - 1] : gi));
    const regionFrom = groups.map((g, gi) => {
      const afterNeutral = gi + 1 < groups.length ? gapNeutral[gi + 1] : allNeutral(text, g.end, e);
      const j = afterNeutral ? reach[gi] : gi;
      const inherited = j > 0 ? groups[j - 1].end : s;
      const clauseStart = clauses[groupClause[gi]][0];
      return allNeutral(text, clauseStart, g.at) ? inherited : Math.max(inherited, clauseStart);
    });
    // regionFrom'un düştüğü parça: bitişi regionFrom'dan büyük ilk grup (ikili arama — grup bitişleri artan).
    const regionSeg = regionFrom.map((from, gi) => {
      let lo = 0;
      let hi = gi;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (groups[mid].end <= from) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    });
    return { s, e, groups, clauses, groupClause, valuedClause, regionFrom, regionSeg };
  });
}

// ─── belge: alıntı ya da kalem için tembel tablolar ─────────────────────────────────────────────────────────────────────────────

interface PlaceReading {
  conditions: Set<string>;
  negative: boolean;
  directions: Set<"start" | "end">;
}

function readPlace(text: string): PlaceReading {
  const t = tokenize(text);
  return { conditions: conditionClasses(t, "evidence"), negative: negative(t), directions: directions(t) };
}

/** Bir metnin (alıntı ya da kalem) yapısı + konu ve yer okumaları; her tablo bir kez kurulur → toplam doğrusal. */
function documentOf(raw: string, subj: Subject) {
  const { text, claims } = claimSpans(raw);
  const sentences = structure(text, claims);
  const subjectIn = (s: string) => hasSubject(s, subj);
  const segPrefix = new Map<Sentence, number[]>();
  const clauseCache = new Map<string, PlaceReading>();
  const extraCache = new Map<Sentence, PlaceReading>();
  let wholeSubject: boolean | undefined;

  /** Grubun konu yeri konuyu taşıyor mu: yer, grup bitişlerine göre bölünmüş parçaların birleşimi (önek toplamıyla O(1)). */
  const boundTo = (sent: Sentence, gi: number) => {
    let pre = segPrefix.get(sent);
    if (!pre) {
      pre = [0];
      sent.groups.forEach((g, k) => {
        const from = k > 0 ? sent.groups[k - 1].end : sent.s;
        pre!.push(pre![k] + (subjectIn(text.slice(from, g.end)) ? 1 : 0));
      });
      segPrefix.set(sent, pre);
    }
    const from = sent.regionFrom[gi];
    // Yer başı bir grup bitişi ya da yan cümle başı; yan cümle başı ilk parçanın ortasındaysa o parça yeniden okunur.
    const k0 = sent.regionSeg[gi];
    const firstFrom = k0 > 0 ? sent.groups[k0 - 1].end : sent.s;
    if (from > firstFrom) return subjectIn(text.slice(from, sent.groups[k0].end)) || pre[gi + 1] - pre[k0 + 1] > 0;
    return pre[gi + 1] - pre[k0] > 0;
  };
  const clausePlace = (sent: Sentence, ci: number) => {
    const key = `${sent.s}:${ci}`;
    let r = clauseCache.get(key);
    if (!r) {
      r = readPlace(text.slice(sent.clauses[ci][0], sent.clauses[ci][1]));
      clauseCache.set(key, r);
    }
    return r;
  };
  // Aynı cümlenin değersiz yan cümleleri: konuyu anıyorsa ya da yalnız nötr sözcüklüyse ("…, pazar hariç", "Yalnız yazın, …").
  const extraPlace = (sent: Sentence) => {
    let r = extraCache.get(sent);
    if (!r) {
      const parts = sent.clauses
        .map((cl, ci) => ({ cl, ci }))
        .filter(({ cl, ci }) => !sent.valuedClause[ci] && (subjectIn(text.slice(cl[0], cl[1])) || allNeutral(text, cl[0], cl[1])))
        .map(({ ci }) => clausePlace(sent, ci));
      r = { conditions: new Set(parts.flatMap((p) => [...p.conditions])), negative: parts.some((p) => p.negative), directions: new Set() };
      extraCache.set(sent, r);
    }
    return r;
  };
  /** Değerin koşul / olumluluk / yön okuması. Yön yalnız kendi yan cümlesinden; koşul devralınan yan cümleden de (aile ezmesiyle). */
  const placeCache = new Map<Sentence, Map<number, PlaceReading>>();
  const placeOf = (sent: Sentence, gi: number): PlaceReading => {
    let perSentence = placeCache.get(sent);
    if (!perSentence) placeCache.set(sent, (perSentence = new Map()));
    const cached = perSentence.get(gi);
    if (cached) return cached;
    const ownCi = sent.groupClause[gi];
    const own = clausePlace(sent, ownCi);
    const extra = extraPlace(sent);
    const conditions = new Set([...own.conditions, ...extra.conditions]);
    const ownDay = [...own.conditions].some((c) => DAY_CLASSES.has(c));
    const ownSeason = [...own.conditions].some((c) => SEASON_CLASSES.has(c));
    // Konusunu devraldığı yan cümleler: konu yerine düşen, kendi yan cümlesinden önceki yan cümleler (ikili arama + yalnız o aralık).
    const from = sent.regionFrom[gi];
    let lo = 0;
    let hi = ownCi;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sent.clauses[mid][1] <= from) lo = mid + 1;
      else hi = mid;
    }
    for (let ci = lo; ci < ownCi; ci++) {
      for (const c of clausePlace(sent, ci).conditions) {
        if ((DAY_CLASSES.has(c) && ownDay) || (SEASON_CLASSES.has(c) && ownSeason)) continue;
        conditions.add(c);
      }
    }
    const reading = { conditions, negative: own.negative || extra.negative, directions: own.directions };
    perSentence.set(gi, reading);
    return reading;
  };
  const hasSubjectAnywhere = () => (wholeSubject ??= subjectIn(text));
  /**
   * Grup konuya bağlı mı — cümle içinde ya da cümlenin TAMAMI nötrse (değer + koşul / yön sözcükleri: "…; hafta sonları 22:00'ye kadar
   * açıktır.") önceki cümlenin konusundan. Başka içerik sözcüğü taşıyan cümle devralmaz ("…. 22:00'de sauna kapanır.").
   */
  const sentenceNeutral: (boolean | undefined)[] = [];
  const sentenceSubject: (boolean | undefined)[] = [];
  const boundAt = (si: number, gi: number) => {
    const sent = sentences[si];
    if (boundTo(sent, gi)) return true;
    if (si === 0) return false;
    const prev = sentences[si - 1];
    // Cümle başına bir kez (bağsız değer dizisinde her değer aynı soruyu sorar — ölçüldü: önbelleksiz 4.000 cümlede 11 sn).
    sentenceNeutral[si] ??= allNeutral(text, sent.s, sent.e);
    if (!sentenceNeutral[si]) return false;
    sentenceSubject[si - 1] ??= subjectIn(text.slice(prev.s, prev.e));
    return sentenceSubject[si - 1]!;
  };
  return { text, sentences, subjectIn, boundAt, placeOf, hasSubjectAnywhere };
}

// ─── ana kural ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function checkAnswerBinding(input: BindingInput): BindingResult {
  const issues = new Set<BindingIssue>();
  const evidence = input.evidence.trim();
  if (!evidence) return { ok: false, issues: ["evidence_missing"] };
  if (!quoteGroundedIn(input.sourceText, evidence)) issues.add("evidence_not_in_source");
  // Konu = nitelik olmayan sözcükler ve onların sözlük konuları ("havuz temizliği" → "havuz" / pool; "temizlik" / cleaning konu sayılmaz).
  const nonAttribute = input.needTerms.filter((t) => !isAttribute(t));
  const attributeTopics = new Set(topicsWithSymptomsOf(input.needTerms.filter(isAttribute).join(" ")));
  const subjectTopics = input.needTopics.filter((t) => !attributeTopics.has(t));
  const subj: Subject = {
    terms: nonAttribute.length > 0 ? nonAttribute : input.needTerms,
    topics: subjectTopics.length > 0 ? subjectTopics : input.needTopics,
  };
  const subjectKnown = subj.terms.length > 0 || subj.topics.length > 0;
  if (!subjectKnown) issues.add("subject_unknown");

  const ev = documentOf(evidence, subj);
  const pt = claimSpans(input.part);
  const partTokens = tokenize(input.part);
  const partConditions = conditionClasses(partTokens, "part");
  const partNegative = negative(partTokens);
  const partDirections = directions(partTokens);

  const checkPlace = (r: PlaceReading) => {
    for (const cls of r.conditions) if (!partConditions.has(cls)) issues.add("condition_dropped");
    if (r.negative !== partNegative) issues.add("polarity_mismatch");
    if (r.directions.size === 1 && partDirections.size > 0 && !partDirections.has([...r.directions][0])) issues.add("direction_mismatch");
  };

  // Parça kalemde hiç geçmeyen gün / mevsim / talep / dahil koşulu ekleyemez ("Havuz hafta sonu 09:00-20:00 açık" ← koşulsuz kalem).
  const sourceConditions = conditionClasses(tokenize(`${input.sourceText}\n${evidence}`), "evidence");
  for (const cls of partConditions) if (INVENTABLE_CLASSES.has(cls) && !sourceConditions.has(cls)) issues.add("condition_added");

  let src: ReturnType<typeof documentOf> | undefined;
  const variantCache = new Map<string, boolean>();
  if (pt.claims.length > 0) {
    for (const c of pt.claims) {
      const hits: { si: number; sent: Sentence; gi: number }[] = [];
      ev.sentences.forEach((sent, si) =>
        sent.groups.forEach((g, gi) => {
          if (g.claims.some((e) => sameValue(c, e))) hits.push({ si, sent, gi });
        }),
      );
      if (hits.length === 0) {
        issues.add("value_not_in_evidence");
        continue;
      }
      if (!subjectKnown) continue;
      const bound = hits.find((h) => ev.boundAt(h.si, h.gi));
      if (!bound) {
        issues.add(ev.hasSubjectAnywhere() ? "value_bound_elsewhere" : "subject_missing");
        continue;
      }
      const place = ev.placeOf(bound.sent, bound.gi);
      checkPlace(place);
      // Koşulsuz değer verildi: kalemde aynı konunun koşullu değişkesi varsa onu da anmalı (alıntı onu gizleyemez).
      if (![...place.conditions].some((x) => DAY_CLASSES.has(x) || SEASON_CLASSES.has(x))) {
        src ??= documentOf(input.sourceText, subj);
        const key = `${c.cls}|${(c.tkeys ?? c.keys).join(",")}`;
        if (!variantCache.has(key)) variantCache.set(key, variantOmitted(src, c, partConditions));
        if (variantCache.get(key)) issues.add("variant_omitted");
      }
    }
  } else if (subjectKnown) {
    // Değersiz parça: konunun yan cümlesi kendi yüklemini taşıyorsa o yan cümle, taşımıyorsa bütün cümle okunur.
    const places: string[] = [];
    for (const sent of ev.sentences) {
      for (const cl of sent.clauses) {
        const clause = ev.text.slice(cl[0], cl[1]);
        if (!ev.subjectIn(clause)) continue;
        places.push(hasPredicate(tokenize(clause)) ? clause : ev.text.slice(sent.s, sent.e));
      }
    }
    if (places.length === 0) issues.add("subject_missing");
    else checkPlace({ ...readPlace(places.join(" . ")), directions: new Set() });
  }
  const list = BINDING_ISSUES.filter((i) => issues.has(i));
  return { ok: list.length === 0, issues: list };
}

/** Kalemde aynı türden, konuya bağlı (ya da konusuz bir sonraki cümlede), FARKLI ve gün / mevsim koşullu bir değer var mı. */
function variantOmitted(src: ReturnType<typeof documentOf>, c: Span, partConditions: ReadonlySet<string>): boolean {
  for (let si = 0; si < src.sentences.length; si++) {
    const sent = src.sentences[si];
    for (let gi = 0; gi < sent.groups.length; gi++) {
      const g = sent.groups[gi];
      if (!g.claims.some((e) => e.cls === c.cls) || g.claims.some((e) => sameValue(c, e))) continue;
      if (!src.boundAt(si, gi)) continue;
      for (const cls of src.placeOf(sent, gi).conditions) {
        if ((DAY_CLASSES.has(cls) || SEASON_CLASSES.has(cls)) && !partConditions.has(cls)) return true;
      }
    }
  }
  return false;
}

function sameValue(a: Span, b: Span): boolean {
  if (a.tkeys && b.tkeys) return a.tkeys.some((k) => b.tkeys!.includes(k));
  // Alıntıdaki belirsiz saat ("saat 9" = 09:00 | 21:00) parçadaki KESİN saate dayanak olmaz; belirsizliği aynen taşıyan parça olur.
  if (a.cls === "time" && b.keys.length > 1 && a.keys.length === 1) return false;
  return a.keys.some((k) => b.keys.includes(k));
}
