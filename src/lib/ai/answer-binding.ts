// ---------------------------------------------------------------------------
// CEVAP PARÇASI DOĞRULAYICISI — değer ↔ konu ↔ koşul ↔ olumsuzluk (kurucu 10-23 A; saf, deterministik, LLM'siz).
//
// Kurucu (A, Codex notuyla): "Havuz sorusu → havuzun kapanış bilgisi → 20:00 → gönderilecek cevap. Saunanın 22:00 bilgisi gerçekten
// mevcut olsa bile havuza dayanak olamamalı. Saatin yanında hangi yere, hangi kurala ve koşula ait olduğu doğrulanmalı. Bunun farklı dilde,
// olumsuz ve koşullu cümlelerle test edilmesini isteyelim."
//
// Girdi: bir ihtiyacın cevap parçası + modelin o parça için gösterdiği DAYANAK ALINTISI + alıntının geldiği bilgi tabanı kaleminin metni +
// ihtiyacın kendi sözcükleri (`topic-absence.needTerms`) ve sözlük konuları. Kontroller (hepsi şart; biri tutmazsa parça GİTMEZ, ihtiyaç ev
// sahibinde açık kalır — şüphede tut):
//   1. Alıntı kalemde gerçekten geçiyor (okuyucunun kanıt kuralının aynısı: NFKC + görünmez karakter + benzer harf).
//   2. Parçadaki her somut değer (saat, tutar, süre, sayı, kod — `claim-support` ayrıştırıcısı) alıntıda da var.
//   3. O değer alıntıda ihtiyacın KONUSUNA bağlı. Değerin yeri: aynı cümlede kendinden önceki değerin bitişinden kendi bitişine kadarki parça
//      ("Havuz 20:00'de, sauna 22:00'de kapanır" → 22:00'nin yeri ", sauna 22:00" — havuz DEĞİL). Aralık tek değerdir ("09:00-20:00",
//      "09:00 ile 20:00 arası"). Konusuz değişke ("…, hafta sonu 11:00'e kadar") önceki değerin konusunu ancak çevresinde (önünde VE
//      ardında) başka içerik sözcüğü yoksa devralır — "Havuz 20:00'de, 22:00'de sauna kapanır" devralmaz (ardında "sauna" var). Konu sözcüğü
//      SIKI eşleşir (yalnız çekim eki: "havuz" ~ "havuzumuz"; "kapı" ≁ "kapıcı").
//   4. O değerin KOŞULU (hafta sonu / hafta içi / gün adı / mevsim / yalnız / hariç / koşullu / talep üzerine) parçada da var — dil fark
//      etmez (sınıf karşılaştırması: "hafta sonu" ↔ "weekend" ↔ "Wochenende"). Koşul, değerin bulunduğu YAN CÜMLEDEN (virgül / "ve / and /
//      ama / but" ile ayrılmış) ve aynı cümlenin değersiz ama konuyu anan yan cümlelerinden okunur ("Havuz yalnız yazın açıktır, 09:00-20:00").
//   5. Olumsuzluk aynı yerden okunur: o yer olumsuzsa ("yasak", "not allowed", "nicht", "-mez") parça da olumsuz, değilse değil.
// Değersiz parça ("Evcil hayvan kabul edilmiyor"): konu alıntıda geçmeli; konunun geçtiği cümle(ler)in olumsuzluğu ve koşulu parçayla aynı
// olmalı (cümle düzeyi — karışık cümlede fazla tutar, az değil).
// Konusu hiç bilinmeyen ihtiyaç (sözcük de sözlük konusu da yok) doğrulanamaz → TUTULUR.
// Bilinen sınır (tutma yönünde): "ücretsizdir" ↔ "ücretli değil" farklı olumluluk sayılır; parantezli değişke ("20:00 (hafta sonu 23:00)")
// konusuz kalır. İkisi de cevabı ev sahibine bırakır, yanlış göndermez.
// Doğrusal: bölme / belirteçleme tek geçiş; iç döngüler değer ve yan cümle sayısıyla sınırlı.
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
  "polarity_mismatch",
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

