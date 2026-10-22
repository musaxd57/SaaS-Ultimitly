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
import { confidentLanguage, languageEvidence } from "@/lib/ai/language-signal";
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
  "unsupported_content",
  "subject_mismatch",
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
  /** İstemde gösterilen ÖTEKİ kaynaklar (Opus 10-23 O6: aynı konunun koşullu değişkesi başka kalemde olabilir). */
  otherSources?: readonly string[];
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
/**
 * Gün adı → ailesi (E ölçümü 10-23): cumartesi / pazar hafta sonunun, pazartesi–cuma hafta içinin ÖZELİDİR. "Hafta sonu 23:00'e kadar
 * açık" kalemi "On Saturdays the pool closes at 23:00" parçasının dayanağıdır; tersi değil (hafta sonu iddiası cumartesi kaleminden çıkmaz).
 */
const DAY_PARENT: Readonly<Record<string, string>> = { sat: "weekend", sun: "weekend", mon: "weekday", tue: "weekday", wed: "weekday", thu: "weekday", fri: "weekday" };
/** Tümleyen: kalem genel kural + "hafta sonu" istisnası veriyorsa genel değer "hafta içi" diye verilebilir (ve tersi) — yalnız DEĞER BAŞINA doğrulanınca. */
const DAY_COMPLEMENT: Readonly<Record<string, string>> = { weekday: "weekend", weekend: "weekday" };
const dayClassesOf = (conds: ReadonlySet<string>) => [...conds].filter((c) => DAY_CLASSES.has(c));
const variantClassesOf = (conds: ReadonlySet<string>) => [...conds].filter((c) => DAY_CLASSES.has(c) || SEASON_CLASSES.has(c));
/** Değerin gün koşulu kalemdeki `cls` değişkesinin gününe denk düşüyor mu (aynı sınıf ya da onun özeli: hafta sonu ↔ cumartesi). */
const coversDay = (valueDays: ReadonlySet<string>, cls: string) => valueDays.has(cls) || [...valueDays].some((d) => DAY_PARENT[d] === cls);

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
    // Yalın "Pazar" ardından saat gelirse gündür ("Pazar 23:00'e kadar açık" — Haiku 10-23); "semt pazarı" çekimli kalır.
    else if ((t === "pazar" || t === "pazari" || t === "pazarlari") && (/^(gun|haric|disinda|kapali|acik)/.test(next) || (t === "pazar" && /^\d/.test(next)) || DAY_TOKENS.has(prev) || (prev === "ve" && DAY_TOKENS.has(tokens[i - 2] ?? "")))) {
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
  // Terim varken KABA sözlük konusuna düşülmez (Opus 10-23 K2: "kahvaltı" sorusuna "restoran"ın saati — ikisi de "restaurant"); ince konu
  // ("Check-out saati" ↔ "çıkış") yine eşler.
  if (modifierOnly || subj.topics.length === 0) return false;
  const topics = subj.terms.length > 0 ? subj.topics.filter((t) => !COARSE_TOPICS.has(t)) : subj.topics;
  return topics.length > 0 && topicsWithSymptomsOf(text).some((t) => topics.includes(t));
}

/** Birden çok tesisi / türü toplayan sözlük konuları: kimlik sayılmaz (kahvaltı / restoran / kafe → "restaurant"; köpek / evcil hayvan → "pets"). */
const COARSE_TOPICS: ReadonlySet<string> = new Set(["restaurant", "pets"]);

/**
 * Konu sözcüğü sayılmayanlar (Opus 10-23 K2): genel baş adlar ("çamaşır MAKİNESİ" ↔ "bulaşık MAKİNESİ") ve fiiller ("kullanılabilir",
 * "çalışır"). Katlanmış biçim; tam sözcük ya da en az 4 harflik baş.
 */
const GENERIC_HEADS = (
  "makine makinesi makinasi alet aleti cihaz cihazi oda odasi odada alan alani saat saati saatleri kullanim kullanimi tesis tesisi " +
  "machine device appliance room area hours time facility geraet gerat maschine zimmer bereich uhrzeit"
).split(" ");
const EN_DE_VERBS = new Set(
  (
    "open opens opened opening close closes closed closing use used using work works working cost costs start starts end ends allowed available rent rented book booked " +
    "offnet oeffnet schliesst geoffnet kostet erlaubt gestattet " +
    // Yüklem adları ("kabul ediliyor mu", "izin var mı"): konu değil.
    "kabul izin mumkun serbest yasak permitted accepted welcome"
  ).split(" "),
);
function isGenericOrVerb(t: string): boolean {
  if (GENERIC_HEADS.includes(t) || EN_DE_VERBS.has(t)) return true;
  // Gün / mevsim / koşul sözcüğü ("havuz CUMARTESİ kaçta") ve soru eki ("miyim") konu değildir.
  if (lookup(t, CONDITION_TOKENS) !== undefined || /^m[iu](yim|yiz|sin|siniz|dir|dur)?$/.test(t)) return true;
  // Türkçe fiil çekimi (çoğul ad "-lar / -ler" hariç): -ılır / -ınır / -abilir / -ıyor / -makta / -mak / -maz / 6+ harfli -ır.
  if (/l[ae]r$/.test(t)) return false;
  return /(?:[iu]l[iu]r|[iu]n[iu]r|[ae]bil[iu]r|[iu]yor(?:uz|lar|sunuz)?|m[ae]kt[ae]d[iu]r|m[ae]k|m[ae]z)$/.test(t) || (t.length >= 6 && /[iu]r$/.test(t));
}

/** Konu kimliği: terimin sözlük konusu (diller arası "pool" ~ "havuz") ya da terimin kendisi. */
function subjectIdentity(term: string): string {
  const topics = topicsWithSymptomsOf(term);
  // Kimlik için kaba konu da olur ("evcil hayvan" / "pets" aynı şey); BAĞ kurmak için olmaz (`hasSubject` terim ister).
  return topics.length > 0 ? `topic:${topics[0]}` : `term:${term}`;
}

