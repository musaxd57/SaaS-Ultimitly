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

import { claimSpans, foldForClaims } from "@/lib/ai/claim-support";
import { confidentLanguage, languageEvidence } from "@/lib/ai/language-signal";
import { tokenize as retrievalTokens } from "@/lib/ai/retrieval/text";
import { quoteGroundedIn } from "@/lib/ai/semantic/absence-judge";
import { baseForms, needTermsInStrict } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf as relationTopics } from "@/lib/conversation-items/relation";

/**
 * Sözlük konuları — uzun metinde (kalem / alıntı) çağrılar arası küçük önbellekle (R8 / R13: aynı kalem her ihtiyaç ve her kural için yeniden
 * taranıyordu). Sonuç yalnız metnin kendisinden türer (belge önbelleğiyle aynı ilke: kiracıya özgü durum yok); dizi okunur, değiştirilmez.
 */
const TOPIC_CACHE_MAX = 64;
const topicCache = new Map<string, string[]>();
function topicsWithSymptomsOf(text: string): string[] {
  if (text.length < 64) return relationTopics(text);
  const hit = topicCache.get(text);
  if (hit) {
    topicCache.delete(text);
    topicCache.set(text, hit);
    return hit;
  }
  const v = relationTopics(text);
  topicCache.set(text, v);
  if (topicCache.size > TOPIC_CACHE_MAX) topicCache.delete(topicCache.keys().next().value as string);
  return v;
}

/**
 * Latin harflerinin işaretleri sökülür, ß → ss (Opus dilim sonu 10-23 R1): ortak belirteçleyici yalnız Türkçe harfleri katlıyordu →
 * "schließt", "spätestens", "après", "fermé" sözlükteki ASCII biçimleriyle hiç eşleşmiyor, Almanca kapanış iki tarafta da görünmüyordu.
 * Kiril "й" ve Arapça hemze kalır (yalnız Latin taban harfinin işareti). Bu modülün her okuması (sözlük, konu, içerik) aynı katlamadan geçer.
 */
const LATIN_MARKED = /[À-ɏḀ-ỿ]/u;
function foldMarks(t: string): string {
  return LATIN_MARKED.test(t) ? t.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").replace(/ß/g, "ss").normalize("NFC") : t;
}
// "№" NFKC'de "No" olur → olumsuzluk sanılıyordu ("место № 12" — R12); numara işareti sözcük değildir.
const tokenize = (s: string): string[] => retrievalTokens(s.replace(/№/g, " ")).map(foldMarks);

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
  "value_conflict",
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
  for (const b of baseForms(t)) {
    if (!table[b]) continue;
    // Gün adı bulunma ekiyle kullanılmaz ("salı günü", "salıları"): İspanyolca "salida" (çıkış) salı sanılıyordu (Opus dilim sonu 10-23 R12).
    if (DAY_CLASSES.has(table[b]) && /^n?[dt][ae]$/.test(t.slice(b.length))) continue;
    return table[b];
  }
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
  // "fermée" katlanınca (R1); eril "fermé" = "ferme", ardından değer gelirse fiildir (`negAt`).
  "fermee",
  "fermees",
  "cerrado",
  "prohibido",
  "nunca",
  // Rusça / İtalyanca / Portekizce / Arapça / Felemenkçe / Lehçe (Opus güvenlik 10-23 F3: "Домашние животные не допускаются" ←
  // "Evcil hayvan kabul edilir" geçiyordu). "bez" bilerek YOK (Türkçede "bez" = kumaş).
  "не",
  "нет",
  "нельзя",
  "запрещено",
  "запрещен",
  "запрещены",
  "закрыт",
  "закрыто",
  "non",
  "vietato",
  "vietata",
  "chiuso",
  "chiusa",
  "senza",
  "mai",
  "nao",
  "não",
  "proibido",
  "proibida",
  "fechado",
  "fechada",
  "لا",
  "ممنوع",
  "مغلق",
  "niet",
  "geen",
  "verboden",
  "gesloten",
  "zonder",
  "nooit",
  "zakaz",
  "zabronione",
  "zamkniete",
]);
/** Ardındaki olumsuz sözcüğü OLUMLUYA çeviren olumsuzluk ekleri ("not prohibited", "nicht verboten", "не запрещено", "non vietato"). */
const NEGATING_PARTICLES: ReadonlySet<string> = new Set([
  "not", "never", "no", "nicht", "nie", "pas", "jamais", "t", "kein", "keine", "nunca", "не", "non", "nao", "não", "niet", "geen", "لا",
]);

/** Türkçe olumsuz fiil ekleri (katlanmış): "edilmiyor / kiralamıyoruz / izin verilmez / giremezsiniz / etmem / kabul edilmemektedir". */
function negativeVerb(t: string): boolean {
  return (
    t.length > 5 &&
    (/m[iu]yor(um|uz|sun|sunuz|lar)?$/.test(t) || /m[ae]z(siniz|sin|lar|ler|iz|im)?$/.test(t) || /m[ae]m[ae]kt[ae]d[iu]r$/.test(t) || /m[ae]m$/.test(t))
  );
}

/** "no (extra) charge" / "without charge" / "keine Gebühr" ücret yokluğudur (ücretsiz), olumsuz cevap değil — ücret kutbu ayrıca okur. */
const FEE_NOUN = /^(?:charge|charges|fee|fees|cost|costs|gebuhr|gebuehr|frais|cargo|плат)/;
function feeAbsence(tokens: readonly string[], i: number): boolean {
  const n1 = tokens[i + 1] ?? "";
  const n2 = tokens[i + 2] ?? "";
  return FEE_NOUN.test(n1) || (/^(?:extra|additional|zusatzlich|supplementaire|adicional)/.test(n1) && FEE_NOUN.test(n2));
}

function negAt(tokens: readonly string[], i: number): boolean {
  const t = tokens[i];
  if (["no", "without", "kein", "keine", "keinen", "sans", "sin", "без"].includes(t) && feeAbsence(tokens, i)) return false;
  // Sınır öbeği ("no later than", "не позднее") ve Fransızca "ferme à 20:00" (kapanır) olumsuzluk değildir — yön okumasında (R1).
  if (boundPhraseAt(tokens, i)) return false;
  // "no more than 2 pets" / "not less than" — sınır, olumsuzluk değil (sınıfı `boundsOf`).
  if ((t === "no" || t === "not") && /^(?:more|less|fewer)$/.test(tokens[i + 1] ?? "") && tokens[i + 2] === "than") return false;
  if (t === "ferme" && valueAhead(tokens, i)) return false;
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
const START_TOKENS = new Set([
  "acilir", "acilis", "aciliyor", "acilmaktadir", "acilip", "baslar", "basliyor", "baslamaktadir", "baslamakta", "baslangic", "itibaren", "sonra", "opens", "opening", "from", "after", "starts", "begins",
  "oeffnet", "offnet", "ab", "nach", "apres", "desde",
  // Sınır sözcükleri (Opus güvenlik 10-23 F8): en erken = başlangıç.
  "earliest", "fruhestens", "fruehestens", "dalle", "dalla", "после",
  // Öteki dillerin açılış / başlangıç fiilleri (Opus dilim sonu 10-23 R1: "Бассейн открывается", "abre", "ouvre", "beginnt" yön taşımıyordu).
  "starting", "beginnt", "offnen", "oeffnen", "abre", "abren", "empieza", "empiezan", "comienza", "comienzan", "ouvre", "ouvrent", "apre", "aprono",
  "inizia", "открывается", "открываются", "начинается", "начинаются", "يفتح", "تفتح", "يبدأ", "تبدأ",
]);
const END_TOKENS = new Set([
  "kapanir", "kapanis", "kapaniyor", "kapanmaktadir", "kapanip", "kapatilir", "kapatiliyor", "kapatilmaktadir", "biter", "bitiyor", "bitmektedir", "bitis", "kadar", "once", "closes", "closing", "until", "till", "before", "ends",
  "schliesst", "bis", "vor", "avant", "hasta",
  // En geç = bitiş ("Check-out en geç 11:00" → "check out after 11:00" geçiyordu, Opus güvenlik 10-23 F8).
  "latest", "spatestens", "spaetestens", "entro", "до",
  // R1: öteki dillerin kapanış / bitiş fiilleri.
  "finishes", "endet", "enden", "schliessen", "cierra", "cierran", "termina", "terminan", "ferment", "chiude", "chiudono", "finisce", "fino", "jusqu",
  "закрывается", "закрываются", "заканчивается", "заканчиваются", "يغلق", "تغلق", "ينتهي", "تنتهي", "حتى",
  // R2: "Son giriş saati 23:00" / "en son" / "last check-in" / "sona erer" / "kilitlenir" bitiştir (giriş başlangıç DEĞİL).
  "last", "letzte", "letzter", "letzten", "последний", "последнее", "последняя", "sona", "bitiyor", "kilitlenir", "kilitleniyor", "locks",
]);
/** Yalnız ardından değer gelince yön olan sözcükler ("open at 9", "close at 20:00", "by 15:00", "ferme à 20:00", "até às 20:00", "с 11:00"); "close to
 * the beach", "by car", "с балконом" yön değildir. */
const CONTEXT_START = new Set(["open", "start", "begin", "с"]);
const CONTEXT_END = new Set(["close", "end", "finish", "by", "ferme", "ate", "fecha", "fecham", "encerra"]);
const VALUE_LINKS = new Set(["at", "um", "a", "las", "la", "le", "the", "around", "daily", "alle", "as", "o", "в", "الساعة"]);
function valueAhead(tokens: readonly string[], i: number): boolean {
  for (let k = i + 1; k <= i + 3 && k < tokens.length; k++) {
    // Saat değeri ("09:00", "9 am", "20h"); süre / sıklık değil ("open 24/7", "open 24 hours", "7 days a week" — Haiku 10-23 gece-2).
    if (/^\d/.test(tokens[k])) return /^\d{1,2}:\d{2}$/.test(tokens[k]) || !/^(?:\d+|hours?|hrs?|saat|days?|gun|gunu|weeks?|hafta|minutes?|dakika|stunden?|tage?|jours?|dias?|horas?)$/.test(tokens[k + 1] ?? "");
    if (!VALUE_LINKS.has(tokens[k])) return false;
  }
  return false;
}
/** Olumsuz sınır öbeği yalnız ardından "than / als / que" ya da saat gelirse ("no later than 11:00", "nicht vor 15 Uhr", "не позднее 11:00");
 * "There is no later check-out" (geç çıkış YOK) olumsuzluktur (Haiku 10-23 gece-2). */
function boundPhraseAt(tokens: readonly string[], i: number): boolean {
  const next = tokens[i + 1] ?? "";
  if (!BOUND_NEGATORS.has(tokens[i]) || !(LATER_WORDS.has(next) || EARLIER_WORDS.has(next))) return false;
  return /^(?:than|als|que|che)$/.test(tokens[i + 2] ?? "") || valueAhead(tokens, i + 1);
}
/** Olumsuz sınır öbekleri: "no later than / not after / nicht später / не позднее" bitiş, "no earlier than / not before / nicht vor / не ранее"
 * başlangıç — olumsuzluk değildir (R1: "check out no later than 11:00" olumsuzluk sanılıp tutuluyordu). */
const BOUND_NEGATORS = new Set(["no", "not", "nicht", "не"]);
const LATER_WORDS = new Set(["later", "after", "spater", "spaeter", "nach", "позднее", "позже"]);
const EARLIER_WORDS = new Set(["earlier", "before", "fruher", "frueher", "vor", "ранее", "раньше"]);
function directions(tokens: readonly string[]): Set<"start" | "end"> {
  const out = new Set<"start" | "end">();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (boundPhraseAt(tokens, i)) {
      out.add(LATER_WORDS.has(next) ? "end" : "start");
      i++;
      continue;
    }
    if (START_TOKENS.has(t)) out.add("start");
    if (END_TOKENS.has(t)) out.add("end");
    if (CONTEXT_START.has(t) && valueAhead(tokens, i)) out.add("start");
    if (CONTEXT_END.has(t) && valueAhead(tokens, i)) out.add("end");
    // Türkçe "son giriş / en son" bitiştir; İspanyolca "son las 11:00" (= saat 11:00'dir), Fransızca "son check-out" değil.
    if (t === "son" && !/^(?:las|los|les|la|el|de|du|des|un|une|a)$/.test(next) && !/^\d/.test(next)) out.add("end");
    // İki belirteçli sınırlar: "en geç" / "en erken" · "au plus tard / tôt" · "a más tardar".
    if ((t === "en" && next === "gec") || (t === "plus" && next === "tard") || (t === "mas" && next === "tardar")) out.add("end");
    if ((t === "en" && next === "erken") || (t === "plus" && next === "tot") || (t === "a" && next === "partir")) out.add("start");
  }
  return out;
}

/**
 * Alt / üst sınır (Opus dilim sonu 10-23 R3: "Minimum konaklama 3 gecedir" → "The maximum stay is 3 nights" geçiyordu — yön sözcüğü değil, koşul
 * da değil). "min" (dakika) ve "au plus tard" (en geç = yön) sınır değildir.
 */