// ─── koşul ve olumsuzluk sınıfları (katlanmış belirteçler; `tokenize` biçimi) ─────────────────────────────────────────────────────

/** Tek belirteç → koşul sınıfı (alıntıda bulunursa parçada da olmalı). Gün adları kendi sınıfı; çekimli biçim de okunur ("cumartesileri"). */
const CONDITION_TOKENS: Readonly<Record<string, string>> = {
  weekend: "weekend",
  weekends: "weekend",
  wochenende: "weekend",
  weekday: "weekday",
  weekdays: "weekday",
  werktags: "weekday",
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
  sauf: "except",
  excepto: "except",
  unless: "conditional",
  eger: "conditional",
  sartiyla: "conditional",
  kosuluyla: "conditional",
  request: "on_request",
  talep: "on_request",
  appointment: "on_request",
  randevu: "on_request",
  anfrage: "on_request",
  demande: "on_request",
  peticion: "on_request",
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

/** Yalnız PARÇADA koşulu karşılamış sayılan ek biçimler (alıntıda koşul doğurmaz: "yaz" = "yazın" da olabilir, "istek" genel sözcük). */
const PART_ONLY_CONDITION_TOKENS: Readonly<Record<string, string>> = {
  yaz: "summer",
  kis: "winter",
  istek: "on_request",
  istegi: "on_request",
  isteginiz: "on_request",
};

/** Olumsuzluk belirteçleri (tam belirteç). "değil / yok / yasak / closed / not / nicht / pas …". */
const NEGATION_TOKENS: ReadonlySet<string> = new Set([
  "degil",
  "degildir",
  "yok",
  "yoktur",
  "yasak",
  "yasaktir",
  "yasaklanmistir",
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
  "isn",
  "aren",
  "don",
  "doesn",
  "won",
  "without",
  "prohibited",
  "forbidden",
  "nicht",
  "kein",
  "keine",
  "geschlossen",
  "verboten",
  "pas",
  "ferme",
  "interdit",
  "cerrado",
  "prohibido",
]);

/** Türkçe olumsuz fiil ekleri (katlanmış): "edilmiyor / izin verilmez / kabul edilmemektedir". */
function negativeVerb(t: string): boolean {
  return t.length > 5 && (/m[iu]yor$/.test(t) || /m[ae]z$/.test(t) || /m[ae]m[ae]kt[ae]d[iu]r$/.test(t));
}

function dayOrCondition(t: string, table: Readonly<Record<string, string>>): string | undefined {
  if (table[t]) return table[t];
  for (const b of baseForms(t)) if (table[b]) return table[b];
  return undefined;
}

function conditionClasses(tokens: readonly string[], side: "evidence" | "part"): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    // "hafta sonu" / "hafta içi" (iki belirteç); tek başına "hafta" koşul DEĞİL ("haftada bir").
    if (t === "hafta" && (next === "sonu" || next === "sonlari")) out.add("weekend");
    else if (t === "hafta" && (next === "ici" || next === "icinde")) out.add("weekday");
    // "Pazar" çarşı da demek ("semt pazarı") → yalnız "pazar günü / günleri" gün adıdır.
    else if ((t === "pazar" || t === "pazari" || t === "pazarlari") && next.startsWith("gun")) out.add("sun");
    else {
      const c = dayOrCondition(t, CONDITION_TOKENS) ?? (side === "part" ? PART_ONLY_CONDITION_TOKENS[t] : undefined);
      if (c) out.add(c);
    }
  }
  return out;
}