/** Metinde geçen konu kimlikleri (niteleyen konumdaki sözcük sayılmaz). */
function subjectIdentitiesIn(text: string, subj: Subject, identities: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].length < 3 || modifierAt(tokens, i)) continue;
    for (const term of subj.terms) if (needTermsInStrict([term], tokens[i]) > 0) out.add(subjectIdentity(term));
  }
  // Diller arası: parçanın "pool"u ihtiyacın "havuz"uyla aynı sözlük konusu.
  for (const t of topicsWithSymptomsOf(text)) if (identities.has(`topic:${t}`)) out.add(`topic:${t}`);
  return out;
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
  // Mevsim öbeği ("yaz aylarında", "kış sezonunda") koşul sözcüğüdür, yeni konu değil (Haiku 10-23: yaz değişkesi konuya bağlanmıyor,
  // "Havuz yazın 20:00" geçiyordu).
  "yaz",
  "kis",
  "ay",
  "aylari",
  "aylarinda",
  "aylarda",
  "sezon",
  "sezonu",
  "sezonunda",
  "donem",
  "doneminde",
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
  // Olumsuzluk da yeni konu getirmez: "Otopark 3. katta değil, 2. katta" → 2. kat otoparkındır. Sayılar ayrıca sayılmaz: değerler
  // `claimSpans` aralığıdır, kalan rakam dizisi içerik sayılır (mutasyon B23: ayrı rakam kuralı hiçbir girdide fark yaratmadı).
  return (
    w.length < 3 ||
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

/**
 * YER / TAHSİS sözcükleri (E ölçümü 10-23: "Otopark ücretsizdir; binanın -2. katında, 12 numaralı yer size ayrılmıştır." — devam cümlesi
 * yalnız yer anlatır, yeni konu getirmez). YALNIZ konu devralmasında nötr; içerik kıyasında ("sağındaki" ≠ "solundaki") içerik kalır.
 * Tesis adı (kafe, spa, sauna …) ve konu olabilen sözcükler ("giriş", "ayrılış" — giriş / çıkış saati) BİLEREK yok.
 */
const LOCATION_WORDS: ReadonlySet<string> = new Set([
  "kat", "kati", "katin", "katta", "kattadir", "katinda", "katindaki", "kattaki", "katindadir",
  "yer", "yeri", "yerde", "yerdir", "numara", "numarali", "numarasi", "numaralidir",
  "sag", "sagda", "saginda", "sagindaki", "sol", "solda", "solunda", "solundaki", "karsi", "karsisinda", "karsisindaki",
  "yan", "yaninda", "yanindaki", "alt", "altinda", "altindaki", "altindadir", "ust", "ustunde", "ustundeki", "arka", "arkasinda", "arkasindaki",
  "size", "sizin", "ayrilmistir", "ayrilmis", "tahsis", "tahsislidir",
  "floor", "level", "spot", "space", "building", "number", "reserved", "assigned", "ground", "basement", "left", "right",
  "etage", "stock", "platz", "gebaude", "nummer", "reserviert",
]);
const LOCATION_ROOTS = ["bina", "zemin", "bodrum", "metre", "ileri", "kose"];
function isLocationWord(w: string): boolean {
  return LOCATION_WORDS.has(w) || LOCATION_ROOTS.some((r) => w.startsWith(r));
}
const allNeutral = (text: string, from: number, to: number) => words(text, from, to).every((x) => isNeutralWord(x.w));
/** Yalnız CÜMLE düzeyi devralmada (ve değişkenin ardında): nötr sözcük ya da yer / tahsis sözcüğü. Cümle içi aralıkta yer sözcüğü nötr DEĞİL. */
const allLocationNeutral = (text: string, from: number, to: number) =>
  words(text, from, to).every((x) => isNeutralWord(x.w) || isLocationWord(x.w));

/**
 * Değerin ARDI (Türkçe kalem): yer bildiren ad (-de / -da / -deki: "zemin kattaki kafede") ve yüklem ("verilir", "kullanılabilir") özne
 * değildir — "11:00'e kadar zemin kattaki kafede verilir" değeri kahvaltınındır. Yalın ad ("11:00'e kadar KAFE açıktır") öznedir → devralma
 * yok (yüklem kalıpları yalın ad ya da çoğul ad sonuyla — "havuzlar" — eşleşmez).
 */
function trailingAdjunct(w: string): boolean {
  if (w.length < 5) return false;
  return /(?:n?[dt][ae]|n?[dt][ae]ki)$/.test(w) || /(?:[iu]l[iu]r|[iu]n[iu]r|[ae]bil[iu]r|[iu]yor(?:uz|lar|sunuz)?|m[ae]kt[ae]d[iu]r|[dt][iu]r)$/.test(w);
}
const allNeutralAfter = (text: string, from: number, to: number) =>
  words(text, from, to).every((x) => isNeutralWord(x.w) || isLocationWord(x.w) || trailingAdjunct(x.w));

/**
 * Cümleler (dönüştürülmüş metinde): . ! ? ; satır sonu — değerin İÇİNDEKİ nokta ("20.00", "3. kat") bölmez. Her cümlede değer grupları
 * (aralık birleşir), yan cümleler ve her grubun konu yerinin başlangıcı. Tek geçiş + işaret dizileri → metin uzunluğunda doğrusal.
 */
function structure(text: string, claims: readonly Span[], tr = false): Sentence[] {
  const sorted = [...claims].sort((a, b) => a.at - b.at);
  const inClaim = new Uint8Array(text.length + 1);
  const claimLast = new Uint8Array(text.length + 1);
  for (const c of sorted) {
    for (let i = c.at + 1; i < c.end && i < text.length; i++) inClaim[i] = 1;
    if (c.end > c.at) claimLast[c.end - 1] = 1;
  }

  const bounds: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const punct = c === "!" || c === "?" || c === ";" || c === "\n" || (c === "." && !/\d/.test(text[i + 1] ?? ""));
    // Kodun SON karakteri olan "!" / "?" ("şifre: Lale2025! Modem …") ardından boşluk geliyorsa cümleyi de bitirir (E ölçümü 10-23:
    // ardındaki cümle değerin "ardı" sayılıp konuyu çalıyordu). Kodun kendisi değişmez.
    const codeEnd = (c === "!" || c === "?") && claimLast[i] === 1 && (i + 1 >= text.length || /\s/.test(text[i + 1]));
    const boundary = punct && (!inClaim[i] || codeEnd);
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
    // Son değerin ardı (Türkçe kalem) yalnız değer kendi gün / mevsim koşuluyla bir DEĞİŞKE ise gevşer ("…, hafta sonu 11:00'e kadar zemin
    // kattaki kafede verilir"); koşulsuz ikinci değer ("Havuz 20:00'de, 22:00'ye kadar kafede açık") başka bir şeyindir → devralmaz.
    const variantClause = (gi: number) => {
      const [a, b] = clauses[groupClause[gi]];
      return [...conditionClasses(tokenize(text.slice(a, b)), "evidence")].some((c) => DAY_CLASSES.has(c) || SEASON_CLASSES.has(c));
    };
    const regionFrom = groups.map((g, gi) => {
      const afterNeutral =
        gi + 1 < groups.length ? gapNeutral[gi + 1] : allNeutral(text, g.end, e) || (tr && variantClause(gi) && allNeutralAfter(text, g.end, e));
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
  const sentences = structure(text, claims, languageOf(raw) === "tr");
  const subjectIn = (s: string) => hasSubject(s, subj);
  const segPrefix = new Map<Sentence, number[]>();
  // Önbellekler cümle nesnesine bağlı diziler (dize anahtarı yok — uzun kalemde milyonlarca anahtar üretiyordu).
  const clauseCache = new Map<Sentence, (PlaceReading | undefined)[]>();
  const extraCache = new Map<Sentence, PlaceReading>();
  const beforeCache = new Map<Sentence, PlaceReading[]>();
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
    let row = clauseCache.get(sent);
    if (!row) clauseCache.set(sent, (row = []));
    return (row[ci] ??= readPlace(text.slice(sent.clauses[ci][0], sent.clauses[ci][1])));
  };
  // Aynı cümlenin değersiz yan cümleleri: konuyu anıyorsa ya da yalnız nötr sözcüklüyse ("…, pazar hariç", "Yalnız yazın, …").
  const extraEligible = (sent: Sentence, ci: number) => {
    const cl = sent.clauses[ci];
    return !sent.valuedClause[ci] && (subjectIn(text.slice(cl[0], cl[1])) || allNeutral(text, cl[0], cl[1]));
  };
  const extraPlace = (sent: Sentence) => {
    let r = extraCache.get(sent);
    if (!r) {
      const parts = sent.clauses.map((_, ci) => ci).filter((ci) => extraEligible(sent, ci)).map((ci) => clausePlace(sent, ci));
      r = { conditions: new Set(parts.flatMap((p) => [...p.conditions])), negative: parts.some((p) => p.negative), directions: new Set() };
      extraCache.set(sent, r);
    }
    return r;
  };
  // Değerin yan cümlesinden ÖNCEKİ değersiz yan cümleler (parça tarafı: "Hafta sonları: havuz 23:00'e kadar açık." — ama "Havuz 23:00'de
  // kapanır, hafta sonu da açık." değere gün BAĞIŞLAMAZ, Opus 10-23 Y2). Önek okumaları cümle başına bir kez (tek değerli cümlede doğrusal).
  const extraBefore = (sent: Sentence, ownCi: number): PlaceReading => {
    let pre = beforeCache.get(sent);
    if (!pre) {
      pre = [{ conditions: new Set(), negative: false, directions: new Set() }];
      for (let ci = 0; ci < sent.clauses.length; ci++) {
        const last = pre[ci];
        if (!extraEligible(sent, ci)) {
          pre.push(last);
          continue;
        }
        const p = clausePlace(sent, ci);
        const grows = [...p.conditions].some((c) => !last.conditions.has(c)) || (p.negative && !last.negative);
        pre.push(grows ? { conditions: new Set([...last.conditions, ...p.conditions]), negative: last.negative || p.negative, directions: last.directions } : last);
      }
      beforeCache.set(sent, pre);
    }
    return pre[ownCi];
  };
  /** Değerin koşul / olumluluk / yön okuması. Yön yalnız kendi yan cümlesinden; koşul devralınan yan cümleden de (aile ezmesiyle). */
  const placeCache = new Map<Sentence, (PlaceReading | undefined)[][]>();
  const placeOf = (sent: Sentence, gi: number, opts: { extraBeforeOnly?: boolean } = {}): PlaceReading => {
    let rows = placeCache.get(sent);
    if (!rows) placeCache.set(sent, (rows = [[], []]));
    const row = rows[opts.extraBeforeOnly ? 1 : 0];
    const cached = row[gi];
    if (cached) return cached;
    const ownCi = sent.groupClause[gi];
    const own = clausePlace(sent, ownCi);
    const extra = opts.extraBeforeOnly ? extraBefore(sent, ownCi) : extraPlace(sent);
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
    row[gi] = reading;
    return reading;
  };
  /** Cümle düzeyi okumalar (istisna + koşulları, ücret tabanı) — cümle başına bir kez (değer başına yeniden okuma karesel/kübikti). */
  const sentenceCache = new Map<Sentence, { exception: boolean; conds: string[]; basis: Set<string> }>();
  const sentenceInfo = (sent: Sentence) => {
    let r = sentenceCache.get(sent);
    if (!r) {
      const toks = tokenize(text.slice(sent.s, sent.e));
      const exception = toks.some((t) => EXCEPTION_TOKENS.has(t));
      r = { exception, conds: exception ? variantClassesOf(conditionClasses(toks, "evidence")) : [], basis: basisClasses(toks) };
      sentenceCache.set(sent, r);
    }
    return r;
  };
  const hasSubjectAnywhere = () => (wholeSubject ??= subjectIn(text));
  /**
   * Grup konuya bağlı mı — cümle içinde ya da cümlenin TAMAMI nötrse (değer + koşul / yön sözcükleri: "…; hafta sonları 22:00'ye kadar
   * açıktır.") önceki cümlenin konusundan. Başka içerik sözcüğü taşıyan cümle devralmaz ("…. 22:00'de sauna kapanır.").
   */
  const sentenceNeutral: (boolean | undefined)[] = [];
  const sentenceLocation: (boolean | undefined)[] = [];
  const sentenceSubject: (boolean | undefined)[] = [];
  // Yer başına bir kez (her parça değeri aynı yerleri yeniden sorar — önbelleksiz değer × yer kadar konu okuması).
  const boundMemo: (boolean | undefined)[][] = [];
  const boundAt = (si: number, gi: number): boolean => ((boundMemo[si] ??= [])[gi] ??= boundAtUncached(si, gi));
  const boundAtUncached = (si: number, gi: number) => {
    const sent = sentences[si];
    if (boundTo(sent, gi)) return true;
    if (si === 0) return false;
    const prev = sentences[si - 1];
    // Cümle başına bir kez (bağsız değer dizisinde her değer aynı soruyu sorar — ölçüldü: önbelleksiz 4.000 cümlede 11 sn).
    sentenceNeutral[si] ??= allNeutral(text, sent.s, sent.e);
    if (!sentenceNeutral[si]) {
      // Yalnız yer anlatan devam cümlesi ("…; binanın -2. katında, 12 numaralı yer size ayrılmıştır.") konuyu devralır — ama önceki cümle
      // aynı türden bir değeri ZATEN veriyorsa ("Sauna 2. katta. Yer size ayrılmıştır, 3. kat.") ikinci değer o konunun değildir (Haiku 10-23).
      sentenceLocation[si] ??= allLocationNeutral(text, sent.s, sent.e);
      if (!sentenceLocation[si]) return false;
      const cls = new Set(sent.groups[gi].claims.map((c) => c.cls));
      if (prev.groups.some((g) => g.claims.some((c) => cls.has(c.cls)))) return false;
    }
    sentenceSubject[si - 1] ??= subjectIn(text.slice(prev.s, prev.e));
    return sentenceSubject[si - 1]!;
  };
  /** Bağlı grubun KONU yeri (metin): cümle içi yer ya da devralınan önceki cümle; bağsızsa null. */
  const boundRegion = (si: number, gi: number): string | null => {
    const sent = sentences[si];
    if (boundTo(sent, gi)) return text.slice(sent.regionFrom[gi], sent.groups[gi].end);
    if (!boundAt(si, gi)) return null;
    const prev = sentences[si - 1];
    return text.slice(prev.s, prev.e);
  };
  /**
   * Konuya bağlı, gün / mevsim koşullu değer grupları (değer türüne göre, belge başına bir kez) — `variantOmitted` her parça değeri için
   * yalnız bu listeyi tarar (önceden her değer + her yer için bütün kalem yeniden okunuyordu: uzun kalemde kübik).
   */
  const variantGroupCache = new Map<string, { claims: Span[]; conds: string[] }[]>();
  const variantGroupsFor = (cls: string) => {
    let list = variantGroupCache.get(cls);
    if (!list) {
      list = [];
      for (let si = 0; si < sentences.length; si++) {
        const sent = sentences[si];
        for (let gi = 0; gi < sent.groups.length; gi++) {
          const g = sent.groups[gi];
          if (!g.claims.some((e) => e.cls === cls) || !boundAt(si, gi)) continue;
          const conds = [...placeOf(sent, gi).conditions].filter((c) => DAY_CLASSES.has(c) || SEASON_CLASSES.has(c));
          if (conds.length > 0) list.push({ claims: g.claims, conds });
        }
      }
      variantGroupCache.set(cls, list);
    }
    return list;
  };
  /**
   * Değersiz koşullu yan cümlelerin gün / mevsim koşulları ("Hafta sonu kapalıdır", "Pazar günleri kapalıdır"): yüklem ya da olumsuzluk
   * taşıyan, konuyu anan ya da konusunu önceki cümleden devralan (cümle yalnız nötr sözcüklü) yan cümle. Değerden bağımsız → bir kez.
   */
  let valuelessConds: string[] | undefined;
  const valuelessVariantConds = () => {
    if (valuelessConds) return valuelessConds;
    const out = new Set<string>();
    for (let si = 0; si < sentences.length; si++) {
      const sent = sentences[si];
      const sentText = text.slice(sent.s, sent.e);
      const inherits = si > 0 && allNeutral(text, sent.s, sent.e) && subjectIn(text.slice(sentences[si - 1].s, sentences[si - 1].e));
      let sentSubject: boolean | undefined;
      for (let ci = 0; ci < sent.clauses.length; ci++) {
        if (sent.valuedClause[ci]) continue;
        const [a, b] = sent.clauses[ci];
        const clause = text.slice(a, b);
        const toks = tokenize(clause);
        if (!(hasPredicate(toks) || negative(toks))) continue;
        if (!(subjectIn(clause) || inherits || (allNeutral(text, a, b) && (sentSubject ??= subjectIn(sentText))))) continue;
        for (const c of conditionClasses(toks, "evidence")) if (DAY_CLASSES.has(c) || SEASON_CLASSES.has(c)) out.add(c);
      }
    }
    return (valuelessConds = [...out]);
  };
  return { text, sentences, subjectIn, boundAt, boundRegion, placeOf, hasSubjectAnywhere, sentenceInfo, variantGroupsFor, valuelessVariantConds };
}

// ─── dayanaksız içerik (Haiku 10-23 F3: "Havuz 09:00-20:00 arası açık VE ÜCRETSİZDİR" alıntıda olmayan sözcükle gidiyordu) ─────────

/** İçerik sayılmayan nezaket / dolgu sözcükleri (katlanmış; kök başlangıcı en az 4 harf, kısa olanlar tam). İddia sözcüğü ("free", "ücretsiz") YOK. */
const FILLER_ROOTS = (
  "merhaba selam tabii elbette evet hayir maalesef lutfen rica tesekkur iyi keyifli tatil gunler size sizin sizi bize bizim burada orada " +
  "bulun yer alir almaktadir mevcut kullan dile istediginiz isterseniz zaman her gun aksam sabah gece ogle olarak icin ayrica ancak hemen " +
  "yaklasik herhangi bir tum ilgili konuda aylar sezon donem " +
  "hello sure please thank enjoy your stay you there here located available use welcome also just note kindly would like can will " +
  "every daily the this that these those our are have has get " +
  "hallo gerne bitte danke ihnen ihr wir unser gibt befindet steht nutzen konnen jeden taglich"
).split(" ");
function isFiller(t: string, prev: string): boolean {
  if (t === "free" && prev === "feel") return true;
  if (t === "feel") return true;
  return FILLER_ROOTS.some((r) => t === r || (r.length >= 4 && t.startsWith(r)));
}

/** Aynı kök mü: çekim biçimleri kesişir ya da ortak baş ≥ 4 harf (kısa sözcükte tamamı) — "-lı / -sız" ayrımı korunur (ücretli ≠ ücretsiz). */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = baseForms(a);
  for (const f of baseForms(b)) if (fa.has(f)) return true;
  let cp = 0;
  while (cp < a.length && cp < b.length && a[cp] === b[cp]) cp++;
  // Türkçe kökler kısa ("gir-", "kira-"): ortak baş 4 harf yeter; olumluluk ayrımı zaten olumsuzluk kontrolündedir.
  if (cp < Math.min(4, Math.min(a.length, b.length))) return false;
  const privative = (x: string) => /^s[iu]z/.test(x);
  return privative(a.slice(cp)) === privative(b.slice(cp));
}

function languageOf(text: string): string | null {
  const c = confidentLanguage(text);
  if (c) return c;
  const ev = languageEvidence(text);
  if (ev.size === 1) return [...ev][0];
  // Yalnız Türkçeye özgü harf (ğ ı ş İ — ö / ü Almancada da var): kısa Türkçe parça da kıyaslanır.
  return /[ğışĞİŞ]/u.test(text) ? "tr" : null;
}

/**
 * Parçada alıntının taşımadığı içerik sözcüğü var mı — YALNIZ parça ve alıntı aynı dildeyse (çeviride sözcük kıyası anlamsız; o
 * yol kıdemli okuyucunun kanıt şartında). İçerik = en az 4 harf, rakamsız, nötr / koşul / olumsuzluk / dolgu değil, ihtiyacın kendi
 * sözcüğü değil.
 */
export function unsupportedContent(part: string, evidence: string, needTerms: readonly string[]): boolean {
  const le = languageOf(evidence);
  // Dili kestirilemeyen kısa parça ("Otopark konaklama boyunca 200 TL.") kalemle aynı yazı sistemindeyse kalemin dilinde sayılır (Opus 10-23
  // Y5) — tutma yönünde: kısa İngilizce parça bu yolla içerik farkı verirse tutulur.
  const lp = languageOf(part) ?? (le && scriptOf(part) === scriptOf(evidence) ? le : null);
  if (!lp || lp !== le) return false;
  const ev = tokenize(evidence);
  const pt = tokenize(part);
  return pt.some((t, i) => {
    if (t.length < 4 || /\d/.test(t) || isNeutralWord(t) || isFiller(t, pt[i - 1] ?? "")) return false;
    if (needTerms.length > 0 && needTermsInStrict(needTerms, t) > 0) return false;
    return !ev.some((e) => sameStem(t, e));
  });
}

// ─── Opus 10-23 sertleştirmesi: sayı sözcüğü, ücret kutbu, ücret tabanı, istisna ─────────────────────────────────────────────────

/** Sözcükle yazılmış sayı / saat ("eight pm", "acht Uhr", "в восемь вечера", "akşam sekizde"): rakamlı değer yoksa değer kontrolü atlanırdı. */
const NUMBER_WORDS: ReadonlySet<string> = new Set(
  (
    "two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty hundred noon midday midnight half quarter oclock " +
    "zwei drei vier funf fuenf sechs sieben acht neun zehn elf zwolf zwoelf zwanzig dreissig vierzig funfzig fuenfzig hundert mittag mitternacht halb viertel " +
    "deux trois quatre cinq sept huit neuf dix onze douze vingt trente cinquante cent midi minuit " +
    "dos tres cuatro cinco seis siete ocho nueve diez doce veinte treinta cincuenta cien mediodia medianoche " +
    "два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать двадцать тридцать пятьдесят сто полдень полночь " +
    "iki uc dort bes alti yedi sekiz dokuz yirmi otuz kirk elli bucuk sekizde dokuzda yedide onda"
  ).split(" "),
);
const hasNumberWord = (tokens: readonly string[]) => tokens.some((t) => NUMBER_WORDS.has(t));

const FEE_FREE = new Set("ucretsiz ucretsizdir bedava bedavadir free gratis kostenlos gratuit gratuite gratuito complimentary бесплатно бесплатный бесплатная бесплатное".split(" "));
const FEE_PAID = new Set("ucretli ucretlidir paid charge charged chargeable fee fees kostenpflichtig gebuhr gebuehr payant payante платно платный платная платное".split(" "));
/** Ücret kutbu: "ücretsiz" / "ücretli" (olumsuzlanmış "ücretsiz değil" / "not free" ücretlidir). Diller arası da okunur (Opus 10-23 Y4). */
function feeClasses(tokens: readonly string[]): Set<"free" | "paid"> {
  const out = new Set<"free" | "paid">();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (FEE_FREE.has(t)) {
      const negated = /^degil/.test(tokens[i + 1] ?? "") || NEGATING_PARTICLES.has(tokens[i - 1] ?? "") || (tokens[i - 1] ?? "") === "не";
      out.add(negated ? "paid" : "free");
    } else if (FEE_PAID.has(t)) out.add("paid");
  }
  return out;
}