const MIN_ROOTS = ["minimum", "minimal", "mindestens", "asgari", "минимум", "almeno", "minimo"];
const MAX_ROOTS = ["maksimum", "maks", "maximum", "max", "azami", "hochstens", "hoechstens", "maximal", "максимум", "massimo", "maximo"];
function boundsOf(tokens: readonly string[]): Set<"min" | "max"> {
  const out = new Set<"min" | "max">();
  const root = (t: string, roots: readonly string[]) => roots.some((r) => t === r || (r.length >= 4 && t.startsWith(r)));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (root(t, MIN_ROOTS) || (t === "en" && next === "az") || (t === "at" && next === "least") || (t === "al" && next === "menos") || (t === "au" && next === "moins")) out.add("min");
    if ((t === "не" && next === "менее") || (t === "no" && next === "less")) out.add("min");
    if (root(t, MAX_ROOTS) || (t === "en" && /^fazla/.test(next)) || (t === "up" && next === "to") || (t === "at" && next === "most") || (t === "no" && next === "more")) out.add("max");
    if ((t === "не" && next === "более") || (t === "au" && next === "plus" && tokens[i + 2] !== "tard")) out.add("max");
    // "more than / over 14 / longer than / 14 geceden fazla / mehr als / plus de / más de / более" alt; "less than / under / weniger als /
    // moins de / menos de / менее" üst sınır (Haiku 10-23 gece-2: "En fazla 14 gece" → "More than 14 nights" geçiyordu).
    const prev = tokens[i - 1] ?? "";
    if (((t === "more" || t === "longer") && next === "than" && prev !== "no" && prev !== "not") || (t === "over" && valueAhead(tokens, i)) || (t === "mehr" && next === "als")) out.add("min");
    if (((t === "plus" || t === "mas") && next === "de" && prev !== "au") || (t === "более" && prev !== "не") || (t === "fazla" && prev !== "en" && /(?:d|t)[ae]n$/.test(prev))) out.add("min");
    if (((t === "less" || t === "fewer" || t === "shorter") && next === "than" && prev !== "no") || (t === "under" && valueAhead(tokens, i)) || (t === "weniger" && next === "als")) out.add("max");
    if (((t === "moins" || t === "menos") && next === "de" && prev !== "au" && prev !== "al") || (t === "менее" && prev !== "не")) out.add("max");
  }
  return out;
}
/** Değerin sınırı: açık sınır sözcüğü + (saat / tarih dışında) tek yön — "4 kişiye kadar" üst, "200 TL'den itibaren" alt sınırdır. */
function effectiveBounds(bounds: ReadonlySet<"min" | "max">, dirs: ReadonlySet<"start" | "end">, cls: string): Set<"min" | "max"> {
  const out = new Set(bounds);
  if (cls === "time" || cls === "date" || dirs.size !== 1) return out;
  out.add(dirs.has("start") ? "min" : "max");
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

/** Kaba ön süzgeç — `hasSubject`in üst kümesi (niteleyen konum ve kaba sözlük konusu da sayılır): metin konuyu herhangi bir biçimde anıyor mu. */
function mentionsSubject(text: string, subj: Subject): boolean {
  if (subj.terms.length > 0 && tokenize(text).some((t) => t.length >= 3 && needTermsInStrict(subj.terms, t) > 0)) return true;
  return subj.topics.length > 0 && topicsWithSymptomsOf(text).some((t) => subj.topics.includes(t));
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

/** Ölçü birimi sözcükleri ("3 nights", "2 saat", "4 kişi") — konu değil; diller arası karşılığı kalemde başka sözcükle geçer (R13: "minimum nights"). */
const UNIT_ROOTS = "nigh gece nacht nuit noch ноч day gun tag jour dia дн hour saat stund heur hora час week haft woch semai seman недел pers peop kisi челов minu daki".split(" ");

/** Çok dilli işlev sözcükleri (zamir / iyelik / kip / tanımlık) — misafirin kendi sözcüklerinden ihtiyaç sözcüğüne karışır, konu değildir. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    "ich du sie wir ihr mein meine meinen meiner dein deine darf kann konnen muss will soll oder der die das den dem des ein ist sind hat haben " +
    "je tu il elle nous vous ils mon ma mes ton est sont puis peut yo el ella nosotros mis son puedo puede podemos io lui lei noi voi mio mia sono " +
    "posso possiamo you we they our can may must will would could should ben sen biz siz onlar benim bizim я ты он она мы вы они мой моя можно могу " +
    "как где когда это"
  ).split(" "),
);

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
const PREDICATE_WORDS = new Set(["var", "yok", "degil", "mevcut", "is", "are", "was", "were", "has", "have", "allowed", "available", "permitted", "provided", "accepted", "welcome", "ist", "sind", "gibt", "erlaubt", "est", "sont", "possible", "moglich", "posible", "possibile"]);
function hasPredicate(tokens: readonly string[]): boolean {
  return tokens.some(
    (t) => PREDICATE_WORDS.has(t) || NEGATION_TOKENS.has(t) || negativeVerb(t) || /([dt][iu]r|[iu]yor(uz|lar)?|[ae]bilir|[iu]l[iu]r|[ae]n[iu]r|[iu]n[iu]r)$/.test(t),
  );
}

/** Sözcükler (katlanmış) + metindeki konumları; `end` HAM uzunluktan (ß → ss katlaması uzunluğu değiştirir). */
function words(text: string, from: number, to: number): { w: string; at: number; end: number }[] {
  const out: { w: string; at: number; end: number }[] = [];
  if (to <= from) return out;
  for (const m of text.slice(from, to).matchAll(WORD_RE)) {
    const at = from + (m.index ?? 0);
    out.push({ w: foldMarks(m[0]), at, end: at + m[0].length });
  }
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

    // Nötr olmayan sözcüklerin önek sayımı (cümle başına bir kez): yan cümle başından her grubun değerine kadar yeniden yürümek uzun virgülsüz
    // yan cümlede karesel oluyordu (Opus güvenlik 10-23 F4: virgülsüz 24.000 karakterlik kalemde 3,7 sn). Aralığın ucunu kesen sözcük
    // `allNeutral` gibi kesik hâliyle okunur → sonuç birebir aynı.
    const ws = words(text, s, e);
    const bad = new Int32Array(ws.length + 1);
    ws.forEach((x, i) => (bad[i + 1] = bad[i] + (isNeutralWord(x.w) ? 0 : 1)));
    const firstAtOrAfter = (x: number) => {
      let lo = 0;
      let hi = ws.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ws[mid].at < x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const neutralIn = (a: number, b: number): boolean => {
      if (b <= a) return true;
      const lo = firstAtOrAfter(a);
      const hi = firstAtOrAfter(b);
      if (lo > 0) {
        const p = ws[lo - 1];
        const end = p.end;
        if (end > a && !allNeutral(text, a, Math.min(end, b))) return false;
      }
      if (hi > lo) {
        const last = ws[hi - 1];
        if (last.end > b) return allNeutral(text, last.at, b) && bad[hi - 1] - bad[lo] === 0;
      }
      return bad[hi] - bad[lo] === 0;
    };

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
      return neutralIn(clauseStart, g.at) ? inherited : Math.max(inherited, clauseStart);
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
  /** Alt / üst sınır ("en az / minimum / at least" ↔ "en fazla / maksimum / up to") — yalnız kendi yan cümlesinden (R3). */
  bounds: Set<"min" | "max">;
}

/**
 * Değerin hemen ardındaki hâl eki — ayrılma ("09:00'dan"), bulunma ("20:00'de"), yönelme ("10:30'a", "20:00'ye"); ardından harf / rakam
 * gelmez. Sıra önemli: ayrılma eki bulunma ekiyle başlar.
 */
const CASE_AFTER: readonly (readonly [string, RegExp])[] = [
  ["abl", /^[’'`]?n?[dt][ae]n(?![\p{L}\p{N}])/u],
  ["loc", /^[’'`]?n?[dt][ae](?![\p{L}\p{N}])/u],
  ["dat", /^[’'`]?y?[ae](?![\p{L}\p{N}])/u],
];
function caseAfter(text: string, at: number): string | null {
  const s = text.slice(at, at + 5);
  for (const [k, re] of CASE_AFTER) if (re.test(s)) return k;
  return null;
}

function readPlace(text: string): PlaceReading {
  const t = tokenize(text);
  return { conditions: conditionClasses(t, "evidence"), negative: negative(t), directions: directions(t), bounds: boundsOf(t) };
}

/** Bir metnin (alıntı ya da kalem) yapısı + konu ve yer okumaları; her tablo bir kez kurulur → toplam doğrusal. */
function documentOf(raw: string, subj: Subject) {
  // "№" NFKC'de "No" olur (olumsuzluk sanılır — R12); uzunluk korunur.
  const { text, claims } = claimSpans(raw.replace(/№/g, " "));
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
      r = { conditions: new Set(parts.flatMap((p) => [...p.conditions])), negative: parts.some((p) => p.negative), directions: new Set(), bounds: new Set() };
      extraCache.set(sent, r);
    }
    return r;
  };
  // Değerin yan cümlesinden ÖNCEKİ değersiz yan cümleler (parça tarafı: "Hafta sonları: havuz 23:00'e kadar açık." — ama "Havuz 23:00'de
  // kapanır, hafta sonu da açık." değere gün BAĞIŞLAMAZ, Opus 10-23 Y2). Önek okumaları cümle başına bir kez (tek değerli cümlede doğrusal).
  const extraBefore = (sent: Sentence, ownCi: number): PlaceReading => {
    let pre = beforeCache.get(sent);
    if (!pre) {
      pre = [{ conditions: new Set(), negative: false, directions: new Set(), bounds: new Set() }];
      for (let ci = 0; ci < sent.clauses.length; ci++) {
        const last = pre[ci];
        if (!extraEligible(sent, ci)) {
          pre.push(last);
          continue;
        }
        const p = clausePlace(sent, ci);
        const grows = [...p.conditions].some((c) => !last.conditions.has(c)) || (p.negative && !last.negative);
        pre.push(grows ? { conditions: new Set([...last.conditions, ...p.conditions]), negative: last.negative || p.negative, directions: last.directions, bounds: last.bounds } : last);
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
    // Aralıktaki koşul sınıfları önek sayımlarından (cümle başına bir kez): virgülle dizilmiş binlerce değerde her grup için aralığı
    // yeniden yürümek karesel olurdu (Haiku 10-23).
    const prefix = condPrefixOf(sent);
    for (const [c, counts] of prefix) {
      if (counts[ownCi] - counts[lo] <= 0) continue;
      if ((DAY_CLASSES.has(c) && ownDay) || (SEASON_CLASSES.has(c) && ownSeason)) continue;
      conditions.add(c);
    }
    const reading = { conditions, negative: own.negative || extra.negative, bounds: own.bounds, directions: own.directions.size > 0 ? own.directions : (ellipticDirection(sent, gi) ?? labelDirection(sent, gi) ?? own.directions) };
    row[gi] = reading;
    return reading;
  };
  /**
   * Türkçe eksiltili yüklem (E ölçümü v4 + Opus güvenlik 10-23 F8): "Kahvaltı hafta içi 10:30'a, hafta sonu 11:00'e kadar" · "Havuz hafta
   * içi 09:00'da, hafta sonu 10:00'da açılır" · "Havuz 09:00'dan, sauna 10:00'dan itibaren açık". Kendi yan cümlesinde yön sözcüğü olmayan
   * TEK değer, ardından AYNI hâl ekini taşıyan değerler geliyorsa yönünü dizinin ilk yönlü yan cümlesinden alır. Ek farklıysa ("10:30'da, …
   * 11:00'e kadar") ya da o yan cümle iki yönlüyse yön verilmez. İki taraf (parça + kalem) aynı okur.
   */
  const ellipticCache = new Map<Sentence, (Set<"start" | "end"> | null)[]>();
  const ellipticDirection = (sent: Sentence, gi: number): Set<"start" | "end"> | null => {
    if (sent.groups[gi].claims.length !== 1) return null;
    let row = ellipticCache.get(sent);
    if (!row) {
      // Sondan başa tek geçiş (uzun virgüllü değer dizisinde değer başına zinciri yeniden yürümek karesel olurdu): `chain[k]` = k. grubun
      // ardındaki aynı ekli dizinin verdiği yön. Paylaşılan okuma kümesi — değiştirilmez.
      const n = sent.groups.length;
      // Yön alan değer yan cümlesinin SONUNDA olmalı (yalnız hâl eki + noktalama): kendi yüklemi olan yan cümle ("kahvaltı 08:00'de VERİLİR",
      // "temizlikçi 10:00'da GELİR") eksiltili değildir, komşusunun yönünü almaz (Opus dilim sonu 10-23 R4).
      // Yalnız kısa kuyruk okunur (uzun virgülsüz yan cümlede her değer için sona kadar kesmek karesel olurdu).
      const kases = sent.groups.map((g, k) => {
        const b = sent.clauses[sent.groupClause[k]][1];
        return b - g.end <= 12 && /^[’'`]?\p{L}{0,4}[\s\p{P}]*$/u.test(text.slice(g.end, b)) ? caseAfter(text, g.end) : null;
      });
      const kasesAny = sent.groups.map((g) => caseAfter(text, g.end));
      row = new Array<Set<"start" | "end"> | null>(n).fill(null);
      // Devralınan yön değerin doğal yönüyle çelişemez: "Resepsiyon 09:00'da açılır, check-out 11:00'de." çıkışa "açılır" vermez (Opus dilim sonu
      // 10-23 R4; yalnız yan cümle sonundaki değer alır → kendi yan cümlesi kısa, okuma doğrusal).
      const fits = (k: number, d: Set<"start" | "end"> | null) => {
        if (!d || !sent.groups[k].claims.every((c) => c.cls === "time")) return d;
        const nat = checkInOutNatural(text.slice(sent.clauses[sent.groupClause[k]][0], sent.groups[k].end));
        return nat && !d.has(nat) ? null : d;
      };
      for (let k = n - 2; k >= 0; k--) {
        if (!kases[k] || kasesAny[k + 1] !== kases[k]) continue;
        const nd = clausePlace(sent, sent.groupClause[k + 1]).directions;
        row[k] = fits(k, nd.size === 1 ? nd : nd.size > 1 ? null : row[k + 1]);
      }
      // İleri eksilti (Haiku 10-23 gece #6): "Havuz 20:00'de kapanır, sauna 22:00'de." — yüklem öndeki aynı ekli değerden; geri yön önceliklidir.
      for (let k = 1; k < n; k++) {
        if (row[k] || !kases[k] || kasesAny[k - 1] !== kases[k] || clausePlace(sent, sent.groupClause[k]).directions.size > 0) continue;
        const pd = clausePlace(sent, sent.groupClause[k - 1]).directions;
        row[k] = fits(k, pd.size === 1 ? pd : pd.size > 1 ? null : row[k - 1]);
      }
      ellipticCache.set(sent, row);
    }
    return row[gi];
  };
  /**
   * Etiket biçimi (Haiku 10-23 gece #5): "Havuz kapanış saati: 20:00" / "Pool closing time: 20:00" — yön sözcüğü iki noktanın ÖBÜR yanında,
   * değerin konu yerinde. Yalnız konu yeri başka bir değer taşımıyorsa ve tek yön veriyorsa.
   */
  const labelDirection = (sent: Sentence, gi: number): Set<"start" | "end"> | null => {
    if (sent.regionSeg[gi] !== gi) return null;
    const d = directions(tokenize(text.slice(sent.regionFrom[gi], sent.groups[gi].at)));
    return d.size === 1 ? d : null;
  };
  /** Cümlenin yan cümle koşullarının önek sayımları: `counts[k]` = ilk k yan cümlede o sınıfı taşıyanların sayısı. */
  const condPrefixCache = new Map<Sentence, Map<string, Int32Array>>();
  const condPrefixOf = (sent: Sentence): Map<string, Int32Array> => {
    let m = condPrefixCache.get(sent);
    if (m) return m;
    m = new Map();
    const n = sent.clauses.length;
    for (let ci = 0; ci < n; ci++) {
      for (const c of clausePlace(sent, ci).conditions) {
        let counts = m.get(c);
        if (!counts) m.set(c, (counts = new Int32Array(n + 1)));
        counts[ci + 1] += 1;
      }
    }
    for (const counts of m.values()) for (let k = 1; k <= n; k++) counts[k] += counts[k - 1];
    condPrefixCache.set(sent, m);
    return m;
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
  /**
   * Konu yerinin konu kimlikleri (çok konulu ihtiyaç): yer = grup bitişlerine göre bölünmüş parçaların birleşimi → parça başına bir kez okunur,
   * yer başına yalnız küçük kümeler birleşir (Opus dilim sonu 10-23 R8: virgülle dizilmiş 380 değerde her değer yeri cümle başından yeniden
   * okunuyordu — ihtiyaç başına 2,4 sn). Belge önbellekte → tur içinde de yeniden kullanılır.
   */
  const subjectIds = new Set(subj.terms.map(subjectIdentity));
  if (subj.terms.length === 0) for (const t of subj.topics) subjectIds.add(`topic:${t}`);
  const segIdCache = new Map<Sentence, Set<string>[]>();
  const segIds = (sent: Sentence, k: number): Set<string> => {
    let row = segIdCache.get(sent);
    if (!row) segIdCache.set(sent, (row = []));
    return (row[k] ??= subjectIdentitiesIn(text.slice(k > 0 ? sent.groups[k - 1].end : sent.s, sent.groups[k].end), subj, subjectIds));
  };
  const prevSentenceIds: (Set<string> | undefined)[] = [];
  const regionIdMemo: (Set<string> | undefined)[][] = [];
  const regionIdentities = (si: number, gi: number): Set<string> => {
    const row = (regionIdMemo[si] ??= []);
    const hit = row[gi];
    if (hit) return hit;
    const sent = sentences[si];
    let out: Set<string>;
    if (boundTo(sent, gi)) {
      const from = sent.regionFrom[gi];
      const k0 = sent.regionSeg[gi];
      const firstFrom = k0 > 0 ? sent.groups[k0 - 1].end : sent.s;
      out = new Set(from > firstFrom ? subjectIdentitiesIn(text.slice(from, sent.groups[k0].end), subj, subjectIds) : segIds(sent, k0));
      for (let k = k0 + 1; k <= gi; k++) for (const x of segIds(sent, k)) out.add(x);
    } else if (boundAt(si, gi)) {
      const prev = sentences[si - 1];
      out = prevSentenceIds[si - 1] ??= subjectIdentitiesIn(text.slice(prev.s, prev.e), subj, subjectIds);
    } else out = new Set();
    return (row[gi] = out);
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
  /**
   * Konuya bağlı yerlerin koşul sınıfları: bağlı değer gruplarının yeri + konuyu anan değersiz yan cümleler. Öteki kalemlerden uydurma
   * koşul kıyasına YALNIZ bunlar girer (Haiku 10-23: ilgisiz kalemin "hafta sonu kahvaltı" sözü havuz parçasındaki "hafta sonu"nu
   * doğrulamasın).
   */
  /**
   * Konuya bağlı TEK değerli gruplar (değer türüne göre, belge başına bir kez) — çelişki kuralı (Opus güvenlik 10-23 F6): aynı konunun aynı
   * türden, aynı yönde, koşulsuz İKİ farklı değeri ("Havuz 20:00'de kapanır." + "A Blok havuzu 22:00'de kapanır.", eski başlık "Havuz 23:00").
   * Aralık / liste grubu ("09:00-20:00", "08:00, 09:00 ve 10:00") çelişki sayılmaz.
   */
  const boundSiteCache = new Map<string, { si: number; gi: number; claim: Span }[]>();
  const boundSitesFor = (cls: string) => {
    let list = boundSiteCache.get(cls);
    if (!list) {
      list = [];
      for (let si = 0; si < sentences.length; si++) {
        const groups = sentences[si].groups;
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          if (g.claims.length === 1 && g.claims[0].cls === cls && boundAt(si, gi)) list.push({ si, gi, claim: g.claims[0] });
        }
      }
      boundSiteCache.set(cls, list);
    }
    return list;
  };
  let subjectConds: Set<string> | undefined;
  const subjectConditions = (): Set<string> => {
    if (subjectConds) return subjectConds;
    const out = new Set<string>();
    sentences.forEach((sent, si) =>
      sent.groups.forEach((_, gi) => {
        if (boundAt(si, gi)) for (const c of placeOf(sent, gi).conditions) out.add(c);
      }),
    );
    for (const sent of sentences) {
      sent.clauses.forEach(([a, b], ci) => {
        if (sent.valuedClause[ci]) return;
        const clause = text.slice(a, b);
        if (subjectIn(clause)) for (const c of conditionClasses(tokenize(clause), "evidence")) out.add(c);
      });
    }
    return (subjectConds = out);
  };
  return { text, sentences, subjectIn, boundAt, boundRegion, regionIdentities, placeOf, hasSubjectAnywhere, sentenceInfo, variantGroupsFor, valuelessVariantConds, subjectConditions, boundSitesFor };
}

/**
 * Kalem belgeleri tur içinde yeniden kullanılır (Opus güvenlik 10-23 F4: aynı istemdeki kalemler her ihtiyaç için yeniden ayrıştırılıyordu).
 * Anahtar = konu + metnin TAMAMI (aynı metin + aynı konu → aynı belge; belge saf okumalardan ibaret). Küçük, en eski çıkar.
 */
const DOC_CACHE_MAX = 64;
const docCache = new Map<string, Doc>();
function cachedDocument(raw: string, subj: Subject): Doc {
  const key = `${subj.terms.join("\u0002")}\u0001${subj.topics.join("\u0002")}\u0001${raw}`;
  const hit = docCache.get(key);
  if (hit) {
    docCache.delete(key);
    docCache.set(key, hit);
    return hit;
  }
  const d = documentOf(raw, subj);
  docCache.set(key, d);
  if (docCache.size > DOC_CACHE_MAX) docCache.delete(docCache.keys().next().value as string);
  return d;
}

/**
 * Bir değerin incelenen kalem yeri tavanı: aynı değer yüzlerce kez geçen (kiracının yazdığı) kalemde her yer için konu yerini yeniden okumak
 * karesel olurdu. Tavanı aşan kalemde temiz yer bulunamazsa parça TUTULUR (güvenli yön); doğal kalemde bir değer birkaç yerde geçer.
 */
const MAX_SITES_PER_VALUE = 48;
/** Rakip değer taraması tavanı (konu yeri sözcükleri yer başına bir kez okunur); aşan kalem tarife sayılır → tutulur (Haiku 10-23 gece #8). */
const MAX_RIVAL_SITES = 240;

// ─── dayanaksız içerik (Haiku 10-23 F3: "Havuz 09:00-20:00 arası açık VE ÜCRETSİZDİR" alıntıda olmayan sözcükle gidiyordu) ─────────

/** İçerik sayılmayan nezaket / dolgu sözcükleri (katlanmış; kök başlangıcı en az 4 harf, kısa olanlar tam). İddia sözcüğü ("free", "ücretsiz") YOK. */
const FILLER_ROOTS = (
  "merhaba selam tabii elbette evet hayir maalesef lutfen rica tesekkur iyi keyifli tatil gunler size sizin sizi bize bizim burada orada " +
  "bulun yer alir almaktadir mevcut kullan dile istediginiz isterseniz her gun olarak icin ayrica ancak hemen " +
  "yaklasik herhangi bir tum ilgili konuda aylar sezon donem " +
  "hello sure please thank enjoy your stay you there here located available use welcome also just note kindly would like can will " +
  "every daily the this that these those our are have has get " +
  "hallo gerne bitte danke ihnen ihr wir unser gibt befindet steht nutzen konnen jeden taglich " +
  // Nezaket kapanışları (Haiku 10-23 gece #4: "We hope you enjoy your stay." / "Wir wünschen Ihnen einen schönen Aufenthalt." yabancı dil
  // yan cümle kuralında olgu sanılıyordu).
  "hope wish glad happy pleasant great lovely wonderful forward know question further anything else help " +
  "wunsch schon angenehm fragen melden souhait sejour agreable dese estancia agradable disfrut pregunta " +
  "augur soggiorno piacevole domand желаем приятн отдых вопрос обращайтесь надеемся eine einen einem einer eines sich " +
  // "da / de / ayrıca" zarfları olgu değildir (R7 yan cümle sayımı: "Eine Sauna gibt es ebenfalls" doğru cevaptır).
  "ebenfalls auch aussi egalement tambien igualmente anche также тоже too either"
).split(" ");
/**
 * Yalnız TAM sözcük dolgu ("Aufenthalt" = konaklama; "Aufenthaltsraum" = salon, olgu). Günün saati ve süreklilik ("akşam", "gece", "her zaman",
 * "jederzeit") dolgu DEĞİLDİR — "Havuz 20:00'de kapanır; gece de kullanabilirsiniz" olgu ekler (Opus dilim sonu 10-23 R10).
 */
const FILLER_EXACT = new Set(
  // Genel kullanım / sunum fiilleri ("can't be USED", "is SERVED from 08:00") olgu değildir — Türkçe karşılıkları ("kullan-", "servis edil-") da sayılmaz.
  "aufenthalt used using usable served serves serving serviert servido servito offered provided benutzt genutzt utilise utilisee usado usada usato".split(" "),
);
function isFiller(t: string, prev: string): boolean {
  if (FILLER_EXACT.has(t)) return true;
  if (t === "free" && prev === "feel") return true;
  if (t === "feel") return true;
  return FILLER_ROOTS.some((r) => t === r || (r.length >= 4 && t.startsWith(r)));
}

/** Aynı kök mü: çekim biçimleri kesişir ya da ortak baş ≥ 4 harf (kısa sözcükte tamamı) — "-lı / -sız" ayrımı korunur (ücretli ≠ ücretsiz). */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  // Bileşik "checkin" ↔ "checkout" ortak başla aynı sayılıyordu (Haiku 10-23 gece-2: çıkış sorusuna "Check-in is at 11:00").
  if (/^check(?:in|out)/.test(a) && /^check(?:in|out)/.test(b) && a.slice(5, 7) !== b.slice(5, 7)) return false;
  const fa = baseForms(a);
  for (const f of baseForms(b)) if (fa.has(f)) return true;
  let cp = 0;
  while (cp < a.length && cp < b.length && a[cp] === b[cp]) cp++;
  // Türkçe kökler kısa ("gir-", "kira-"): ortak baş 4 harf yeter; olumluluk ayrımı zaten olumsuzluk kontrolündedir.
  if (cp < Math.min(4, Math.min(a.length, b.length))) return false;
  const privative = (x: string) => /^s[iu]z/.test(x);
  return privative(a.slice(cp)) === privative(b.slice(cp));
}

/**
 * Türkçeye özgü harf taşımayan kısa Türkçe metin ("Havlu verilir.", "Havlu kiralanır.", "Köpekler kabul edilir."): Türkçe çekim / yüklem
 * sonu taşıyan sözcük var, yaygın Batı dili işlev sözcüğü yok (Haiku 10-23 gece-2: aynı dil kıyası atlanıp "Kendi havlunuzu getirmeniz
 * gerekir" geçiyordu). Yalnız içerik kıyasının dil kararında kullanılır.
 */
const TR_SUFFIX = /(?:iyor(?:um|uz|sunuz|lar)?|ilir|ilmez|ebilir|abilir|anir|enir|inir|unur|ulur|niz|nuz|dir|tir|dur|tur|mez|maz|mektedir|maktadir|meli|mali)$/;
const WEST_FUNCTION = new Set(
  "the is are and of to you your for with this that der die das ist und sie mit le la les est et vous pour el los es y para con il che sono".split(" "),
);
function turkishLike(text: string): boolean {
  const t = tokenize(text);
  return t.some((w) => w.length >= 5 && TR_SUFFIX.test(w)) && !t.some((w) => WEST_FUNCTION.has(w));
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
 * Alıntının düştüğü kalem cümle(ler)i — kıyasın dayanağı. Kısa alıntı ("20:00", "Havuz", kategori adı) dili kestirilemediği için kıyası
 * atlatıyordu (Opus güvenlik 10-23 F2: "Havuz 20:00'de kapanır; havlu ve terlik verilir, erken girişte de…" alıntı "20:00" ile geçti).
 * Alıntı tek bir cümlede bulunamazsa alıntının kendisi.
 */
function quoteSentences(sourceText: string | undefined, evidence: string): string {
  if (!sourceText) return evidence;
  // Harf / rakam sayısı alıntınınkinden az olan cümle alıntıyı içeremez → normalleştirme yalnız aday cümlede (uzun alıntıda her cümle için
  // alıntıyı yeniden normalleştirmek karesel oluyordu — maliyet testi).
  const letters = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "").length;
  const need = letters(evidence);
  const hits = sourceText
    .split(/(?<=[.!?;])\s+|\n+/u)
    .filter((s) => s.trim() && letters(s) >= need && quoteGroundedIn(s, evidence));
  return hits.length > 0 ? hits.join(" ") : evidence;
}

/**
 * Çok dilli tesis adları → kimlik (sözlük konusu olmayanlar dahil: "sauna"). Kök başlangıcı (en az 4 harf) ya da kısa adda tam belirteç.
 * Yalnız birbirine karışıp yanlış saat / ücret alabilecek tesisler.
 */
const FACILITY_ROOTS: Readonly<Record<string, readonly string[]>> = {
  pool: ["havuz", "pool", "piscin", "schwimmbad", "бассейн"],
  sauna: ["sauna", "сауна", "саун"],
  hamam: ["hamam", "hammam", "хамам"],
  jacuzzi: ["jakuzi", "jacuzzi", "whirlpool", "джакузи"],
  spa: ["spa"],
  gym: ["gym", "fitness", "spor", "тренаж", "фитнес", "gimnasio", "palestra"],
  steam: ["buhar", "steam", "dampfbad", "парилк"],
  // Saati karışabilen öteki yerler (Opus dilim sonu 10-23 R13 / R7 eki: "The pool and the bar close at 20:00" — "bar" 3 harf, içerik sayılmıyordu).
  bar: ["bar", "бар"],
  restaurant: ["restoran", "restaurant", "ristorante", "ресторан"],
  reception: ["resepsiyon", "reception", "rezeption", "recepcion", "ресепшн", "ресепшен", "регистрац"],
};
function facilitiesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    for (const [id, roots] of Object.entries(FACILITY_ROOTS)) {
      if (roots.some((r) => t === r || (r.length >= 4 && t.startsWith(r)))) out.add(id);
    }
  }
  return out;
}

/** Diller arası niteleyici sınıfları (rakip değer kuralı — "Geç çıkış 13:00" ↔ "Late check-out until 13:00"). Kök başlangıcı (en az 4 harf) ya da tam. */
const QUALIFIER_ROOTS: Readonly<Record<string, readonly string[]>> = {
  late: ["gec", "late", "spat", "spaet", "tard", "tardi", "поздн"],
  early: ["erken", "early", "fruh", "frueh", "tot", "temprano", "presto", "ранн"],
  child: ["cocuk", "child", "children", "kid", "kids", "kinder", "enfant", "nino", "nina", "bambin", "дет"],
  adult: ["yetiskin", "adult", "erwachsen", "adulte", "adulto", "взросл"],
  outdoor: ["acik", "outdoor", "outside", "aussen", "exterieur", "exterior", "aperto", "открыт"],
  indoor: ["kapali", "indoor", "inside", "innen", "hallenbad", "interieur", "interior", "coperto", "крыт"],
};
/** Metindeki niteleyici sınıfları; sınır öbeği ("en erken", "at the latest", "plus tard") niteleyici değildir. */
function qualifiersIn(text: string): Set<string> {
  const t = tokenize(text);
  const out = new Set<string>();
  t.forEach((w, i) => {
    // "açık / kapalı" yüklem de olur ("Havuz 09:00-20:00 arası AÇIK") — yalnız rakip kuralının konu yeri okumasında niteleyici.
    if (/^(?:acik|kapali)/.test(w) || /^(?:latest|earliest|spatestens|fruhestens|tard|tot)$/.test(w) || LATER_WORDS.has(w) || EARLIER_WORDS.has(w) || /^(?:en|plus|mas|the|at)$/.test(t[i - 1] ?? "") || BOUND_NEGATORS.has(t[i - 1] ?? "")) return;
    const q = qualifierClass(w);
    if (q) out.add(q);
  });
  return out;
}
function qualifierClass(t: string): string | null {
  for (const [id, roots] of Object.entries(QUALIFIER_ROOTS)) if (roots.some((r) => t === r || (r.length >= 4 && t.startsWith(r)))) return id;
  return null;
}

/** Yan cümle bağlaçları (çok dilli) — yabancı dil parçasında yan cümle kuralı için. */
const CLAUSE_CONJUNCTION = /\s+(?:and|und|et|y|e|и|ve|but|aber|mais|pero|но|ama|also|plus|también|auch|aussi|тоже)\s+/iu;

/** Parçanın yan cümleleri (noktalama + çok dilli bağlaç; sıra sayısının noktası bölmez). */
function partClauses(part: string): string[] {
  return part
    .replace(/(?<![\d:.,])(\d{1,3})\.(?=\s+\p{L})/gu, "$1")
    .split(/[.!?;,]+(?!\d)/u)
    .flatMap((x) => x.split(CLAUSE_CONJUNCTION))
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Kıyasta içerik sayılan sözcük: en az 4 harf, rakamsız, nötr / koşul / olumsuzluk / dolgu / edilgen yardımcı fiil değil, ihtiyacın sözcüğü değil. */
function contentWord(toks: readonly string[], i: number, needTerms: readonly string[]): boolean {
  const t = toks[i];
  if (t.length < 4 || /\d/.test(t) || isNeutralWord(t) || isFiller(t, toks[i - 1] ?? "")) return false;
  // Edilgen yardımcı fiil ("ediliyor", "edilir") ve "servis edil-" (= "verilir") içerik değildir (E ölçümü v4: "servis ediliyor" ←
  // "verilir"); olumsuzu ("servis edilmez") olumsuzluk kontrolünde ayrıca tutulur.
  if (/^edil/.test(t) || (t === "servis" && /^edil/.test(toks[i + 1] ?? ""))) return false;
  // Süre yardımcıları ("11:00'e kadar devam ediyor / sürer" ← "verilir"; E ölçümü v5): olgu değil, olumsuzu olumluluk kontrolünde.
  if (/^(?:devam|surer|suruyor|surmekte)/.test(t)) return false;
  // Sınır öbeği sözcükleri ("no later THAN", "no earlier than", "nicht später als") olgu değildir — yön okumasında (R1).
  if (LATER_WORDS.has(t) || EARLIER_WORDS.has(t) || t === "than" || t === "als") return false;
  // Saat adı ve kip fiili ("Check-out TIME is 11:00", "You NEED to check out by 11:00") olgu değildir (R12: Türkçe "Check-out saati: 11:00"
  // satırı İngilizce sanılıp sözcük kıyasına giriyordu).
  if (GENERIC_REGION_WORDS.has(t) || MODAL_WORDS.has(t)) return false;
  return !(needTerms.length > 0 && needTermsInStrict(needTerms, t) > 0);
}

/**
 * Parçada alıntının (düştüğü cümlenin) taşımadığı içerik var mı.
 *  - Aynı dil: alıntıda kökü olmayan her içerik sözcüğü dayanaksızdır.
 *  - Başka dil (ya da dil kestirilemiyor): sözcük kıyası anlamsız → iki yapısal sınır (Opus güvenlik 10-23 F2: "Pets are welcome. Smoking is
 *    allowed inside and early check-in is always possible." / "… send a photo of your passport … on WhatsApp" geçiyordu): parçanın sözlük
 *    konuları alıntının, ihtiyacın ve ihtiyaç sözcüklerinin konularında olmalı; içerik sözcüğü sayısı alıntınınkini en çok 2 (uzun alıntıda
 *    yarısı kadar) aşabilir — çeviri aşağı yukarı aynı sayıda içerik sözcüğü taşır, eklenen olgu sayıyı büyütür.
 */
export function unsupportedContent(
  part: string,
  evidence: string,
  rawNeedTerms: readonly string[],
  opts: { sourceText?: string; needTopics?: readonly string[] } = {},
): boolean {
  const needTerms = rawNeedTerms.map(foldMarks);
  const ref = quoteSentences(opts.sourceText, evidence);
  const le = languageOf(ref) ?? languageOf(evidence) ?? (opts.sourceText ? languageOf(opts.sourceText) : null) ?? (turkishLike(ref) ? "tr" : null);
  // Dili kestirilemeyen kısa parça ("Otopark konaklama boyunca 200 TL.") kalemle aynı yazı sistemindeyse kalemin dilinde sayılır (Opus 10-23
  // Y5) — tutma yönünde: kısa İngilizce parça bu yolla içerik farkı verirse tutulur.
  const lp = languageOf(part) ?? (turkishLike(part) ? "tr" : null) ?? (le && scriptOf(part) === scriptOf(ref) ? le : null);
  const rt = tokenize(ref);
  const pt = tokenize(part);
  // Dil iki tarafta da kestirilemiyorsa ("Parking costs 200 TL." / "Otopark 3. katta.") yapısal sınırlar uygulanır (sözcük kıyası kısa
  // İngilizce parçayı Türkçe kaleme karşı haksız tutardı).
  if (lp && lp === le) return pt.some((t, i) => contentWord(pt, i, needTerms) && !rt.some((e) => sameStem(t, e)));
  const allowed = new Set([...topicsWithSymptomsOf(ref), ...(opts.needTopics ?? []), ...topicsWithSymptomsOf(needTerms.join(" "))]);
  if (topicsWithSymptomsOf(part).some((t) => !allowed.has(t))) return true;
  // Her yan cümle bir değer, ihtiyacın bir sözcüğü ya da izinli bir sözlük konusu taşımalı: "Yes, pets are allowed and there is a garden."
  // sayı sınırının altında kalan TEK eklenmiş olguyu da tutar (E ölçümü v4'ün 80+ yabancı dil parçasında yanlış ret 0).
  const contentCount = (c: string) => {
    const toks = tokenize(c);
    return toks.reduce((n, t, i) => n + (contentWord(toks, i, needTerms) && !PREDICATE_WORDS.has(t) ? 1 : 0), 0);
  };
  // Sıra sayısının noktası ("im 3. Stock", "3. katta") yan cümle bölmez; saatin ardındaki nokta ("20:00. Please …") böler.
  const clauses = partClauses(part);
  // İhtiyaç sözcüğünü / izinli konuyu anan yan cümle de olgu ekleyebilir ("Pets are allowed, and pets may stay alone in the apartment", "der
  // Pool ist beheizt" — Opus dilim sonu 10-23 R7): böyle yan cümlenin KENDİ olgu sözcükleri (ihtiyaç sözcüğü, izinli sözlük konusu, ücret
  // sözcüğü ve yüklem dışındakiler — ücret kutbu ayrıca kıyaslanır) alıntınınkini aşamaz.
  // Konu sözcüğü tek başına ya da komşusuyla izinli konuya düşer ("домашние животные", "بالحيوانات الأليفة"); izin / yasak yüklemi olumluluk
  // kontrolündedir ("не допускаются", "لا يسمح").
  const topical = (toks: readonly string[], i: number) =>
    [toks[i], `${toks[i - 1] ?? ""} ${toks[i]}`, `${toks[i]} ${toks[i + 1] ?? ""}`].some((x) => topicsWithSymptomsOf(x).some((y) => allowed.has(y)));
  const ownFacts = (toks: readonly string[]) =>
    toks.reduce(
      (n, t, i) =>
        n + (contentWord(toks, i, needTerms) && !PREDICATE_WORDS.has(t) && !feeWordAt(toks, i) && !grantWord(t) && !PROPERTY_WORD.test(t) && !topical(toks, i) ? 1 : 0),
      0,
    );
  // Alıntı tarafı sade sayılır (ihtiyaç sözcüğü ve yüklem dışı her içerik sözcüğü) — çeviri karşılığı bulunamayan alıntı sözcüğü cevaba pay bırakır.
  const refFacts = rt.reduce((n, t, i) => n + (contentWord(rt, i, needTerms) && !PREDICATE_WORDS.has(t) ? 1 : 0), 0);
  for (const c of clauses) {
    const toks = tokenize(c);
    if (contentCount(c) === 0) continue;
    // Değer taşıyan yan cümle de yeni konu / olgu ekleyemez ("Der Pool und der Aufenthaltsraum schließen um 20:00 Uhr" — R7 eki).
    if (claimSpans(c).claims.length > 0) {
      if (ownFacts(toks) > refFacts) return true;
      continue;
    }
    const anchored = (needTerms.length > 0 && toks.some((t) => t.length >= 3 && needTermsInStrict(needTerms, t) > 0)) || topicsWithSymptomsOf(c).some((t) => allowed.has(t));
    if (!anchored || ownFacts(toks) > refFacts) return true;
  }
  // Sayımda ihtiyaç sözcükleri İKİ tarafta da sayılır (çeviride "evcil hayvan" → "Haustiere" ihtiyaç sözcüğü olmaktan çıkar); yüklem / bağ
  // fiili ("sind", "are allowed") Türkçede ek olduğundan sayılmaz.
  const count = (toks: readonly string[]) => toks.reduce((n, t, i) => n + (contentWord(toks, i, []) && !PREDICATE_WORDS.has(t) ? 1 : 0), 0);
  const refCount = count(rt);
  return count(pt) > Math.max(refCount + 2, Math.ceil(refCount * 1.5));
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
    "iki uc dort bes alti yedi sekiz dokuz yirmi otuz kirk elli bucuk sekizde dokuzda yedide onda " +
    // Portekizce / İtalyanca / Felemenkçe (Opus güvenlik 10-23 F1: "às dez da noite" havuz 20:00'ye gidiyordu).
    "dois duas quatro sete oito nove dez vinte trinta meia " +
    "due quattro cinque sette otto dieci undici dodici venti trenta mezzogiorno mezzanotte " +
    "twee drie vijf zes zeven negen tien twaalf twintig dertig middernacht"
  ).split(" "),
);
const hasNumberWord = (tokens: readonly string[]) => tokens.some((t) => NUMBER_WORDS.has(t));

const FEE_FREE = new Set("ucretsiz ucretsizdir bedava bedavadir free gratis kostenlos gratuit gratuite gratuito complimentary бесплатно бесплатный бесплатная бесплатное".split(" "));
const FEE_PAID = new Set(
  // "pay / zahlen / payer / pagar" — "You must pay for the pool" ücretsiz kalemle geçiyordu (Haiku 10-23 gece-2).
  "ucretli ucretlidir paid charge charged chargeable fee fees kostenpflichtig gebuhr gebuehr payant payante платно платный платная платное pay payable zahlen bezahlen payer pagar pagare платить оплатить".split(" "),
);
/** Ücret kutbu: "ücretsiz" / "ücretli" (olumsuzlanmış "ücretsiz değil" / "not free" ücretlidir). Diller arası da okunur (Opus 10-23 Y4). */
function feeClasses(tokens: readonly string[]): Set<"free" | "paid"> {
  const out = new Set<"free" | "paid">();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (FEE_FREE.has(t)) {
      const negated = /^degil/.test(tokens[i + 1] ?? "") || NEGATING_PARTICLES.has(tokens[i - 1] ?? "") || (tokens[i - 1] ?? "") === "не";
      out.add(negated ? "paid" : "free");
    } else if (FEE_PAID.has(t)) {
      // "free of charge" / "no (extra) charge" / "without charge" ücretsizdir (Haiku 10-23 gece #10).
      const p1 = tokens[i - 1] ?? "";
      const p2 = tokens[i - 2] ?? "";
      if ((p1 === "of" && p2 === "free") || ["no", "without"].includes(p1) || (["extra", "additional"].includes(p1) && ["no", "without"].includes(p2))) {
        if (!(p1 === "of" && p2 === "free")) out.add("free");
        continue;
      }
      out.add("paid");
    }
  }
  return out;
}

/** Dairenin kendisini anan sözcük ("in the apartment", "in der Wohnung", "dairede") olgu değildir — yer kalemin varsayılanı. */
const PROPERTY_WORD = /^(?:apartments?|flats?|wohnung|appartement|apartamento|appartamento|квартир|house|home|property|units?|daire|dairede|dairemiz|evde|inside|indoors?)/;

/** Ücret sözcüğü ("free", "charge", "extra charge", "ücretsiz", "Gebühr") — kutbu `feeClasses` kıyaslar, olgu sayımına girmez. */
function feeWordAt(tokens: readonly string[], i: number): boolean {
  const t = tokens[i];
  return FEE_FREE.has(t) || FEE_PAID.has(t) || FEE_NOUN.test(t) || (/^(?:extra|additional|zusatzlich|supplementaire|adicional)/.test(t) && FEE_NOUN.test(tokens[i + 1] ?? ""));
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

export function checkAnswerBinding(raw: BindingInput): BindingResult {
  // İhtiyaç sözcükleri de aynı aksan katlamasından (iki taraf simetrik — R1).
  const input: BindingInput = { ...raw, needTerms: raw.needTerms.map(foldMarks) };
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
  const ev = cachedDocument(input.sourceText, subj);
  const pdoc = documentOf(input.part, subj);
  // Okunamayan rakam yazısı (eşlem tablosunda olmayan ondalık rakam): değer doğrulanamaz → tutulur (Opus güvenlik 10-23 F1).
  if (/\p{Nd}/u.test(foldForClaims(input.part).replace(/[0-9]/g, ""))) issues.add("value_not_in_evidence");
  const partTokens = tokenize(input.part);
  const partConditions = conditionClasses(partTokens, "part");
  const partNegative = negative(partTokens);
  const partDirections = directions(partTokens);
  const partBounds = boundsOf(partTokens);
  const partFee = feeClasses(partTokens);
  const partBasis = basisClasses(partTokens);
  const partException = partTokens.some((t) => EXCEPTION_TOKENS.has(t));
  // Konuyu hiç anmayan öteki kalem değer, değişke ya da koşul veremez → belge kurulmaz (Opus güvenlik 10-23 F4: her ihtiyaç için istemdeki
  // BÜTÜN kalemler yeniden ayrıştırılıyordu; 8 × 3.000 karakterde 10 ihtiyaç 5 sn olay döngüsü).
  const otherDocs = (input.otherSources ?? []).filter((t) => t !== input.sourceText && mentionsSubject(t, subj)).map((t) => cachedDocument(t, subj));
  // Çok konululuk değeri VEREN kalemle birlikte okunur (Opus güvenlik 10-23 F6-UPGRADE: alıntı "Havuz kullanımı serbesttir." + öteki kalem
  // "Havuz 20:00'de, sauna 22:00'de kapanır." → "Sauna 20:00'de kapanır" geçiyordu; konu kimlikleri yalnız alıntının kaleminden okunuyordu).
  const multiCache = new Map<Doc, boolean>();
  const multiAt = (d: Doc): boolean => {
    if (d === ev) return multiSubject;
    let m = multiCache.get(d);
    if (m === undefined) {
      const ids = new Set(presentIds);
      for (const t of subj.terms) if (hasSubject(d.text, { terms: [t], topics: [] })) ids.add(subjectIdentity(t));
      multiCache.set(d, (m = ids.size > 1));
    }
    return m;
  };
  // Uydurma koşul kıyası: alıntının kalemi + öteki kalemlerin YALNIZ konuya bağlı yerleri (değişke başka kalemde olabilir — O6; ilgisiz
  // kalemin koşulu sayılmaz). Ücret tabanı yalnız alıntının kaleminden.
  const sourceTokens = tokenize([input.sourceText, evidence].join("\n"));
  const sourceConditions = conditionClasses(sourceTokens, "evidence");
  for (const d of otherDocs) for (const c of d.subjectConditions()) sourceConditions.add(c);
  const sourceBasis = basisClasses(sourceTokens);
  // Misafirin sorduğu gün ("cumartesi kaçta kapanıyor") — genel kuralın o güne özel söylenişi uydurma koşul değildir.
  const asked = conditionClasses([...input.needTerms], "evidence");

  /** Parçanın değerleri: kendi gün / mevsim koşulu (değerden sonraki değersiz yan cümle sayılmaz) + kendi yönü + konu yeri. */
  const partClaims: { c: Span; days: Set<string>; dirs: Set<"start" | "end">; bounds: Set<"min" | "max">; negative: boolean; groupSize: number; region: string; clause: string; ids: () => Set<string> }[] = [];
  pdoc.sentences.forEach((sent, si) =>
    sent.groups.forEach((g, gi) => {
      const place = pdoc.placeOf(sent, gi, { extraBeforeOnly: true });
      const region = pdoc.boundRegion(si, gi) ?? input.part;
      const [ca, cb] = sent.clauses[sent.groupClause[gi]];
      const clause = pdoc.text.slice(ca, cb);
      // Değer yerinin konu kimlikleri belgeden (parça başına bir kez okunan parçalar — R8); bağsız değer bütün parçayı okur.
      const ids = () => (pdoc.boundAt(si, gi) ? pdoc.regionIdentities(si, gi) : subjectIdentitiesIn(input.part, subj, identities));
      for (const c of g.claims) {
        partClaims.push({ c, days: new Set(variantClassesOf(place.conditions)), dirs: place.directions, bounds: place.bounds, negative: place.negative, groupSize: g.claims.length, region, clause, ids });
      }
    }),
  );
  const singlePartGroup = pdoc.sentences.reduce((n, sent) => n + sent.groups.length, 0) === 1;
  const partIdentitiesAll = subjectIdentitiesIn(input.part, subj, identities);

  /** Parça konusu ↔ kalem konusu (aynı kimlik). Parça konusuz ve ihtiyaç tek konuluysa serbest. */
  const subjectAgrees = (d: Doc, si: number, gi: number, partIds: Set<string>): boolean => {
    // Tek konulu ihtiyaçta bağ zaten kalem tarafında kuruldu; parça tarafı kıyas yalnız çok konulu ihtiyaçta (çeviri kıyası gerekmez).
    if (!multiAt(d)) return true;
    if (partIds.size === 0) return false;
    const evIds = evRegionIds(d, si, gi);
    // Parçanın değer yeri İKİ tesisi anıyorsa ("Havuz ve sauna 20:00'de kapanır") kalem yeri ikisini de taşımalı (Haiku 10-23 gece #1).
    return evIds.size === 0 || [...partIds].every((x) => evIds.has(x));
  };

  /** İstisna / karşıtlık: cümlede varsa parça da taşımalı (ya da istisnanın gün / mevsim koşulunu anmalı). */
  const sentenceChecks = (info: { exception: boolean; conds: readonly string[] }, local: Set<BindingIssue>) => {
    if (!partException && info.exception) {
      const conds = info.conds;
      if (!(conds.length > 0 && conds.every((cls) => partConditions.has(cls) || coversDay(partConditions, cls)))) local.add("condition_dropped");
    }
  };
  // Çok konulu ihtiyaçta kalem yerinin konu kimlikleri — belgede yer başına bir kez.
  const evRegionIds = (d: Doc, si: number, gi: number): Set<string> => d.regionIdentities(si, gi);
  type Hit = { d: Doc; si: number; sent: Sentence; gi: number; idx: number };
  /** Konu yerinin niteleyici sözcükleri: ihtiyacın kendi sözcükleri, nötr / dolgu / nitelik / yön sözcükleri ve kalem satırının kategori öneki hariç. */
  const regionWordCache = new Map<Doc, string[][][]>();
  const regionWords = (d: Doc, si: number, gi: number): string[] => {
    let rows = regionWordCache.get(d);
    if (!rows) regionWordCache.set(d, (rows = []));
    const row = (rows[si] ??= []);
    if (row[gi]) return row[gi];
    const toks = tokenize((d.boundRegion(si, gi) ?? "").replace(KB_LINE_PREFIX, ""));
    // Nitelik sözcüğü niteleyicidir ("Havuz TEMİZLİĞİ 14:00" kapanış saatine rakip değildir — Haiku 10-23 gece #7); yalnız ücret / saat adı
    // ve "açık / kapalı" dışındaki nötr sözcükler düşer ("AÇIK havuz" ≠ "havuz").
    return (row[gi] = toks.filter(
      (t, i) =>
        !/\d/.test(t) &&
        (!isNeutralWord(t) || t === "acik" || t === "kapali") &&
        !isFiller(t, toks[i - 1] ?? "") &&
        !GENERIC_REGION_WORDS.has(t) &&
        !FEE_WORD.test(t) &&
        !START_TOKENS.has(t) &&
        !END_TOKENS.has(t) &&
        !(input.needTerms.length > 0 && needTermsInStrict(input.needTerms, t) > 0),
    ));
  };
  const partValues = partClaims.map((x) => x.c);
  /**
   * Aynı konunun RAKİP değeri (Opus güvenlik 10-23 F6): parça değerinin dayandığı yer dışında konuya bağlı, aynı türden, FARKLI, aynı koşul /
   * olumluluk / (ikisi de yönlüyse) aynı yönde bir değer daha varsa kalem(ler) çelişiyor demektir → tutulur:
   *  - değer alıntının kaleminde DEĞİL, öteki kalemden geliyor ve alıntının kalemi konuya başka değer veriyorsa ("Havuz 20:00'de kapanır."
   *    alıntısıyla "A Blok havuzu 22:00" kaleminden "Havuz 22:00'de kapanır"): alıntı parçayı çürütüyor;
   *  - iki yerin konu yeri birbirinden fazla niteleyici taşımıyorsa (eski başlık "Havuz 23:00" ↔ içerik "Havuz 20:00"): hangisinin doğru
   *    olduğu bilinmez. Niteleyicili rakip ("Çıkış 11:00" ↔ "Geç çıkış 13:00") ayrı bir şeydir, çelişki değil.
   * Aynı cümlede aynı konu yerinden dizilen değerler ("08:00, 09:00 ve 10:00") liste sayılır; parçanın kendisi de verdiği değer taraf tutmaz.
   */
  // Niteleyici parça DEĞERİNİN kendi yerinde aranır (Opus dilim sonu 10-23 R5: "Çıkış 13:00'e kadar, geç çıkış da mümkündür" niteleyiciyi başka
  // yan cümlede anıp genel çıkışı 13:00 diye veriyordu); diller arası küçük niteleyici sözlüğü ("çocuk" ~ "children", "geç" ~ "late").
  const carriesQualifier = (w: string, region: string) => {
    const rt = tokenize(region);
    const q = qualifierClass(w);
    return rt.some((t) => sameStem(w, t) || (q !== null && qualifierClass(t) === q)) || topicsWithSymptomsOf(w).some((x) => topicsWithSymptomsOf(region).includes(x));
  };
  const rivalIssue = (c: Span, h: Hit, place: PlaceReading, partIds: Set<string>, partRegion: string): BindingIssue | null => {
    if (variantClassesOf(place.conditions).length > 0) return null;
    let dropped = false;
    const g = h.sent.groups[h.gi];
    const role = g.claims.length >= 2 ? (h.idx === 0 ? "start" : h.idx === g.claims.length - 1 ? "end" : null) : null;
    const dirs = role ? new Set<"start" | "end">([role]) : place.directions;
    const basis = c.cls === "money" ? h.d.sentenceInfo(h.sent).basis : null;
    for (const d of [ev, ...otherDocs]) {
      const sites = d.boundSitesFor(c.cls);
      // Tavanı aşan kalemde rakip aranamaz → çelişki sayılır (güvenli yön; yüzlerce değerli tarife tutulur).
      if (sites.length > MAX_RIVAL_SITES) return "value_conflict";
      for (const s of sites) {
        if (d === h.d && s.si === h.si && (s.gi === h.gi || d.sentences[s.si].regionFrom[s.gi] === h.sent.regionFrom[h.gi])) continue;
        if (valuesOverlap(c, s.claim) || partValues.some((v) => valuesOverlap(v, s.claim))) continue;
        const sent = d.sentences[s.si];
        const p = d.placeOf(sent, s.gi);
        if (!sameSet(p.conditions, place.conditions) || p.negative !== place.negative) continue;
        if (p.directions.size > 0 && dirs.size > 0 && !sameSet(p.directions, dirs)) continue;
        if (basis && !sameSet(d.sentenceInfo(sent).basis, basis)) continue;
        if (multiAt(d) && partIds.size > 0) {
          const ids = evRegionIds(d, s.si, s.gi);
          if (ids.size > 0 && ![...partIds].some((x) => ids.has(x))) continue;
        }
        if (d === ev && h.d !== ev) return "value_conflict";
        const mine = regionWords(h.d, h.si, h.gi);
        const theirs = regionWords(d, s.si, s.gi);
        const mineExtra = mine.filter((w) => !theirs.some((x) => sameStem(w, x)));
        const theirsExtra = theirs.filter((w) => !mine.some((x) => sameStem(w, x)));
        if (mineExtra.length === 0 && theirsExtra.length === 0) return "value_conflict";
        // Parçanın dayandığı yer niteleyicili, rakip genel değer: parça niteleyiciyi anmalı (Haiku 10-23 gece #2: "Çıkış saati 11:00. Geç
        // çıkış 13:00'e kadar" kaleminden "Çıkış saati 13:00'e kadar" geçiyordu).
        if (mineExtra.length > 0 && theirsExtra.length === 0 && !mineExtra.every((w) => carriesQualifier(w, partRegion))) dropped = true;
      }
    }
    return dropped ? "condition_dropped" : null;
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

  let anchored = false;
  const hitDocs = new Set<Doc>();
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
      if (bound.some((h) => h.d === ev)) anchored = true;
      // Değer kalemde birden çok yerde konuya bağlıysa: bütün kontrollerden geçen BİR yer yeter (o yer bu iddiayı tek başına taşır).
      let best: { local: Set<BindingIssue>; placeGeneral: boolean; h: Hit; place: PlaceReading } | null = null;
      let partIds: Set<string> | undefined;
      let omittedHere: boolean | undefined;
      for (const h of bound.slice(0, MAX_SITES_PER_VALUE)) {
        const local = new Set<BindingIssue>();
        const place = h.d.placeOf(h.sent, h.gi);
        if (multiAt(h.d)) {
          if (!partIds) {
            partIds = pc.ids();
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
        } else if (place.directions.size === 1 && pc.dirs.size === 2 && pc.groupSize < 2) {
          // Tek değere iki yön ("The pool closes AFTER 20:00", "open FROM 20:00 UNTIL closing") — kalemin tek yönüyle çelişir (Haiku 10-23 gece-2).
          local.add("direction_mismatch");
        } else if (place.directions.size === 1 && pDirs.size === 0) {
          // Kalem tek yön veriyor, parçanın değeri yön taşımıyor (Opus dilim sonu 10-23 R1: sözlükte olmayan fiil — "cierra", "закрывается" —
          // yön kıyasını sessizce atlatıyordu; "açılır" → "kapanır" geçiyordu). Okunamayan yön GEÇMEZ: parçada hiç yön sözcüğü yoksa yalnız
          // değerin doğal yönü ("Giriş 15:00'ten itibaren" → "Check-in is at 15:00") serbest; parçanın tek yönü başka değerdeyse o yön sayılır.
          const placeDir = [...place.directions][0];
          if (partDirections.size === 0 ? !naturalDirection(c, place.directions, h.d.boundRegion(h.si, h.gi) ?? "") : partDirections.size === 1 && !partDirections.has(placeDir)) {
            local.add("direction_mismatch");
          }
        } else if (place.directions.size === 0 && pDirs.size > 0 && !naturalDirection(c, pDirs, h.d.boundRegion(h.si, h.gi) ?? "")) {
          // Kalem yön vermiyorsa parça yön UYDURAMAZ (Opus güvenlik 10-23 F8: "Havuz 20:00" → "20:00'ye kadar açık" / "20:00'de açılır");
          // yalnız değerin doğal yönü serbest: giriş saati "-den itibaren", çıkış saati "en geç / -e kadar", kişi sayısı "-e kadar".
          local.add("direction_mismatch");
        }
        // Alt / üst sınır DEĞER BAŞINA (R3): ters sınır tutulur; kalemin alt sınırını düşüren parça da ("Minimum 3 gece" → "3 gece") — üst sınır
        // doğal okumadır ("4 kişiye kadar" → "4 kişilik").
        if (c.cls !== "time" && c.cls !== "date") {
          const eb = effectiveBounds(place.bounds, place.directions, c.cls);
          const pbx = pc.bounds.size > 0 ? pc.bounds : singlePartGroup ? partBounds : new Set<"min" | "max">();
          const pb = effectiveBounds(pbx, pDirs, c.cls);
          if (eb.size === 1 && pb.size > 0 && !pb.has([...eb][0])) local.add("direction_mismatch");
          // Alt sınır ve AÇIK üst sınır ("en fazla 14 gece") düşürülemez; "-e kadar" türevi üst sınır doğal okumadır ("3 saate kadar ücretsiz" ↔
          // "3 saat ücretsiz"), kişi sayısı da ("4 kişilik"). Kalemde sınır yokken parça AÇIK sınır ekleyemez ("3 gece" → "Minimum 3 nights").
          else if (eb.size === 1 && pb.size === 0 && (eb.has("min") || (place.bounds.has("max") && c.cls !== "people"))) local.add("condition_dropped");
          else if (eb.size === 0 && pbx.size > 0 && c.cls !== "people") local.add("condition_added");
        }
        // Parça değerin yan cümlesine kalemin o yerinde olmayan niteleyici ekleyemez ("The pool opens at 09:00 FOR CHILDREN" ← genel 09:00, çocuk
        // havuzu 10:00 — Haiku 10-23 gece-2).
        {
          const siteQ = qualifiersIn(`${h.d.boundRegion(h.si, h.gi) ?? ""} ${h.d.text.slice(...h.sent.clauses[h.sent.groupClause[h.gi]])}`);
          if ([...qualifiersIn(pc.clause)].some((q) => !siteQ.has(q))) local.add("condition_added");
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
        if (!best || local.size < best.local.size) best = { local, placeGeneral, h, place };
        if (local.size === 0) break;
      }
      if (best) {
        for (const i of best.local) issues.add(i);
        if (best.local.size === 0) {
          const rival = rivalIssue(c, best.h, best.place, partIds ?? partIdentitiesAll, pc.region);
          if (rival) issues.add(rival);
        }
        hitDocs.add(best.h.d);
        const valueOnlyDays = new Set(dayClassesOf(valueDays));
        if (valueOnlyDays.size > 0) dayValues.push({ days: valueOnlyDays, placeGeneral: best.placeGeneral });
      }
    }
    // Çapa (Opus güvenlik 10-23 F6): öteki kalem yalnız İKİNCİ değeri (değişke, ek bilgi) verebilir — parçanın en az bir değeri alıntının
    // kendi kaleminde konuya bağlı olmalı. Değerin tamamı başka kalemden geliyorsa alıntı süstür ("misafirlerimiz havuzu kullanabilir"
    // alıntısıyla "Daire 3 için: Havuz 22:00'de kapanır" kaleminden "The pool closes at 22:00").
    if (subjectKnown && !anchored && !issues.has("value_not_in_evidence") && !issues.has("value_bound_elsewhere") && !issues.has("subject_missing")) {
      issues.add("value_not_in_evidence");
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
      // Kalem cümlesi KARIŞIK olumluysa ("Dairede sigara içmek yasaktır, balkonda içilebilir.") parça da iki yönü taşımalı — tek yönü veren
      // ("Balkonda sigara içmek yasaktır") istisnayı düşürür ya da çevirir (Haiku 10-23 gece-2). Konusuz yan cümle yalnız yer bildiriyorsa
      // (bulunma eki, başka tesis yok) sayılır.
      const mixedKb = [...sentencesRead].some((st) => {
        const pols = new Set<boolean>();
        for (const [a, b] of st.clauses) {
          const cl = ev.text.slice(a, b);
          const t = tokenize(cl);
          if (!(hasPredicate(t) || negative(t))) continue;
          if (!(ev.subjectIn(cl) || (facilitiesIn(cl).size === 0 && t.some((w) => w.length >= 5 && /n?[dt][ae]$/.test(w))))) continue;
          pols.add(negative(t));
        }
        return pols.size === 2;
      });
      if (mixedKb) {
        const partPols = new Set(
          partClauses(input.part)
            .map((cl) => tokenize(cl))
            .filter((t) => t.some(grantWord) || t.some((_, i) => negAt(t, i)) || hasPredicate(t) || t.some((w) => needTermsInStrict(subj.terms, w) > 0))
            .map((t) => negative(t)),
        );
        if (partPols.size < 2) issues.add("condition_dropped");
      } else if (r.negative !== partNegative) issues.add("polarity_mismatch");
      // Olumluluk YAN CÜMLE başına da (Opus dilim sonu 10-23 R13): "Smoking is not allowed inside, BUT IT IS ALLOWED on the balcony" bütünüyle
      // olumsuz okunup "Dairede sigara içmek yasaktır" kalemine uyuyordu. Konuyu anan ya da izin / yasak yüklemi taşıyan her yan cümle kalemin
      // olumluluğunda olmalı.
      else if (!mixedKb && partClauses(input.part).some((cl) => {
        const t = tokenize(cl);
        return (hasSubject(cl, subj) || t.some(grantWord) || t.some((_, i) => negAt(t, i))) && negative(t) !== r.negative;
      })) issues.add("polarity_mismatch");
      // Değersiz parça konu cümlesindeki KISITI düşüremez (Opus güvenlik 10-23 F1b; kurucu A "koşul düşerse GİTMEZ"): "10 kg'a kadar evcil
      // hayvan kabul edilir" → "Evcil hayvan kabul edilir", "…, gecelik 300 TL" ücreti, "Küçük evcil hayvanlar…" niteliği. Kısıt = konu
      // cümlesinde (çok konulu ihtiyaçta başka tesisin yan cümlesi hariç) saat / tutar / sayı / süre / kişi değeri ya da üst sınır / küçüklük
      // sözcüğü; kimlik bildiren değer (kod, telefon, kat, "12 numaralı yer") kısıt değildir.
      const restrict = restrictionClasses(tokenize(places.join(" . ")));
      const partRestrict = restrictionClasses(partTokens);
      if ([...restrict].some((x) => !partRestrict.has(x))) issues.add("condition_dropped");
      // Ücret sorusunda ("otopark ücretli mi") ve VARLIK cevabında ("Evet, havuz var." ← "Havuz 09:00-20:00 arası açıktır.") yalnız tutar
      // düşmüş sayılır — saat / sayı başka bir sorunun cevabıdır; izin cevabında ("kabul edilir", "allowed") her kısıt sayılır.
      // Varlık muafiyeti yalnız SAF varlık cevabında: izin / açıklık / süreklilik bildiren parça ("we have a pet-friendly apartment and pets
      // are WELCOME", "there is a pool, OPEN all day", "kabulümüz var") her kısıtı taşımalı (Opus dilim sonu 10-23 R6).
      // Ücret sorusunda ücretsizliğin KENDİ sınırı (süre / adet / kişi / yaş: "ilk 2 saat ücretsiz", "0-6 yaş arası ücretsiz") düşemez; yalnız
      // saat / tarih başka sorunun cevabıdır (Opus dilim sonu 10-23 R9). Saf varlık cevabında yalnız tutar.
      const feeNeed = input.needTerms.some((t) => FEE_ASPECT.test(t));
      const pureExistence = existenceAnswer(partTokens) && !grantsOrQualifies(partTokens);
      // Saat / tarih ücret sözcüğüyle AYNI yan cümledeyse ücretsizliğin sınırıdır ("Otopark 22:00'ye kadar ücretsizdir", "3 saate kadar").
      const droppable = (x: Span, feeClause: boolean) =>
        restrictiveClaim(ev.text, x) &&
        (feeNeed ? (x.cls !== "time" && x.cls !== "date") || feeClause : pureExistence ? x.cls === "money" || x.cls === "percent" : true);
      const dropsValue = [...sentencesRead].some((st) =>
        st.groups.some((g, gi) => {
          const [ca, cb] = st.clauses[st.groupClause[gi]];
          const ct = feeNeed ? tokenize(ev.text.slice(ca, cb)) : [];
          const feeClause = ct.some((_, i) => feeWordAt(ct, i));
          if (!g.claims.some((x) => droppable(x, feeClause))) return false;
          if (!multiSubject || partIdentitiesAll.size === 0) return true;
          // Çok konulu ihtiyaçta başka tesisin yan cümlesindeki değer ("Havuz ücretsiz, sauna 200 TL." → "Havuz ücretsizdir") düşmüş sayılmaz.
          const [a, b] = st.clauses[st.groupClause[gi]];
          const ids = subjectIdentitiesIn(ev.text.slice(a, b), subj, identities);
          return ids.size === 0 || [...ids].some((x) => partIdentitiesAll.has(x));
        }),
      );
      if (dropsValue) issues.add("condition_dropped");
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
  // Tesis adı (havuz / sauna / hamam / jakuzi / spor salonu / buhar odası …) dayanağında olmadan anılamaz — ihtiyaç sorsa bile (Haiku 10-23
  // gece #1 / #3: "Havuz ve sauna 20:00'de kapanır", "The sauna closes at 20:00" yalnız havuz kalemiyle geçiyordu; "sauna" sözlükte yok).
  // İhtiyacın kalemde HİÇ geçmeyen konusu parçada anılamaz (Opus dilim sonu 10-23 R13: "havuz ve resepsiyon" ihtiyacına havuz kalemiyle "The pool
  // and the reception close at 20:00", "köpek ve kedi"ye "Köpek ve kedi kabul edilir" geçiyordu — tesis listesi yalnız 7 aileyi tanıyordu).
  //  - Kalemdeki konu sözlük konusuyla da karşılanır (kaba konu hariç: kedi ≠ köpek).
  //  - Yok sayılan sözcük kalemle AYNI sözlük ailesindeyse (kaba konu dahil: "pets" ↔ "evcil hayvan") çevirisi olabilir → yalnız ikisi de parçada
  //    harfiyen anılıyorsa tutulur ("Köpek ve kedi").
  //  - Başka ailedeyse parça kalemin konusunu da anıyorsa tutulur; anmıyorsa misafirin dilindeki çeviri olabilir ("pazar" kalemi, "market").
  //  - Ücret / izin / yüklem / nitelik / işlev sözcükleri ("free", "allowed", "und") konu değildir.
  if (subjectKnown) {
    const topicOf = (t: string) => {
      const id = subjectIdentity(t);
      return id.startsWith("topic:") && !COARSE_TOPICS.has(id.slice(6)) ? id.slice(6) : null;
    };
    const literal = (text: string, t: string) => hasSubject(text, { terms: [t], topics: [] });
    // Uzun kalem metninin sözlük konuları çağrı içinde bir kez.
    const topicsMemo = new Map<string, string[]>();
    const topicsIn = (text: string) => {
      let v = topicsMemo.get(text);
      if (!v) topicsMemo.set(text, (v = topicsWithSymptomsOf(text)));
      return v;
    };
    const mentions = (text: string, t: string) => {
      const topic = topicOf(t);
      return (topic !== null && topicsIn(text).includes(topic)) || literal(text, t);
    };
    // Önce parçada anılan aday sözcükler (kısa metin); kalem taraması yalnız aday varsa ve tembel (uzun kalemde her ihtiyaç için sözlük taraması
    // ölçüldü: süre testleri 2-3 kat yavaşlıyordu).
    const candidates = subj.terms.filter(
      (t) =>
        !(t.length < 3 || isNeutralWord(t) || isFiller(t, "") || FUNCTION_WORDS.has(t) || PREDICATE_WORDS.has(t) || grantWord(t) || isAttribute(t)) &&
        !(FEE_ASPECT.test(t) || FEE_FREE.has(t) || FEE_PAID.has(t) || UNIT_ROOTS.some((r) => t.startsWith(r))) &&
        mentions(input.part, t),
    );
    if (candidates.length > 0) {
      const itemTexts = [...new Set([input.sourceText, ...[...hitDocs].filter((d) => d !== ev).map((d) => d.text)])];
      const presentMemo = new Map<string, boolean>();
      const isPresent = (t: string) => {
        let v = presentMemo.get(t);
        if (v === undefined) presentMemo.set(t, (v = itemTexts.some((x) => mentions(x, t))));
        return v;
      };
      const absent = candidates.filter((t) => !isPresent(t));
      if (absent.length > 0) {
        const present = subj.terms.filter(isPresent);
        const itemTopics = new Set(itemTexts.flatMap((x) => topicsIn(x)));
        const partTopics = topicsIn(input.part);
        const partHasPresent = present.some((t) => mentions(input.part, t) || topicsWithSymptomsOf(t).some((x) => partTopics.includes(x)));
        const pt = tokenize(input.part);
        for (const t of absent) {
          // Aile parçadaki komşu sözcükle de okunur ("домашние" tek başına konu değil, "домашние животные" evcil hayvan).
          const around = pt.flatMap((w, i) => (needTermsInStrict([t], w) > 0 ? [w, `${pt[i - 1] ?? ""} ${w}`, `${w} ${pt[i + 1] ?? ""}`] : []));
          const sameFamily = [t, ...around].some((x) => topicsWithSymptomsOf(x).some((y) => itemTopics.has(y)));
          if (sameFamily ? literal(input.part, t) && present.some((p) => literal(input.part, p)) : partHasPresent) {
            issues.add("subject_missing");
            break;
          }
        }
      }
    }
  }
  const allowedFacilities = new Set([...facilitiesIn(input.sourceText), ...facilitiesIn(evidence), ...[...hitDocs].flatMap((d) => [...facilitiesIn(d.text)])]);
  if ([...facilitiesIn(input.part)].some((f) => !allowedFacilities.has(f))) issues.add("subject_mismatch");
  if (unsupportedContent(input.part, evidence, input.needTerms, { sourceText: input.sourceText, needTopics: input.needTopics })) issues.add("unsupported_content");
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

/** Değersiz parçanın düşüremeyeceği değer türleri (kimlik bildirenler — kod, telefon, adres, kat — hariç). */
const RESTRICTIVE_CLASSES: ReadonlySet<string> = new Set(["time", "date", "money", "percent", "distance", "duration", "people", "count"]);
/** Varlık cevabı: "var / mevcut / bulunur", "there is / are", "we have", "es gibt", "есть" (izin ya da açıklık bildirmez). */
function existenceAnswer(tokens: readonly string[]): boolean {
  return tokens.some(
    (t, i) =>
      /^(?:var|vardir|mevcut|mevcuttur|bulunur|bulunuyor|bulunmaktadir|gibt|есть)$/.test(t) ||
      (t === "there" && /^(?:is|are)$/.test(tokens[i + 1] ?? "")) ||
      (t === "we" && tokens[i + 1] === "have"),
  );
}
/** İzin / açıklık / süreklilik bildiren sözcükler (kök başlangıcı en az 4 harf ya da tam): varlık cevabını izin cevabına çevirir. */
const GRANT_ROOTS = (
  "kabul izin serbest mumkun yapilabil kullanilabil kullanabil getirebil girebil acik allow permit welcome accept possib erlaub gestatt " +
  "willkommen moglich autoris admis bienvenu aceptad bienvenid consent ammess accettat разреш допуска можно возможн принима open avail geoffnet " +
  "offen ouvert abierto aperto открыт доступ always anytime immer toujours siempre sempre всегда круглосуточ toegesta permess يسمح مسموح"
).split(" ");
const grantWord = (t: string) => GRANT_ROOTS.some((r) => t === r || (r.length >= 4 && t.startsWith(r)));
function grantsOrQualifies(tokens: readonly string[]): boolean {
  return tokens.some(
    (t, i) => GRANT_ROOTS.some((r) => t === r || (r.length >= 4 && t.startsWith(r))) || (t === "her" && tokens[i + 1] === "zaman") || (t === "all" && tokens[i + 1] === "day"),
  );
}
/** İhtiyacın ücret sözcükleri ("ücretli mi", "fiyatı", "is it free"). */
const FEE_ASPECT = /^(?:ucret|fiyat|price|cost|fee|free|paid|bedava|gebuhr|preis|kosten|prix|precio|gratis)/;
/**
 * Kısıt bildiren değer: saat / tarih / tutar / yüzde / mesafe / süre / kişi / adet. "7/24" sınır değil (her zaman açık); çıplak sayı yalnız
 * sınır bağlamında ("10 kg'a kadar", "en fazla 1") — "Daire 3", "12 numaralı yer" bir kimliktir.
 */
function restrictiveClaim(text: string, c: Span): boolean {
  if (c.keys.includes("x24x7")) return false;
  if (RESTRICTIVE_CLASSES.has(c.cls)) return true;
  if (c.cls !== "number") return false;
  const after = text.slice(c.end, c.end + 16);
  const before = text.slice(Math.max(0, c.at - 16), c.at);
  // Yaş / adet sınırı da kısıttır (R9: "0-6 yaş arası çocuklar", "children under 6", "1 araç için").
  return (
    /^\s*(?:kg|kilo|lb|pound|[’'`]?y?[ae]\s+kadar|kadar|ya[sş]|age|years?|jahre|ans|a[nñ]os|лет|ara[cç]|car|vehicle|auto|fahrzeug|voiture|saat|hours?|stunden?|heures?|horas?|час|gece|nights?|n[aä]chte?|g[uü]n|days?|tage?|dakika|min)/iu.test(after) ||
    /(?<!\p{L})(?:fazla|maks\w*|max\w*|azami|up to|at most|en az|minimum|under|over|below|above|unter|ab|moins de|plus de|menos de|до|младше|старше)\s*$/iu.test(before)
  );
}
/** Kısıt sözcükleri (yalnız değersiz parçada): üst sınır ("en fazla", "maksimum", "up to", "at most") ve küçüklük ("küçük", "small"). */
function restrictionClasses(tokens: readonly string[]): Set<"max" | "small" | "first"> {
  const out = new Set<"max" | "small" | "first">();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (/^(?:maks|max|azami|hochstens|hoechstens|максимум|maximal)/.test(t) || (t === "en" && /^fazla/.test(next)) || ((t === "up" || t === "at") && (next === "to" || next === "most")) || (t === "no" && next === "more")) out.add("max");
    if (/^(?:kucuk|small|little|klein|petit|pequen|piccol|маленьк|небольш)/.test(t)) out.add("small");
    // "ilk gün / first night / erste Stunde" — ücretsizliğin ya da iznin sınırı (R9).
    if (/^(?:ilk|first|erste|erst|premier|premiere|primer|primera|primo|prima|перв)/.test(t)) out.add("first");
  }
  return out;
}

/**
 * Yönsüz kalem değerinin DOĞAL yönü (parça yalnız onu ekleyebilir): giriş saati başlangıç ("Check-in: 15:00" → "15:00'ten itibaren"), çıkış
 * saati bitiş ("en geç 11:00", "by 11:00"), kişi sayısı üst sınır ("4 kişiye kadar"). Konu yeri hem girişi hem çıkışı anıyorsa doğal yön yok.
 */
/** Yerin giriş / çıkış adına göre doğal yön (giriş başlangıç, çıkış bitiş); ikisi de ya da hiçbiri yoksa null. */
function checkInOutNatural(region: string): "start" | "end" | null {
  const t = tokenize(region);
  const checkIn = t.some((w, i) => /^giris/.test(w) || w === "checkin" || (w === "check" && t[i + 1] === "in") || w === "einchecken" || /^заезд/.test(w));
  const checkOut = t.some((w, i) => /^cikis/.test(w) || w === "checkout" || (w === "check" && t[i + 1] === "out") || w === "auschecken" || /^выезд/.test(w));
  return checkIn === checkOut ? null : checkIn ? "start" : "end";
}

function naturalDirection(c: Span, partDirs: ReadonlySet<"start" | "end">, region: string): boolean {
  if (partDirs.size !== 1) return false;
  const want = [...partDirs][0];
  if (c.cls === "people") return want === "end";
  if (c.cls !== "time") return false;
  const t = tokenize(region.replace(KB_LINE_PREFIX, ""));
  const inWord = (w: string, i: number) => /^giris/.test(w) || w === "checkin" || (w === "check" && t[i + 1] === "in") || w === "einchecken" || /^заезд/.test(w);
  const outWord = (w: string, i: number) => /^cikis/.test(w) || w === "checkout" || (w === "check" && t[i + 1] === "out") || w === "auschecken" || /^выезд/.test(w);
  const checkIn = t.some(inWord);
  const checkOut = t.some(outWord);
  if (checkIn === checkOut) return false;
  // Yalın etiket ("Giriş saati: 15:00", "Check-out 11:00"): yerde giriş / çıkış adı, saat adı ve nötr sözcük dışında sözcük varsa ("Giriş KAPISI
  // 23:00", "Giriş İŞLEMLERİ 22:00", "Son giriş") doğal yön yoktur (Opus dilim sonu 10-23 R2).
  // Yön sözcükleri nötrdür (kalemin kendi yönü ayrıca kıyaslanır: "Son giriş 23:00" bitiş, giriş için doğal değil).
  const bare = t.every((w, i) => /\d/.test(w) || inWord(w, i) || outWord(w, i) || GENERIC_REGION_WORDS.has(w) || isNeutralWord(w) || w === "erken" || w === "gec" || isFiller(w, t[i - 1] ?? ""));
  if (!bare) return false;
  return want === (checkIn ? "start" : "end");
}

/** İki değer aynı bilgiyi verebiliyor mu (belirsiz "saat 9" iki saatle de örtüşür) — rakip değer kuralında "farklı değer" bunun değilidir. */
function valuesOverlap(a: Span, b: Span): boolean {
  if (!sameClass(a, b)) return false;
  if (a.tkeys && b.tkeys) return a.tkeys.some((k) => b.tkeys!.includes(k));
  return keysOf(a).some((k) => keysOf(b).includes(k));
}

const sameSet = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Kalem satırının kategori öneki ("- [AMENITIES] …", `kbLine`) konu yerinin niteleyicisi değildir. */
const KB_LINE_PREFIX = /^\s*-\s*\[[^\]\n]{1,40}\]/u;
/** Konu yerinde niteleyici sayılmayan genel saat / zaman adları ("Çıkış saati 11:00" ↔ "Check-out: 11:00"). */
/** Ücret adı (konu yerinde niteleyici sayılmaz: "Havuz ücreti 200 TL" ↔ "Havuz 300 TL" çelişir). */
const FEE_WORD = /^(?:ucret|fiyat|price|cost|fee|preis|prix|precio|tarif)/;
const MODAL_WORDS: ReadonlySet<string> = new Set("need needs must should have please kindly done alle".split(" "));
const GENERIC_REGION_WORDS: ReadonlySet<string> = new Set(
  "saat saati saatler saatleri saatimiz time times hour hours uhrzeit zeit heure horaire horaires hora horario время".split(" "),
);

// ─── doğrulanmış cevap tekrarı için dışa açık okumalar (`answer-reuse/core.ts`) ───────────────────────────────────────────────────

/**
 * `text`in her içerik sözcüğü (yüklem / bağ fiili hariç) `by` içinde aynı kökle geçiyor mu — iki AYNI dilli cevabın içerik kıyası (doğrulanmış
 * cevap tekrarı: kayıtlı metin yalnız her teyidin paylaştığı içeriğe daralır; tek misafirin eklediği cümle kalıcılaşmaz — Opus güvenlik 10-23 F7).
 */
export function contentCovered(text: string, by: string): boolean {
  const tt = tokenize(text);
  const bt = tokenize(by);
  const byTopics = new Set(topicsWithSymptomsOf(by));
  // Aynı sözlük konusu ("çıkış" ~ "check-out") da kapsar — Türkçe cevapta iki söyleyiş de olağan.
  const sameTopic = (i: number) => topicsWithSymptomsOf(`${tt[i]} ${tt[i + 1] ?? ""}`).some((x) => byTopics.has(x));
  return tt.every((t, i) => !contentWord(tt, i, []) || PREDICATE_WORDS.has(t) || bt.some((b) => sameStem(t, b)) || sameTopic(i));
}

/**
 * HARFİYEN kapsama: `text`in 3+ harfli her sözcüğü (rakam hariç, dolgu dahil) `by` içinde aynı kökle geçiyor mu. Doğrulanmış cevap tekrarında
 * kayıtlı metnin KORUNMASI bununla (Opus dilim sonu 10-23 R11: sözlük konusu kısayolu "late check-out available" ekini "check-out" sayıp
 * kayıtta bırakıyordu; tek misafirin eklediği cümle teyitlerle kalıcılaşıyordu).
 */
const SHORT_FUNCTION = new Set("at is in on to of an am as be by de da ve ya mi mu el la le et es il im um zu do so or if it we us my".split(" "));
export function literallyCovered(text: string, by: string): boolean {
  const bt = tokenize(by);
  // 2 harfli sözcük de sayılır ("TV ve WC"); kök yalnız eşitlik ya da çekim eki ("havlular" ~ "havlu") — "yer" ~ "yerinde" ortak baş değil (Haiku
  // 10-23 gece-2).
  const same = (a: string, b: string) => {
    if (a === b) return true;
    const fa = baseForms(a);
    for (const f of baseForms(b)) if (fa.has(f)) return true;
    // Uzun sözcükte en az 5 harflik ortak baş ("banyoda" ~ "banyodaki").
    let cp = 0;
    while (cp < a.length && cp < b.length && a[cp] === b[cp]) cp++;
    return cp >= 5;
  };
  return tokenize(text).every((t) => t.length < 2 || SHORT_FUNCTION.has(t) || /\d/.test(t) || bt.some((b) => same(t, b)));
}

/** Sorudaki gün / mevsim / kişi / sıklık koşul sınıfları ("cumartesi havuz kaçta" → `sat`) — iki soru aynı koşulu mu soruyor. */
export function askedConditions(text: string): string[] {
  return [...conditionClasses(tokenize(text), "evidence")].sort();
}

/** Cevabın imzası: değer anahtarları (saat / tutar / kod / sayı) + olumluluk — iki taze cevap AYNI bilgiyi mi veriyor. */
export function partSignature(text: string): { values: string[]; negative: boolean } {
  const { claims } = claimSpans(text);
  return {
    values: [...new Set(claims.map((c) => `${c.cls}:${[...keysOf(c)].sort().join("|")}`))].sort(),
    negative: negative(tokenize(text)),
  };
}

// ─── sorulan YÖN + çok tesisli istek (Opus e2e 10-23 F2 / F3; `answer-parts.ts`) ─────────────────────────────────────────────────
// Bağ denetimi konunun DEĞERİNİ doğrular, sorunun NE sorduğunu değil: "Havuz kaçta açılıyor?" isteği doğru ama başka şey söyleyen "Havuz
// ısıtmalıdır." parçasıyla kapanıyordu; "Otopark ücreti ne kadar?" konum cevabıyla. Yalnız AÇIK iki yön okunur (saat, ücret) — "ne zaman /
// when" gün de olabilir, "nerede" sözcük listesiyle okunamaz (şüphede yön aranmaz, bugünkü kural).

/** Soru / cevap metni: küçük harf (Türkçe), işaretsiz harf, tek boşluk. */
function foldAsk(s: string): string {
  return s.toLocaleLowerCase("tr").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/ß/g, "ss").replace(/\s+/g, " ");
}

/** Açık saat sorusu ("kaçta", "saat kaç", "what time", "um wie viel Uhr"); "ne zaman / when / wann" SAYILMAZ (gün de olabilir). */
const ASKS_CLOCK =
  /(?<!\p{L})(?:kac(?:ta|da)|kaca kadar|saat kac|saat(?:i|leri|ler)|what time|which time|(?<!how many )hours|opening times?|closing times?|check.?(?:in|out) time|(?:breakfast|pool|sauna|gym|quiet|opening|closing) times?|hangi saat\p{L}*|kactan|um wie ?viel uhr|bis wann|wie spat|uhrzeit|(?:offnungs|fruhstucks|ruhe|ankunfts|abreise|check-?in-?|check-?out-?)zeit\p{L}*|a quelle heure|horaires?|a que hora|horarios?|a che ora|orari|orario|во сколько|до скольки|в какое время|часы работы)(?!\p{L})/u;
/** Ücret sorusu ("ücreti ne kadar", "kaç TL", "how much is", "is it free", "kostet"). Çıplak "ne kadar / how much / combien" sayılmaz (mesafe / adet de olur). */
const ASKS_PRICE =
  /(?<!\p{L})(?:ucret\p{L}*|fiyat\p{L}*|kac (?:para|lira|tl|euro|dolar)|ne kadar tutar\p{L}*|cost\p{L}*|price\p{L}*|fees?|charges?|charged|how much (?:is|are|does|do|for|will|would|to|extra)|(?<!(?:feel|smoke|gluten|pet|sugar|lactose|nut|allergy|duty|tax)[ -]?)free(?! time)|paid|kost(?:et|en|enlos)|preis\p{L}*|gebuhr\p{L}*|umsonst|prix|combien (?:coute|ca coute|pour)|cout(?:e|ent)?|tarifs|tarifa|tariffa|frais|gratuit\p{L}*|payant\p{L}*|precio\p{L}*|cuesta|cuanto (?:cuesta|vale)|costo|coste|gratis|prezzo|quanto costa|сколько стоит|цен(?:а|ы|у|е|ой|ник\p{L}*)|стоимост\p{L}*|(?:о|за)?плат(?:а|ы|у|е|но|ный|ная|ное|ить|ят)|бесплатн\p{L}*|тариф\p{L}*|(?:ال)?سعر|(?:ال)?اسعار|تكلف\p{L}*|(?:ال)?رسوم|(?:ال)?مجان\p{L}*)(?!\p{L})/u;

export type AskedAspect = "time" | "price";

/** İsteğin sorguları (Türkçe + özgün dil) hangi AÇIK yönü soruyor. */
export function askedAspects(queries: readonly string[]): AskedAspect[] {
  const q = queries.map(foldAsk);
  const out: AskedAspect[] = [];
  if (q.some((x) => ASKS_CLOCK.test(x))) out.push("time");
  if (q.some((x) => ASKS_PRICE.test(x))) out.push("price");
  return out;
}

/**
 * Çalışma saatleri sorusu ("açılış saatleri", "opening hours", "Öffnungszeiten") yön sormaz — açılış sözcüğü taşısa da (Opus taze göz 10-23 F4:
 * "pool opening hours" ↔ "The pool is open until 20:00." tutuluyordu). Tekil "açılış saati" / "opening time" yön sorar.
 */
const HOURS_OF_OPERATION =
  /(?<!\p{L})(?:opening (?:hours|times)|acilis saatleri|calisma saatleri|offnungszeit\p{L}*|horaires? d.ouverture|horarios? de apertura|orari di apertura|часы работы)(?!\p{L})/gu;
/**
 * Soru cümlesindeki yön fiili (soruda değer olmadığı için `directions`ın "değer ardından" şartı burada aranmaz): "what time does the pool OPEN",
 * "when does it CLOSE"; "kaçTAN kaÇA" iki yön (Haiku 10-23 gece-4: "open and close" ve "kaçtan kaça açık" yönsüz okunuyordu).
 */
const QUESTION_START = /(?<!\p{L})(?:open|opens|offnet|ouvre|ouvrent|abre|abren|apre|aprono|открыва\p{L}*)(?!\p{L})/u;
const QUESTION_END = /(?<!\p{L})(?:close|closes|closing|schliesst|schliessen|ferme|ferment|cierra|cierran|chiude|chiudono|закрыва\p{L}*)(?!\p{L})/u;
const FROM_TO_ASKED = /(?<!\p{L})kactan (?:\p{L}+ )?kaca(?!\p{L})/u;
const UNTIL_WORD = /(?<!\p{L})(?:until|till|bis|jusqu|hasta|fino|kadar|kaca)(?!\p{L})/u;

const CLOSING_ASKED = /(?<!\p{L})(?:kapanis\p{L}*|kapanma\p{L}*|closing|close|schliess\p{L}*|fermeture|cierre|chiusura|закрыт\p{L}*)(?!\p{L})/u;

/**
 * Saat sorusunun YÖNÜ ("havuz kapanış saati" → bitiş, "kahvaltı kaça kadar" → bitiş, "havuz açılış saati" → başlangıç; Haiku 10-23 gece-3: "Havuz
 * kapanış saati" isteği "Havuz 09:00'da açılır." ile kapanıyordu). İki yön birden ("kaçta açılıp kaçta kapanıyor") → `both` (Opus taze göz 10-23
 * F2: tek yönü veren parça isteğin öbür yarısını sessizce kapatıyordu); yön yoksa `null`.
 */
export function askedDirection(queries: readonly string[]): "start" | "end" | "both" | null {
  const d = new Set<"start" | "end">();
  for (const q of queries) {
    const f = foldAsk(q);
    if (!ASKS_CLOCK.test(f)) continue;
    // Çalışma saatleri öbeği yön taşımaz; sorgunun GERİ KALANI taşıyabilir ("havuz çalışma saatleri kaçta AÇILIYOR" — Haiku 10-23 gece-4).
    // Kapanışı da açıkça anan sorgu ("kapanış ve açılış saatleri") iki yön sorar.
    const rest = CLOSING_ASKED.test(f) ? f : f.replace(HOURS_OF_OPERATION, " ");
    for (const x of directions(tokenize(rest))) d.add(x);
    // "open UNTIL" kapanışı sorar (Opus 10-23 R4: "what time is the pool open until" iki yön sayılıyordu).
    if (QUESTION_START.test(rest) && !UNTIL_WORD.test(rest)) d.add("start");
    if (QUESTION_END.test(rest)) d.add("end");
    if (FROM_TO_ASKED.test(rest)) {
      d.add("start");
      d.add("end");
    }
  }
  return d.size === 2 ? "both" : d.size === 1 ? [...d][0] : null;
}

/**
 * Saat sorusunu saatsiz cevaplayan söyleyişler — YÜKLEM olarak: "her zaman / gün boyu AÇIK", "kapalıdır" (yan cümle sonunda), "kullanılamaz",
 * "gece yarısı", "öğlen". Sıfat / başka anlam sayılmaz (Opus taze göz 10-23 F1: "KAPALI havuz ısıtmalıdır" (kapalı = iç mekân), "havuz her
 * zaman TEMİZDİR", "ÖĞLE yemeği" saat cevabı sayılıp istek kapanıyordu).
 */
const CLAUSE_END = String.raw`(?=\s*(?:[.!?,;:]|$))`;
const CLOCKLESS_TIME_ANSWER = new RegExp(
  String.raw`(?<!\p{L})(?:` +
    [
      String.raw`(?:her zaman|gun boyu|butun gun|tum gun|gece gunduz|surekli) (?:\p{L}+ )?(?:acik\p{L}*|kullanilabilir\p{L}*|hizmet ver\p{L}*)`,
      String.raw`acik degil\p{L}*|kullanilamaz\p{L}*|hizmet vermi\p{L}*|kapanmaz|kapanmamaktadir`,
      String.raw`kapali(?:dir|tir)?${CLAUSE_END}`,
      String.raw`(?:always|all day|around the clock|day and night) (?:\p{L}+ )?(?:open|available|accessible)|open (?:\p{L}+ )?(?:all day|around the clock|day and night|at all times|always)`,
      String.raw`(?:is|are|stays|remains|will be) (?:\p{L}+ )?closed|closed${CLAUSE_END}|not open|not available|unavailable`,
      String.raw`immer (?:\p{L}+ )?(?:geoffnet|offen)|rund um die uhr|ganztag\p{L}*|(?:ist|sind|bleibt|bleiben) (?:\p{L}+ )?geschlossen|geschlossen${CLAUSE_END}`,
      String.raw`toujours ouvert\p{L}*|toute la journee|(?:est|sont|reste) (?:\p{L}+ )?ferme\p{L}*|ferme(?:e|es|s)?${CLAUSE_END}`,
      String.raw`siempre abiert\p{L}*|todo el dia|(?:esta|estan|permanece) (?:\p{L}+ )?cerrad\p{L}*|cerrad[ao]s?${CLAUSE_END}`,
      String.raw`sempre apert\p{L}*|tutto il giorno|(?:e|sono|resta) chius\p{L}*|chius[oaie]${CLAUSE_END}`,
      String.raw`всегда открыт\p{L}*|круглосуточно|закрыт[аоы]?|день и ночь`,
    ].join("|") +
    String.raw`)(?!\p{L})`,
  "u",
);
/**
 * Sözcükle söylenen SAAT ("gece yarısı", "öğlen", "midnight", "noon", "Mitternacht", "minuit"…): saat gibi YÖN denetiminden geçer — "Havuz
 * öğlene kadar açık" açılış sorusunu cevaplamaz (Haiku 10-23 gece-4: saatsiz cevap sayılıp yönü aranmıyordu).
 */
const CLOCK_WORD =
  /(?<!\p{L})(?:gece yarisi\p{L}*|oglen\p{L}*|ogle(?:den|ye|de)|midnight|noon|mitternacht|mittags?|minuit|midi|medianoche|mediodia|mezzanotte|mezzogiorno|полноч\p{L}*|полден\p{L}*)(?!\p{L})/u;
/**
 * Konunun BAŞKA bir yönü (temizlik, bakım, ısıtma): "Havuz temizliği 09:00'da başlar" havuzun açılış sorusunu cevaplamaz (Haiku 10-23
 * gece-4). Soru da aynı yönü soruyorsa ("havuz temizliği kaçta") cevaptır.
 */
const FACET = /(?<!\p{L})(?:temizli\p{L}*|temizle\p{L}*|bakim\p{L}*|isitma(?!l[iı])\p{L}*|isitil\p{L}*|ilaclama\p{L}*|cleaning|cleaned|clean|maintenance|maintained|heating|heated up|gereinigt|reinigt|nettoy\p{L}*|limpia\p{L}*|pulit\p{L}*|чист\p{L}*|reinigung|wartung|heizung|nettoyage|entretien|chauffage|limpieza|mantenimiento|calefaccion|pulizia|manutenzione|riscaldamento|уборк\p{L}*|обслуживан\p{L}*|подогрев\p{L}*)(?!\p{L})/u;
/** "24 saat" ancak açıklık yüklemiyle saat cevabıdır ("24 saat açık"); "bakım 24 saat sürer" süredir (Haiku 10-23 gece-4). */
const OPEN_WORD = /(?<!\p{L})(?:acik\p{L}*|hizmet\p{L}*|kullanilabilir\p{L}*|open|available|accessible|geoffnet|offen|ouvert\p{L}*|abiert\p{L}*|apert\p{L}*|открыт\p{L}*|مفتوح)(?!\p{L})/u;
const SLASH_ROUND = /(?<![\d/])(?:7 ?\/ ?24|24 ?\/ ?7|24 ?\/ ?24|24 ?h ?\/ ?24)(?![\d/])(?! ?(?:tarih\p{L}*|date|gunu))/u;
/** Olumsuzlanmış açıklık ("not open 24 hours", "24 saat açık değildir") gün boyu açık değildir (Opus 10-23 R4 F11). */
const NOT_OPEN = /(?<!\p{L})(?:not open|isn.t open|acik degil\p{L}*|nicht (?:\p{L}+ )?(?:geoffnet|offen)|n.est pas ouvert\p{L}*|no esta abiert\p{L}*|не открыт\p{L}*)(?!\p{L})/u;
/** Kapalılık yüklemi saatle birlikte yönü TERS çevirebilir ("09:00'a kadar kapalıdır" = 09:00'da açılır) → yön sorusunda şüpheli (Opus 10-23 R4 F5). */
const CLOSED_WORD = /(?<!\p{L})(?:kapali\p{L}*|closed|geschlossen|ferme\p{L}*|cerrad\p{L}*|chius\p{L}*|закрыт\p{L}*)(?!\p{L})/u;
/** Olumsuz erişim saatle birlikte yönü ters çevirir ("No pool access BEFORE 09:00" = 09:00'da açılır — Opus 10-23 R4 F8). */
const INVERTING =
  /(?<!\p{L})(?:kullanilamaz\p{L}*|kullanilmaz|yasak\p{L}*|giris yok|not available|unavailable|not allowed|no access|not accessible|nicht (?:\p{L}+ )?(?:erlaubt|zuganglich|verfugbar)|verboten|interdit\p{L}*|no (?:se )?permit\p{L}*|prohibid\p{L}*|vietat\p{L}*|запрещ\p{L}*|недоступ\p{L}*)(?!\p{L})/u;
/** Günün bölümü ("öğleden sonra", "afternoon", "après-midi", "Nachmittag") yön ya da saat değildir (Opus 10-23 R4 F7 / F15). */
const DAY_PART = /(?<!\p{L})(?:ogleden sonra|aksamustu|aksam ustu|afternoon|after ?noon|apres.?midi|nachmittags?|tarde|pomeriggio)(?!\p{L})/gu;
/** Konuşma zamanı / gün sözcükleri — konu ile yüklem arasında atlanır ("Havuz KIŞIN kapalıdır", "Der Pool ist MONTAGS geschlossen"). */
const TEMPORAL_SKIP = /^(?:pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|hafta|sonu|sonlari|gun|aksam|gece|sabah|kis|yaz|bugun|yarin|simdi|bayram|today|tomorrow|now|currently|temporarily|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|winter|summer|heute|morgen|derzeit|montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags|sommer|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|hiver|ete|hoy|lunes|invierno|verano|oggi|lunedi|inverno|estate)\p{L}*$/u;
/**
 * "7/24 / 24 saat / 24 hours / 24 horas / 24 Stunden / 24 часа / 24 ساعة / 24h/24" açık — ARDINDAN "önce(den) / sonra / içinde / in advance /
 * vorher / заранее" gelmiyorsa (Haiku 10-23 gece-3: "Havuz 24 saat önceden ısıtılır." kapanış saati sorusunu cevaplıyordu). Birim sözcük
 * sınırında biter ("24 Haziran", "24 hafta", "24 saatlik" saat cevabı değildir — Opus taze göz 10-23 F1).
 */
const ROUND_THE_CLOCK =
  /(?<![\d/])(?:7 ?\/ ?24|24 ?\/ ?7|24 ?\/ ?24|24 ?h ?\/ ?24|24 ?(?:saat|hours?|hrs?|horas|stunden|std|heures|ore|часа|ساعة|h)(?!\p{L})(?! ?(?:once\p{L}*|sonra\p{L}*|icinde|icerisinde|before|after|in advance|advance|prior|notice|vorher|im voraus|a l.avance|avant|apres|antes|despues|de antelacion|prima|dopo|заранее|до|после|قبل|بعد)(?!\p{L})))(?![\d/])/u;
/**
 * Ücret sorusunu tutarsız cevaplayan söyleyişler — yalnız CEVAP biçimi: ücretsiz / dahil(dir) / ücret alınmaz / free / included. Konu
 * sözcükleri ("ücret", "fee", "paid", "price") cevap değildir (Opus taze göz 10-23 F1: "Otopark ücreti check-out'ta nakit ödenir", "Paid
 * parking is available", "Otopark site DAHİLİNDEDİR" ücret sorusunu kapatıyordu).
 */
const AMOUNTLESS_PRICE_ANSWER = new RegExp(
  String.raw`(?<!\p{L})(?:` +
    [
      String.raw`ucretsiz\p{L}*|bedava\p{L}*|(?:fiyata|ucrete|kiraya|konaklamaya|fiyatimiza)? ?dahil(?:dir|tir)?|para (?:alinmaz|odenmez|istenmez)|(?:ek )?ucret (?:alinmaz|alinmamaktadir|odenmez|istenmez|talep edilmez|yok(?:tur)?)`,
      String.raw`(?<!(?:feel|smoke|gluten|sugar|lactose|nut|allergy|duty|tax)[ -]?)free(?! time)|included|inclusive|complimentary|no (?:extra )?(?:charge|cost|fee)|at no (?:extra )?cost|without charge|costs nothing`,
      String.raw`kostenlos|gratis|inklusive|inbegriffen|keine (?:extra |zusatzliche )?gebuhr\p{L}*|ohne aufpreis|gratuit\p{L}*|inclus\p{L}*|sans frais|incluid\p{L}*|sin (?:costo|cargo)|gratuito|incluso`,
      String.raw`бесплатн\p{L}*|включен\p{L}*|входит в стоимость|(?:ال)?مجان\p{L}*|مشمول\p{L}*`,
    ].join("|") +
    String.raw`)(?!\p{L})`,
  "u",
);
/** Olumsuzlanmış tutarsız cevap ("ücrete dahil DEĞİLDİR", "NOT free", "nicht inklusive") ücret cevabı değildir (Haiku 10-23 gece-4). */
const NEGATED_AMOUNTLESS =
  /(?<!\p{L})(?:(?:ucretsiz|dahil|bedava)\p{L}* degil\p{L}*|dahil (?:edilmemis|edilmez|edilmiyor|edilmemektedir)\p{L}*|(?:not|isn.t|aren.t|no longer) (?:\p{L}+ ){0,2}(?:free|included|complimentary)|nicht (?:\p{L}+ ){0,3}(?:kostenlos|inklusive|inbegriffen|gratis)|не (?:\p{L}+ )?входит\p{L}*|(?:n.est|ne sont) pas (?:\p{L}+ )?(?:gratuit|inclus)\p{L}*|no (?:es|esta|estan) (?:\p{L}+ )?(?:gratis|gratuit|incluid)\p{L}*|non (?:e )?(?:gratuit|inclus)\p{L}*|не (?:\p{L}+ )?(?:бесплатн|включен)\p{L}*)(?!\p{L})/u;
/** Dahil / ücretsiz mi sorusu (evet / hayır): olumsuz cevap ("kahvaltı fiyata dahil değildir") da cevaptır. */
const ASKS_INCLUSION =
  /(?<!\p{L})(?:dahil\p{L}*|ucretsiz\p{L}*|bedava\p{L}*|included|include|includes|free|complimentary|inklusive|inbegriffen|kostenlos|inclus\p{L}*|gratuit\p{L}*|incluid\p{L}*|gratis|incluso|бесплатн\p{L}*|включен\p{L}*)(?!\p{L})/u;
/** Tutar sorusu ("ne kadar", "how much", "wie viel") — dahil mi sorusuyla birlikte sorulduysa olumsuz cevap tutarı vermez (Opus 10-23 R4 F14). */
const ASKS_AMOUNT = /(?<!\p{L})(?:ne kadar|kac (?:para|lira|tl|euro|dolar)|how much|combien|wie ?viel|cuanto|quanto|сколько)(?!\p{L})/u;
/** Ücret ödenmediğini söyleyen yüklem ("ücret ödemeniz gerekmez", "ödeme gerekmez", "you don't need to pay"). */
const NO_PAYMENT_NEEDED =
  /(?<!\p{L})(?:(?:ucret|para)\p{L}* (?:odemeniz|odemenize|vermeniz)? ?(?:gerekmez|gerekmiyor|gerek yok)|(?:don.t|do not|doesn.t|does not) (?:need|have) to pay(?! (?:now|in advance|upfront|up front|yet|until|at|on|before|today|a deposit|deposit)))(?!\p{L})/u;
/**
 * Tutar — `claimSpans` okumazsa da: rakam + para birimi ("200 liradır", "20 eurodur", "10 dolardır", "500 рублей", "₺200"; Opus taze göz
 * 10-23 F3: doğru Türkçe fiyatlar tutuluyordu).
 */
const LOCAL_AMOUNT =
  /(?:[₺€$£₽]\s?\d|\d[\d.,]*\s?(?:[₺€$£₽]|(?:tl|try|lira|euro|avro|eur|dolar|dollar|usd|gbp|sterlin|pound|руб|евро|доллар|ريال|ليرة|دولار|يورو)\p{L}*(?!\p{L})))/u;

/**
 * Konunun kendisini yok sayan / yasaklayan cevap saat ve ücret sorusunu da cevaplar ("Evcil hayvan için ücret var mı?" ↔ "Evcil hayvan kabul
 * edilmez."; "Havuz kaçta açılıyor?" ↔ "Havuz yoktur."). Olumsuzluk SORULAN KONUYA bağlı olmalı (Opus taze göz 10-23 F1: "Havuzda CANKURTARAN
 * yoktur", "Havuz alanında CAM ŞİŞE yasaktır" saat sorusunu kapatıyordu): sonraki olumsuzlukta ("X yoktur / kabul edilmez / not allowed")
 * hemen önündeki sözcük, önceki olumsuzlukta ("there is no X / kein X / нет X") hemen ardındaki sözcük konu sözcüğü olmalı.
 */
const DENIAL_AFTER =
  /(?<!\p{L})(?:yok(?:tur|tu)?|bulunma(?:maktadir|z)|bulunmuyor|mevcut degil\p{L}*|kabul edil(?:mez|memektedir|miyor)|izin veril(?:mez|memektedir|miyor)|yasak(?:tir)?|not allowed|not permitted|prohibited|forbidden|nicht erlaubt|nicht gestattet|verboten|interdit\p{L}*|pas autorise\p{L}*|no se permite\p{L}*|prohibid\p{L}*|non (?:e )?(?:consentit|ammess)\p{L}*|vietat\p{L}*|нет|запрещ\p{L}*|не допуска\p{L}*|ممنوع)(?!\p{L})/gu;
const DENIAL_BEFORE =
  /(?<!\p{L})(?:no|there is no|there are no|we do not have|we don.t have|gibt es (?:keine?n?|nicht)|kein\p{L}*|il n.y a pas(?: de| d)?|pas de|no hay|non c.e|нет|لا يوجد)(?!\p{L})/gu;
/** Olumsuzluk ile konu arasında atlanabilen sözcükler (yardımcı fiil, zarf, mastar, tanımlık). */
const DENIAL_SKIP = new Set(
  (
    "maalesef kesinlikle hicbir sekilde surette burada dairede evde sitede otelde icinde olarak ne yazik ki " +
    "is are be been strictly unfortunately currently also here inside the a an any allowed " +
    "ist sind leider hier streng der die das ein eine einen est sont malheureusement ici de d le la les un une des " +
    "esta estan aqui el los las e sono qui il lo gli не здесь тоже anda an simdilik artik henuz su moment presently at bu o bizim sizin our this unser unsere notre nuestro"
  ).split(" "),
);
/** Sorulan konunun sözcüğü mü (ihtiyaç sözcüğü ya da tesis kökü; bulunma / ayrılma hâli değil) + atlanabilir sözcükler. */
function subjectMatcher(subjectTerms: readonly string[]) {
  const termFacilities = facilitiesIn(subjectTerms.join(" "));
  // Bulunma / ayrılma hâli ("havuzDA cankurtaran yok") konunun kendisi değildir (Haiku 10-23 gece-4). Sözlük konusu eşleşmesi bilerek YOK
  // ("Şezlong yoktur" havuzun yokluğu değildir — Opus 10-23 R4 F8); çeviri sözcükleri ihtiyaç sözcüklerinde zaten var.
  const locative = (w: string) => !subjectTerms.includes(w) && /(?:[dt][ae]|[dt][ae]n|[dt][ae]ki|n[dt][ae])$/.test(w);
  const isSubject = (w: string) => (w.length >= 3 && needTermsInStrict(subjectTerms, w) > 0) || [...facilitiesIn(w)].some((f) => termFacilities.has(f));
  const skippable = (w: string) => DENIAL_SKIP.has(w) || TEMPORAL_SKIP.test(w) || /(?:mek|mak)$/.test(w);
  return { isSubject, locative, skippable };
}
const plainWords = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Önündeki yan cümlede konu, yüklemin öznesi mi: ilk içerik sözcüğü konu sözcüğü ve ondan önce yalnız atlanabilir / yer zarfı / konu sözcüğü
 * ("ÇOCUK havuzu yoktur", "Please keep the pool GATE closed" konu değil — Haiku 10-23 gece-4, Opus R4 F6).
 */
function subjectBefore(text: string, at: number, m: ReturnType<typeof subjectMatcher>): boolean {
  const clause = text.slice(0, at).split(/[.!?;,:]/u).pop() ?? "";
  const before = plainWords(clause);
  // Yer / zaman zarfı ("kış AYLARINDA", "sitemizDE") atlanır — bulunma hâlindeki sözcük konunun kendisi olamaz.
  const w = [...before].reverse().find((x) => !m.skippable(x) && !m.locative(x));
  if (!w || !m.isSubject(w)) return false;
  const i = before.lastIndexOf(w);
  return before.slice(0, i).every((x) => m.skippable(x) || m.locative(x) || m.isSubject(x));
}

function deniesSubject(text: string, subjectTerms: readonly string[]): boolean {
  if (subjectTerms.length === 0) return false;
  const m = subjectMatcher(subjectTerms);
  for (const d of text.matchAll(DENIAL_AFTER)) if (subjectBefore(text, d.index, m)) return true;
  for (const d of text.matchAll(DENIAL_BEFORE)) {
    // Olumsuzluktan sonraki ilk içerik sözcüğü (aynı yan cümlede — "No, the pool…" ünlemi boş yan cümledir) konu olmalı ve ardından başka bir
    // ad gelmemeli ("There is no pool BAR", "No pool ACCESS before 09:00" — Opus 10-23 R4 F8).
    const clause = text.slice(d.index + d[0].length).split(/[.!?;,:]/u)[0] ?? "";
    const after = plainWords(clause);
    const i = after.findIndex((x) => !m.skippable(x));
    if (i < 0 || !m.isSubject(after[i])) continue;
    const next = after[i + 1];
    if (!next || m.skippable(next) || m.isSubject(next) || DENIAL_AFTER_WORD.test(next)) return true;
  }
  return false;
}
const DENIAL_AFTER_ANY = new RegExp(DENIAL_AFTER.source, "u");
const DENIAL_BEFORE_ANY = new RegExp(DENIAL_BEFORE.source, "u");
const DENIAL_AFTER_WORD = /^(?:allowed|permitted|available|on|at|in|for|here|whatsoever|erlaubt|gestattet|autorise\p{L}*|permitid\p{L}*)$/u;

/** İki saat ARALIK mı ("09:00-20:00", "09:00 ile 20:00 arası", "from 9 to 20", "von 9 bis 20"). */
function timeRange(normalized: string, times: readonly { at: number; end: number }[]): boolean {
  const sorted = [...times].sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++) {
    const gap = normalized.slice(sorted[i - 1].end, sorted[i].at);
    if (gap.length > 24) continue;
    // Bağlaçlı ("09:00 - 20:00", "09:00 ile 20:00", "from 9 to 20") ya da ayrılma ekli ("09:00'dan 20:00'ye kadar") ikili.
    if (/^[\s'’\p{L}]{0,6}\s*(?:-|–|—|ile|to|until|till|bis|a|à|al|hasta|fino a|до|ve|and|und|et|y)\s*$/u.test(gap)) return true;
    if (/^\s*['’]?[dt][ae]n(?: itibaren)?\s*$/u.test(gap)) return true;
  }
  return false;
}

const CLOCKLESS_G = new RegExp(CLOCKLESS_TIME_ANSWER.source, "gu");
/**
 * Parçanın cevaplamadığı sorulan yönler (boş = hepsi cevaplandı): saat sorusu saat ya da saatsiz cevap, ücret sorusu tutar ya da tutarsız
 * cevap ister. `subjectTerms` = isteğin konu sözcükleri (olumsuzluk ancak konuya bağlıysa cevap sayılır).
 */
export function missingAspects(
  part: string,
  aspects: readonly AskedAspect[],
  direction: "start" | "end" | "both" | null = null,
  subjectTerms: readonly string[] = [],
  queries: readonly string[] = [],
): AskedAspect[] {
  if (aspects.length === 0) return [];
  const { claims } = claimSpans(part);
  const text = foldAsk(part);
  if (deniesSubject(text, subjectTerms)) return [];
  const facetAsked = FACET.test(foldAsk(subjectTerms.join(" ")));
  const m = subjectTerms.length > 0 ? subjectMatcher(subjectTerms) : null;
  // Yön yalnız SAAT taşıyan yan cümlelerden okunur — "…, sonra güvenlik kapıyı kilitler" yan cümlesinin "sonra"sı kapanış saatine yön vermez
  // (Opus 10-23 R4 F7); eksiltili yan cümle ("…, hafta sonları ise 23:00'te kapanıyor") kendi saatiyle sayılır.
  const clauses = part
    .split(/[.;!?]+|,(?=\s)|\s(?:ve|and|und|et|y|e|ama|but|aber|mais|pero|ma)\s/u)
    .map((c) => c.trim())
    .filter(Boolean);
  type Read = { times: number; clock: number; dirs: Set<"start" | "end">; text: string; normalized: string; spans: { at: number; end: number }[] };
  const reads: Read[] = [];
  let anyTime = false;
  for (const c of clauses) {
    const f = foldAsk(c).replace(DAY_PART, " ");
    const cs = claimSpans(c);
    const ts = cs.claims.filter((x) => x.cls === "time");
    const clock = CLOCK_WORD.test(f) ? 1 : 0;
    if (ts.length + clock === 0) continue;
    anyTime = true;
    // Konunun başka bir yönü (temizlik / bakım / ısıtma) soruda yoksa bu yan cümle sorulanı cevaplamaz.
    if (!facetAsked && FACET.test(f)) continue;
    const dirs = directions(tokenize(f));
    if (/(?<!\p{L})itibariyla (?:\p{L}+ )?acik/u.test(f)) dirs.add("start");
    reads.push({ times: ts.length, clock, dirs, text: c, normalized: cs.text, spans: ts });
  }
  const clocklessOk = (): boolean => {
    if (NOT_OPEN.test(text)) return false;
    if (SLASH_ROUND.test(text) || (ROUND_THE_CLOCK.test(text) && OPEN_WORD.test(text))) return true;
    if (!CLOCKLESS_TIME_ANSWER.test(text)) return false;
    // Saatsiz yüklem SORULAN KONUYA bağlı olmalı ("Please keep the pool gate closed" — Opus 10-23 R4 F6).
    if (!m) return true;
    for (const x of text.matchAll(CLOCKLESS_G)) if (subjectBefore(text, x.index, m)) return true;
    return false;
  };
  const answersTime = (): boolean => {
    // Saat taşıyan yan cümle yoksa saatsiz cevap aranır; varsa saatler esastır (Opus 10-23 R4 F5: "The pool is closed after 20:00").
    if (!anyTime) return clocklessOk();
    const n = reads.reduce((k, r) => k + r.times + r.clock, 0);
    if (n === 0) return false;
    if (!direction) return true;
    // Kapalılık yüklemi saatle birlikte yönü ters çevirebilir ("09:00'a kadar kapalıdır") → yön sorusunda tutulur.
    if (CLOSED_WORD.test(text) || INVERTING.test(text) || DENIAL_AFTER_ANY.test(text) || DENIAL_BEFORE_ANY.test(text)) return false;
    const dirs = new Set<"start" | "end">(reads.flatMap((r) => [...r.dirs]));
    const range = reads.some((r) => r.times >= 2 && timeRange(r.normalized, r.spans)) || (n >= 2 && dirs.has("start") && dirs.has("end"));
    // İki yön soruldu: aralık ya da iki yönlü iki saat ("09:00'da açılır, 20:00'de kapanır") şart.
    if (direction === "both") return range;
    if (range) return true;
    // Tek yön soruldu: parçanın yönü sorulanı içermeli ("kapanış saati" ↔ "09:00'da açılır" cevap değildir). Yön sözcüğü yoksa yalnız
    // değerin doğal yönü serbest ("Check-out saati 11:00" → "çıkış kaça kadar"); "Kahvaltı 08:00'de servis edilir" "kaça kadar"ı cevaplamaz.
    if (dirs.size > 0) return dirs.has(direction);
    const only = reads.length === 1 && reads[0].times === 1 && reads[0].clock === 0 ? reads[0] : null;
    const span = only ? claims.find((c) => c.cls === "time") : undefined;
    return !!span && naturalDirection(span, new Set([direction]), part);
  };
  const answersPrice = (): boolean => {
    if (!facetAsked && FACET.test(text)) return false;
    return (
      claims.some((c) => c.cls === "money" || c.cls === "percent") ||
      LOCAL_AMOUNT.test(text) ||
      NO_PAYMENT_NEEDED.test(text) ||
      (AMOUNTLESS_PRICE_ANSWER.test(text) &&
        (!NEGATED_AMOUNTLESS.test(text) || (ASKS_INCLUSION.test(foldAsk(queries.join(" "))) && !ASKS_AMOUNT.test(foldAsk(queries.join(" "))))))
    );
  };
  return aspects.filter((a) => (a === "time" ? !answersTime() : !answersPrice()));
}

/**
 * Tek sorgu İKİ+ tesis soruyorsa ("sauna ve havuz kaçta açık" — anlama katmanı iki isteği bir isteğe katabilir) parça hepsini anmalı:
 * yalnız havuzu cevaplayan parça isteği kapatırsa sauna sorusu kaybolur. Çok dilli tesis kökleri (`FACILITY_ROOTS`) — çeviri çifti aynı
 * kimliği taşır. Anlama katmanının sorguları istek başına ANAHTAR SÖZCÜKTÜR
 * ("havuz kapanış saati"), misafirin cümlesi değil (`semantic/understand.ts`).
 */
export function missesAskedFacility(part: string, queries: readonly string[]): boolean {
  // İsteğin BÜTÜN sorgularındaki tesisler (Haiku 10-23 gece-3: aynı işe düşen "havuz kapanış saati" + "sauna kapanış saati" sorgu başına tek
  // tesis olduğu için denetimsiz kalıyordu). Çeviri çifti aynı kimliği taşır; şüphede TUT (istek açık kalır, ev sahibine düşer).
  const asked = new Set(queries.flatMap((q) => [...facilitiesIn(q)]));
  if (asked.size < 2) return false;
  const inPart = facilitiesIn(part);
  return [...asked].some((f) => !inPart.has(f));
}