function negative(tokens: readonly string[]): boolean {
  // İngilizce "can't / don't / won't": kesme boşluğa döner ("can t") → "t" önündeki "-n" ile olumsuz.
  return tokens.some((t, i) => NEGATION_TOKENS.has(t) || negativeVerb(t) || (t === "t" && i > 0 && tokens[i - 1].endsWith("n")));
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
  /** `regionStart[gi]`: konu yerinin başladığı GRUP sırası (devralma dahil; kendisi ya da daha önceki bir grup). */
  regionStart: number[];
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
 * Konuyu DEVRETMEYE engel olmayan sözcükler: aralık / bağlaç / koşul / olumsuzluk sözcükleri + açılış-kapanış yüklemleri + 3 harften kısa
 * ekler.
 * Listede olmayan her içerik sözcüğü ("sauna", "misafirler") yabancı konu sayılır → devralma YOK (şüphede tut).
 */
const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  ...RANGE_WORDS,
  ...CLAUSE_WORDS,
  "hafta",
  "sonu",
  "sonlari",
  "ici",
  "icinde",
  "ise",
  "saat",
  "saatleri",
  "itibaren",
  "acik",
  "aciktir",
  "acilir",
  "kapali",
  "kapalidir",
  "kapanir",
  "the",
  "open",
  "opens",
  "closed",
  "closes",
  "close",
  "offen",
  "geschlossen",
  "schliesst",
  "veya",
  "or",
  "also",
]);

function isNeutralWord(w: string): boolean {
  // Olumsuzluk da yeni konu getirmez: "Otopark 3. katta değil, 2. katta" → 2. kat otoparkındır.
  return (
    w.length < 3 ||
    /^\d/.test(w) ||
    NEUTRAL_WORDS.has(w) ||
    NEGATION_TOKENS.has(w) ||
    negativeVerb(w) ||
    dayOrCondition(w, CONDITION_TOKENS) !== undefined
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

    // Konu yeri: önceki grubun bitişinden. Devralma — ardı (sonraki gruba / cümle sonuna kadar) nötr ve aradaki boşluklar nötr ise geri yürü.
    const gapNeutral = groups.map((g, gi) => (gi === 0 ? false : allNeutral(text, groups[gi - 1].end, g.at)));
    const reach: number[] = [];
    groups.forEach((_, gi) => reach.push(gi > 0 && gapNeutral[gi] ? reach[gi - 1] : gi));
    const regionStart = groups.map((g, gi) => {
      const afterNeutral = gi + 1 < groups.length ? gapNeutral[gi + 1] : allNeutral(text, g.end, e);
      return afterNeutral ? reach[gi] : gi;
    });
    return { s, e, groups, clauses, groupClause, valuedClause, regionStart };
  });
}

function hasSubject(region: string, terms: readonly string[], topics: readonly string[]): boolean {
  if (terms.length > 0 && needTermsInStrict(terms, region) > 0) return true;
  if (topics.length > 0 && topicsWithSymptomsOf(region).some((t) => topics.includes(t))) return true;
  return false;
}

// ─── ana kural ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface PlaceReading {
  conditions: Set<string>;
  negative: boolean;
}

function readPlace(text: string): PlaceReading {
  const t = tokenize(text);
  return { conditions: conditionClasses(t, "evidence"), negative: negative(t) };
}