/** Ücret tabanı (Opus 10-23 Y5): günlük ≠ gecelik ≠ kişi başı ≠ konaklama boyunca. Yalnız TUTAR değerinde okunur ("daily" sıklık da olabilir). */
const BASIS_SINGLE: Readonly<Record<string, string>> = {
  gunluk: "day", gunlugu: "day", daily: "day", taglich: "day",
  gecelik: "night", gecesi: "night", nightly: "night",
  saatlik: "hour", hourly: "hour", stundlich: "hour",
  haftalik: "week", weekly: "week", wochentlich: "week",
};
const BASIS_AFTER_PER: Readonly<Record<string, string>> = {
  night: "night", nights: "night", nacht: "night", nuit: "night", noche: "night", gece: "night",
  day: "day", days: "day", tag: "day", jour: "day", dia: "day", gun: "day",
  person: "person", persons: "person", people: "person", guest: "person", personne: "person", persona: "person", kisi: "person",
  hour: "hour", stunde: "hour", heure: "hour", hora: "hour", saat: "hour",
  week: "week", woche: "week", semaine: "week", semana: "week", hafta: "week",
  stay: "stay", aufenthalt: "stay", sejour: "stay", estancia: "stay", konaklama: "stay",
};
function basisClasses(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (BASIS_SINGLE[t]) out.add(BASIS_SINGLE[t]);
    // "per night / pro Nacht / par nuit / por noche" · Türkçe "kişi başı / gece başı" · "konaklama boyunca" · "for the whole / entire stay".
    if (["per", "pro", "par", "por", "a"].includes(t) && BASIS_AFTER_PER[next]) out.add(BASIS_AFTER_PER[next]);
    if (BASIS_AFTER_PER[t] && /^bas/.test(next)) out.add(BASIS_AFTER_PER[t]);
    if (t === "konaklama" && /^boyunca/.test(next)) out.add("stay");
    if ((t === "whole" || t === "entire") && /^stay/.test(next)) out.add("stay");
  }
  return out;
}

/** İstisna / karşıtlık (Opus 10-23 Y7): "…, köpek hariç", "…, ama köpekler kabul edilmez". */
const EXCEPTION_TOKENS = new Set(
  "haric haricinde disinda except excluding but however ama fakat ausser außer aber sauf mais excepto salvo pero кроме но".split(" "),
);

const scriptOf = (text: string) => (/[Ѐ-ӿ]/u.test(text) ? "cyrillic" : /[Ͱ-Ͽ]/u.test(text) ? "greek" : /[؀-ۿ]/u.test(text) ? "arabic" : "latin");

// ─── ana kural ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function checkAnswerBinding(input: BindingInput): BindingResult {
  const issues = new Set<BindingIssue>();
  const evidence = input.evidence.trim();
  if (!evidence) return { ok: false, issues: ["evidence_missing"] };
  if (!quoteGroundedIn(input.sourceText, evidence)) issues.add("evidence_not_in_source");
  // Konu = nitelik olmayan, genel baş ad ve fiil olmayan sözcükler ("çamaşır makinesi" → "çamaşır"; Opus 10-23 K2) ve onların sözlük
  // konuları ("havuz temizliği" → "havuz" / pool; "temizlik" nitelik).
  const nonAttribute = input.needTerms.filter((t) => !isAttribute(t));
  const specific = nonAttribute.filter((t) => !isGenericOrVerb(t));
  const attributeTopics = new Set(topicsWithSymptomsOf(input.needTerms.filter(isAttribute).join(" ")));
  const subjectTopics = input.needTopics.filter((t) => !attributeTopics.has(t));
  const subj: Subject = {
    terms: specific.length > 0 ? specific : nonAttribute.length > 0 ? nonAttribute : input.needTerms,
    topics: subjectTopics.length > 0 ? subjectTopics : input.needTopics,
  };
  const subjectKnown = subj.terms.length > 0 || subj.topics.length > 0;
  if (!subjectKnown) issues.add("subject_unknown");
  // Konu kimlikleri: ihtiyaç İKİ tesis taşıyorsa ("havuz + sauna", Opus 10-23 K1) parça değerinin konusu kalemdekiyle aynı olmalı.
  const identities = new Set(subj.terms.map(subjectIdentity));
  if (subj.terms.length === 0) for (const t of subj.topics) identities.add(`topic:${t}`);
  // Çok konulu ihtiyaç: kalemde GERÇEKTEN geçen ihtiyaç sözcükleri birden çok kimlik taşıyor ("havuz" + "sauna"). Çeviri çifti ("pazar" /
  // "market", Türkçe sorgu + misafirin dili) kalemde yalnız bir dilde geçtiği için tek konu sayılır.
  const presentIds = new Set(subj.terms.filter((t) => hasSubject(input.sourceText, { terms: [t], topics: [] })).map(subjectIdentity));
  const multiSubject = presentIds.size > 1;

  // Kalemin TAMAMI okunur (Opus 10-23 K3: alıntı cümle parçası olabilir, "Hafta sonu" / "pazar hariç" alıntının dışında kalırdı). Alıntı
  // yalnız dayanak şartıdır; değer kalemin herhangi bir yerinde konuya bağlı ve o yerin bütün kontrollerinden geçiyorsa olur.
  const ev = documentOf(input.sourceText, subj);
  const pdoc = documentOf(input.part, subj);
  const partTokens = tokenize(input.part);
  const partConditions = conditionClasses(partTokens, "part");
  const partNegative = negative(partTokens);
  const partDirections = directions(partTokens);
  const partFee = feeClasses(partTokens);
  const partBasis = basisClasses(partTokens);
  const partException = partTokens.some((t) => EXCEPTION_TOKENS.has(t));
  // Uydurma koşul / taban kıyası istemdeki bütün kaynaklarla (değişke başka kalemde olabilir — O6).
  const sourceTokens = tokenize([input.sourceText, evidence, ...(input.otherSources ?? [])].join("\n"));
  const sourceConditions = conditionClasses(sourceTokens, "evidence");
  const sourceBasis = basisClasses(sourceTokens);
  // Misafirin sorduğu gün ("cumartesi kaçta kapanıyor") — genel kuralın o güne özel söylenişi uydurma koşul değildir.
  const asked = conditionClasses([...input.needTerms], "evidence");
  const otherDocs = (input.otherSources ?? []).filter((t) => t !== input.sourceText).map((t) => documentOf(t, subj));

  /** Parçanın değerleri: kendi gün / mevsim koşulu (değerden sonraki değersiz yan cümle sayılmaz) + kendi yönü + konu yeri. */
  const partClaims: { c: Span; days: Set<string>; dirs: Set<"start" | "end">; negative: boolean; groupSize: number; region: string }[] = [];
  pdoc.sentences.forEach((sent, si) =>
    sent.groups.forEach((g, gi) => {
      const place = pdoc.placeOf(sent, gi, { extraBeforeOnly: true });
      const region = pdoc.boundRegion(si, gi) ?? input.part;
      for (const c of g.claims) {
        partClaims.push({ c, days: new Set(variantClassesOf(place.conditions)), dirs: place.directions, negative: place.negative, groupSize: g.claims.length, region });
      }
    }),
  );
  const singlePartGroup = pdoc.sentences.reduce((n, sent) => n + sent.groups.length, 0) === 1;
  const partIdentitiesAll = subjectIdentitiesIn(input.part, subj, identities);

  /** Parça konusu ↔ kalem konusu (aynı kimlik). Parça konusuz ve ihtiyaç tek konuluysa serbest. */
  const subjectAgrees = (d: Doc, si: number, gi: number, partIds: Set<string>): boolean => {
    // Tek konulu ihtiyaçta bağ zaten kalem tarafında kuruldu; parça tarafı kıyas yalnız çok konulu ihtiyaçta (çeviri kıyası gerekmez).
    if (!multiSubject) return true;
    if (partIds.size === 0) return !multiSubject;
    const evIds = evRegionIds(d, si, gi);
    return evIds.size === 0 || [...partIds].some((x) => evIds.has(x));
  };

  /** İstisna / karşıtlık: cümlede varsa parça da taşımalı (ya da istisnanın gün / mevsim koşulunu anmalı). */
  const sentenceChecks = (info: { exception: boolean; conds: readonly string[] }, local: Set<BindingIssue>) => {
    if (!partException && info.exception) {
      const conds = info.conds;
      if (!(conds.length > 0 && conds.every((cls) => partConditions.has(cls) || coversDay(partConditions, cls)))) local.add("condition_dropped");
    }
  };
  // Çok konulu ihtiyaçta kalem yerinin konu kimlikleri — yer başına bir kez (aynı yer her parça değeri için yeniden sorulur).
  const regionIdCache = new Map<Doc, Map<number, Set<string>>>();
  const evRegionIds = (d: Doc, si: number, gi: number): Set<string> => {
    let m = regionIdCache.get(d);
    if (!m) regionIdCache.set(d, (m = new Map()));
    const key = si * 100_000 + gi;
    let r = m.get(key);
    if (!r) m.set(key, (r = subjectIdentitiesIn(d.boundRegion(si, gi) ?? "", subj, identities)));
    return r;
  };
  // Ücret kutbu PARÇA düzeyinde: parçanın konusunu anan kalem cümleleri (+ ardındaki konusuz devam cümleleri) ne diyor ("Otopark
  // ücretlidir." → "Parking is free." tutulur; "Havuz ücretsiz. Sauna ücretli." → "Sauna ücretsizdir" tutulur).
  if (partFee.size > 0 && subjectKnown) {
    const evFee = new Set<"free" | "paid">();
    let carry = false;
    for (const sent of ev.sentences) {
      const sentText = ev.text.slice(sent.s, sent.e);
      const ids = subjectIdentitiesIn(sentText, subj, identities);
      const about: boolean =
        ids.size > 0 ? !multiSubject || partIdentitiesAll.size === 0 || [...ids].some((x) => partIdentitiesAll.has(x)) : carry && allLocationNeutral(ev.text, sent.s, sent.e);
      carry = about;
      if (!about) continue;
      for (const f of feeClasses(tokenize(sentText))) evFee.add(f);
      if (claimSpans(sentText).claims.some((x) => x.cls === "money")) evFee.add("paid");
    }
    if (partFee.has("free") && !evFee.has("free")) issues.add(evFee.has("paid") ? "polarity_mismatch" : "condition_added");
    if (partFee.has("paid") && evFee.has("free") && !evFee.has("paid")) issues.add("polarity_mismatch");
  }

  /** Gün koşulu taşıyan parça değerlerinin kalemdeki yerleri (tümleyen kararı döngüden sonra). */
  const dayValues: { days: Set<string>; placeGeneral: boolean }[] = [];

  if (partClaims.length > 0) {
    for (const pc of partClaims) {
      const { c, days: valueDays } = pc;
      // Değer alıntının kaleminde ya da istemdeki öteki kalemlerde (aynı ihtiyacın değişkesi başka kalemde olabilir — O6).
      const hits: { d: Doc; si: number; sent: Sentence; gi: number; idx: number }[] = [];
      for (const d of [ev, ...otherDocs]) {
        d.sentences.forEach((sent, si) =>
          sent.groups.forEach((g, gi) => {
            const idx = g.claims.findIndex((e) => sameValue(c, e));
            if (idx >= 0) hits.push({ d, si, sent, gi, idx });
          }),
        );
      }
      if (hits.length === 0) {
        issues.add("value_not_in_evidence");
        continue;
      }
      if (!subjectKnown) continue;
      const bound = hits.filter((h) => h.d.boundAt(h.si, h.gi));
      if (bound.length === 0) {
        issues.add(ev.hasSubjectAnywhere() ? "value_bound_elsewhere" : "subject_missing");
        continue;
      }
      // Değer kalemde birden çok yerde konuya bağlıysa: bütün kontrollerden geçen BİR yer yeter (o yer bu iddiayı tek başına taşır).
      let best: { local: Set<BindingIssue>; placeGeneral: boolean } | null = null;
      let partIds: Set<string> | undefined;
      let omittedHere: boolean | undefined;
      for (const h of bound) {
        const local = new Set<BindingIssue>();
        const place = h.d.placeOf(h.sent, h.gi);
        if (multiSubject) {
          if (!partIds) {
            partIds = subjectIdentitiesIn(pc.region, subj, identities);
            if (partIds.size === 0) partIds = partIdentitiesAll;
          }
          if (!subjectAgrees(h.d, h.si, h.gi, partIds)) local.add("subject_mismatch");
        }
        // Koşul DEĞER BAŞINA (Opus 10-23 Y2): gün / mevsim değerin kendi koşulunda; öteki sınıflar parçanın herhangi bir yerinde.
        for (const cls of place.conditions) {
          if (DAY_CLASSES.has(cls) ? coversDay(valueDays, cls) : SEASON_CLASSES.has(cls) ? valueDays.has(cls) : partConditions.has(cls)) continue;
          local.add("condition_dropped");
        }
        // Olumluluk DEĞER BAŞINA ("Havuz 20:00'de kapanır; pazar günleri kapalı." — 20:00 olumlu).
        if (place.negative !== pc.negative) local.add("polarity_mismatch");
        // Yön DEĞER BAŞINA (Opus 10-23 Y1): aralığın ilk ucu açılış, son ucu kapanış; tek ucu yönsüz veren parça tutulur.
        const g = h.sent.groups[h.gi];
        const role: "start" | "end" | null = g.claims.length >= 2 ? (h.idx === 0 ? "start" : h.idx === g.claims.length - 1 ? "end" : null) : null;
        const pDirs = pc.dirs.size > 0 ? pc.dirs : singlePartGroup ? partDirections : new Set<"start" | "end">();
        if (role) {
          if (pc.groupSize < 2 && (pDirs.size === 0 || !pDirs.has(role))) local.add("direction_mismatch");
        } else if (place.directions.size === 1 && pDirs.size > 0 && !pDirs.has([...place.directions][0])) {
          local.add("direction_mismatch");
        }
        const placeDays = new Set(dayClassesOf(place.conditions));
        const placeSeasons = [...place.conditions].filter((x) => SEASON_CLASSES.has(x));
        // Değerin günü kalemdeki yerinin günü (ya da onun özeli) değilse yanlış güne bağlanmıştır; mevsim de aynı.
        if (placeDays.size > 0) {
          for (const d of dayClassesOf(valueDays)) if (!placeDays.has(d) && !(DAY_PARENT[d] && placeDays.has(DAY_PARENT[d]))) local.add("condition_added");
        }
        if (placeSeasons.length > 0) {
          for (const d of valueDays) if (SEASON_CLASSES.has(d) && !placeSeasons.includes(d)) local.add("condition_added");
        }
        // Koşulsuz değer: kalemde (ve istemdeki öteki kalemlerde) aynı konunun koşullu değişkesi varsa onu da anmalı; genel değer o
        // değişkenin gününe VERİLEMEZ ("Havuz hafta sonu 20:00" ← "hafta sonu 23:00"; "Cumartesi 20:00" ← "Hafta sonu kapalıdır").
        if (placeDays.size === 0 && placeSeasons.length === 0) {
          // Yerden bağımsız (değer + parça koşulu) → parça değeri başına bir kez.
          omittedHere ??= [ev, ...otherDocs].some((d) => variantOmitted(d, c, partConditions, valueDays));
          if (omittedHere) local.add("variant_omitted");
        }
        const info = h.d.sentenceInfo(h.sent);
        // Tutar: ücret tabanı kalemdekiyle aynı (günlük ≠ konaklama boyunca), parça kalemde olmayan taban uyduramaz.
        if (c.cls === "money") {
          const evBasis = info.basis;
          if (evBasis.size > 0 && ![...evBasis].some((b) => partBasis.has(b))) local.add("condition_dropped");
          for (const b of partBasis) if (!sourceBasis.has(b)) local.add("condition_added");
        }
        sentenceChecks(info, local);
        const placeGeneral = placeDays.size === 0;
        if (!best || local.size < best.local.size) best = { local, placeGeneral };
        if (local.size === 0) break;
      }
      if (best) {
        for (const i of best.local) issues.add(i);
        const valueOnlyDays = new Set(dayClassesOf(valueDays));
        if (valueOnlyDays.size > 0) dayValues.push({ days: valueOnlyDays, placeGeneral: best.placeGeneral });
      }
    }
  } else if (hasNumberWord(partTokens)) {
    // Sözcükle yazılmış değer ("eight pm", "vier acht zwei eins"): rakamla doğrulanamaz → tutulur (Opus 10-23 Y6).
    issues.add("value_not_in_evidence");
  } else if (subjectKnown) {
    // Değersiz parça: parçanın konusunu anan yan cümle kendi yüklemini taşıyorsa o yan cümle, taşımıyorsa bütün cümle okunur. Çok konulu
    // ihtiyaçta yalnız PARÇANIN konusunu anan yerler ("Havuz açıktır. Sauna kapalıdır." → "Havuz kapalıdır" tutulur).
    const places: string[] = [];
    const sentencesRead = new Set<Sentence>();
    for (const sent of ev.sentences) {
      for (const cl of sent.clauses) {
        const clause = ev.text.slice(cl[0], cl[1]);
        if (!ev.subjectIn(clause)) continue;
        if (multiSubject && partIdentitiesAll.size > 0) {
          const ids = subjectIdentitiesIn(clause, subj, identities);
          if (ids.size > 0 && ![...ids].some((x) => partIdentitiesAll.has(x))) continue;
        }
        places.push(hasPredicate(tokenize(clause)) ? clause : ev.text.slice(sent.s, sent.e));
        sentencesRead.add(sent);
      }
    }
    if (partIdentitiesAll.size === 0 && multiSubject) issues.add("subject_mismatch");
    // Değersiz parçada alıntı tek dayanaktır: konuyu anmayan alıntı (havuz cümlesiyle "evcil hayvan kabul edilmiyor") dayanak olmaz.
    if (places.length === 0 || !hasSubject(evidence, subj)) issues.add("subject_missing");
    else {
      const r = readPlace(places.join(" . "));
      for (const cls of r.conditions) if (!partConditions.has(cls) && !(DAY_CLASSES.has(cls) && coversDay(partConditions, cls))) issues.add("condition_dropped");
      if (r.negative !== partNegative) issues.add("polarity_mismatch");
      const local = new Set<BindingIssue>();
      for (const st of sentencesRead) sentenceChecks(ev.sentenceInfo(st), local);
      for (const i of local) issues.add(i);
    }
  }

  for (const cls of partConditions) {
    if (!INVENTABLE_CLASSES.has(cls) || sourceConditions.has(cls)) continue;
    // Gün adı: kalemdeki ailesinin özeli ya da misafirin sorduğu gün — değer başına kontrol yukarıda (yanlış güne / değişkeye bağ).
    if (DAY_PARENT[cls] && (sourceConditions.has(DAY_PARENT[cls]) || asked.has(cls))) continue;
    // Tümleyen ("hafta içi" ← genel kural + hafta sonu istisnası): bu koşulu taşıyan HER değer kalemde genel yerden gelmeli; en az bir
    // değer olmalı (değersiz parçada tümleyen yok — temkinli). Aynı değere istisna gününü de veren parça ("hafta içi ve hafta sonu 20:00")
    // değişke kuralında (`variantOmitted`) tutulur.
    const comp = DAY_COMPLEMENT[cls];
    if (comp && sourceConditions.has(comp)) {
      const carriers = dayValues.filter((v) => v.days.has(cls));
      if (carriers.length > 0 && carriers.every((v) => v.placeGeneral)) continue;
    }
    issues.add("condition_added");
  }
  if (unsupportedContent(input.part, evidence, input.needTerms)) issues.add("unsupported_content");
  const list = BINDING_ISSUES.filter((i) => issues.has(i));
  return { ok: list.length === 0, issues: list };
}