export function checkAnswerBinding(input: BindingInput): BindingResult {
  const issues = new Set<BindingIssue>();
  const evidence = input.evidence.trim();
  if (!evidence) return { ok: false, issues: ["evidence_missing"] };
  if (!quoteGroundedIn(input.sourceText, evidence)) issues.add("evidence_not_in_source");
  const subjectKnown = input.needTerms.length > 0 || input.needTopics.length > 0;
  if (!subjectKnown) issues.add("subject_unknown");

  const ev = claimSpans(evidence);
  const sentences = structure(ev.text, ev.claims);
  const pt = claimSpans(input.part);
  const partTokens = tokenize(input.part);
  const partConditions = conditionClasses(partTokens, "part");
  const partNegative = negative(partTokens);
  const subjectIn = (s: string) => hasSubject(s, input.needTerms, input.needTopics);

  const checkPlace = (r: PlaceReading) => {
    for (const cls of r.conditions) if (!partConditions.has(cls)) issues.add("condition_dropped");
    if (r.negative !== partNegative) issues.add("polarity_mismatch");
  };

  // Cümle başına tembel tablolar (her biri bir kez hesaplanır → toplam doğrusal).
  const segSubjectPrefix = new Map<Sentence, number[]>();
  const clauseReading = new Map<string, PlaceReading>();
  const sentenceExtra = new Map<Sentence, PlaceReading>();
  const subjectPrefix = (sent: Sentence) => {
    let pre = segSubjectPrefix.get(sent);
    if (!pre) {
      pre = [0];
      sent.groups.forEach((g, gi) => {
        const from = gi > 0 ? sent.groups[gi - 1].end : sent.s;
        pre!.push(pre![gi] + (subjectIn(ev.text.slice(from, g.end)) ? 1 : 0));
      });
      segSubjectPrefix.set(sent, pre);
    }
    return pre;
  };
  const boundTo = (sent: Sentence, gi: number) => {
    const pre = subjectPrefix(sent);
    return pre[gi + 1] - pre[sent.regionStart[gi]] > 0;
  };
  const clausePlace = (sent: Sentence, ci: number) => {
    const key = `${sent.s}:${ci}`;
    let r = clauseReading.get(key);
    if (!r) {
      r = readPlace(ev.text.slice(sent.clauses[ci][0], sent.clauses[ci][1]));
      clauseReading.set(key, r);
    }
    return r;
  };
  // Aynı cümlenin değersiz ama konuyu anan yan cümleleri ("Havuz yalnız yazın açıktır, 09:00-20:00").
  const extraPlace = (sent: Sentence) => {
    let r = sentenceExtra.get(sent);
    if (!r) {
      const parts = sent.clauses
        .map((cl, ci) => ({ cl, ci }))
        .filter(({ cl, ci }) => !sent.valuedClause[ci] && subjectIn(ev.text.slice(cl[0], cl[1])))
        .map(({ ci }) => clausePlace(sent, ci));
      r = { conditions: new Set(parts.flatMap((p) => [...p.conditions])), negative: parts.some((p) => p.negative) };
      sentenceExtra.set(sent, r);
    }
    return r;
  };
  let wholeHasSubject: boolean | undefined;

  if (pt.claims.length > 0) {
    for (const c of pt.claims) {
      const hits: { sent: Sentence; gi: number }[] = [];
      for (const sent of sentences)
        sent.groups.forEach((g, gi) => {
          if (g.claims.some((e) => sameValue(c, e))) hits.push({ sent, gi });
        });
      if (hits.length === 0) {
        issues.add("value_not_in_evidence");
        continue;
      }
      if (!subjectKnown) continue;
      const bound = hits.find((h) => boundTo(h.sent, h.gi));
      if (!bound) {
        wholeHasSubject ??= subjectIn(ev.text);
        issues.add(wholeHasSubject ? "value_bound_elsewhere" : "subject_missing");
        continue;
      }
      // Koşul / olumluluk yeri: grubun yan cümlesi + aynı cümlenin değersiz ama konuyu anan yan cümleleri.
      const own = clausePlace(bound.sent, bound.sent.groupClause[bound.gi]);
      const extra = extraPlace(bound.sent);
      checkPlace({ conditions: new Set([...own.conditions, ...extra.conditions]), negative: own.negative || extra.negative });
    }
  } else if (subjectKnown) {
    // Değersiz parça: konunun geçtiği cümle(ler) dayanaktır.
    const subjectSentences = sentences.map((s) => ev.text.slice(s.s, s.e)).filter(subjectIn);
    if (subjectSentences.length === 0) issues.add("subject_missing");
    else checkPlace(readPlace(subjectSentences.join(" . ")));
  }
  const list = BINDING_ISSUES.filter((i) => issues.has(i));
  return { ok: list.length === 0, issues: list };
}

function sameValue(a: Span, b: Span): boolean {
  if (a.tkeys && b.tkeys) return a.tkeys.some((k) => b.tkeys!.includes(k));
  return a.keys.some((k) => b.keys.includes(k));
}