/**
 * Kalemde aynı konunun koşullu DEĞİŞKESİ: aynı türden, konuya bağlı, FARKLI ve gün / mevsim koşullu bir değer — ya da değersiz, konuya bağlı
 * gün / mevsim yan cümlesi ("Hafta sonu kapalıdır", "Pazar günleri kapalıdır"; Opus 10-23 Y3). Parça o koşulu anmıyorsa (özeli de sayılır:
 * "cumartesi" hafta sonunu anar) ya da genel değeri o koşulun gününe veriyorsa (`valueDays`) değişke ihmal edilmiştir.
 */
type Doc = ReturnType<typeof documentOf>;

function variantOmitted(src: Doc, c: Span, partConditions: ReadonlySet<string>, valueDays: ReadonlySet<string>): boolean {
  const omitted = (cls: string) =>
    (SEASON_CLASSES.has(cls) && (!partConditions.has(cls) || valueDays.has(cls))) ||
    (DAY_CLASSES.has(cls) && (!coversDay(partConditions, cls) || coversDay(valueDays, cls)));
  for (const g of src.variantGroupsFor(c.cls)) {
    if (g.claims.some((e) => sameValue(c, e))) continue;
    if (g.conds.some(omitted)) return true;
  }
  return src.valuelessVariantConds().some(omitted);
}

/** "№12" / "No 12" / "Nr. 12" kod gibi ayrışır ama SAYI 12'dir (E ölçümü 10-23: Rusça "место №12" ↔ "12 numaralı yer"). */
function keysOf(s: Span): readonly string[] {
  if (s.cls !== "code") return s.keys;
  const extra = s.keys.flatMap((k) => {
    const m = /^c(?:no|nr|num)(\d{1,6})$/i.exec(k);
    return m ? [`n${Number(m[1])}`] : [];
  });
  return extra.length > 0 ? [...s.keys, ...extra] : s.keys;
}

/** Aynı sayısal anahtarı taşıyabilen sınıflar yalnız kendi ailesiyle eşleşir: kat ≠ numara ≠ kişi ("Otopark 12. katta" ← "12 numaralı yer" değil). */
const sameClass = (a: Span, b: Span) => a.cls === b.cls || (a.cls === "code" && b.cls === "number" && keysOf(a) !== a.keys);

/** `a` PARÇANIN değeri, `b` alıntının / kalemin. "№12" yalnız parça tarafında sayıdır (kalemdeki "şifre No12" bir koddur — Haiku 10-23). */
function sameValue(a: Span, b: Span): boolean {
  if (!sameClass(a, b)) return false;
  if (a.tkeys && b.tkeys) return a.tkeys.some((k) => b.tkeys!.includes(k));
  // Alıntıdaki belirsiz saat ("saat 9" = 09:00 | 21:00) parçadaki KESİN saate dayanak olmaz; belirsizliği aynen taşıyan parça olur.
  if (a.cls === "time" && b.keys.length > 1 && a.keys.length === 1) return false;
  return keysOf(a).some((k) => b.keys.includes(k));
}
