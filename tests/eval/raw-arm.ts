// ---------------------------------------------------------------------------
// HAM MODEL KOLU — MEKANİK DENETİM (kurucu / Codex 11-12: "aynı girdide ham model kararıyla ürünün son kararını karşılaştır; doğru cevabın
// gereksiz tutulması da hata").
//
// Ham kol: aynı misafir mesajı + aynı notlarla, ürünün kapıları OLMADAN, kısa ve yansız bir istemle modelin kendi kararı. Model her istek
// için karar (cevapla / kaynak yok / ev sahibinin kararı) + dayandığı notun kimliği + nottan BİREBİR alıntı + sorulan varlık ↔ nottaki varlık
// + nottaki koşul sorulan durumu kapsıyor mu + misafire gidecek cümle beyan eder (`scripts/claude-work/run.ts` `raw_baseline`).
//
// Bu dosya o beyanı KANIT saymaz; yalnız kodun sınayabildiğini sınar (hiçbir sözcük / kök / eş anlam sözlüğü YOK):
//   · kimlik bu turun notlarından biri mi                         (`unknown_note`)
//   · alıntı o notta birebir geçiyor mu                           (`quote_not_in_note`)
//   · cümledeki her sayı / saat / tutar alıntıda var mı            (`value_not_in_quote`)
// ve modelin kendi yapısal beyanını uygular:
//   · "aynı varlık değil" dediyse o cümle gitmez                   (`entity_mismatch`)
//   · "koşul bu durumu kapsamıyor / bilinmiyor" dediyse gitmez     (`condition_not_covering`)
// Cevap, denetimden geçen cümlelerden kurulur (geçmeyen isteğin cümlesi düşer, öteki isteklerin cevabı gider).
//
// Bilinen sınır (bilerek): yazıyla sayı ("iki", "two"), sayı taşımayan yanlış değer ("ücretsiz" ↔ "ücretli") ve sayının ROLÜ (alıntıdaki
// "09:00–23:00"ten kapanış yerine açılış saatini söylemek; çıkış saatini havuz saati diye kullanmak) burada görülmez — bunlar alıntının
// cümleyi gerçekten destekleyip desteklemediği sorusudur ve bağımsız doğrulayıcının (ikinci model okuması) işidir.
// ---------------------------------------------------------------------------

export interface RawRequest {
  request_tr: string;
  decision: "answer" | "no_source" | "host_decides";
  entity_asked: string;
  entity_in_source: string;
  same_entity: "yes" | "no" | "n/a";
  attribute_asked: string;
  condition_in_source: string;
  condition_covers_question: "yes" | "no" | "unknown" | "n/a";
  evidence_note: string;
  evidence_quote: string;
  sentence: string;
  reason_tr: string;
}

export interface RawResult {
  requests: RawRequest[];
  reply: string;
  would_send: boolean;
}

export interface RawNote {
  category: string;
  title: string;
  content: string;
}

export type RawCheckIssue =
  | "not_answer"
  | "empty_sentence"
  | "unknown_note"
  | "quote_not_in_note"
  | "quote_too_short"
  | "value_not_in_quote"
  | "entity_mismatch"
  | "condition_not_covering";

/** Yalnız kodun sınayabildiği denetimler (modelin varlık / koşul beyanına bakmaz). */
export const MECHANICAL_ISSUES: readonly RawCheckIssue[] = ["not_answer", "empty_sentence", "unknown_note", "quote_not_in_note", "quote_too_short", "value_not_in_quote"];

/**
 * Alıntı bir BAĞLAM taşımalı: "." ya da "11" notta birebir geçer ama hiçbir cümleyi desteklemez (Haiku incelemesi 11-13 — tek karakterlik
 * alıntı denetimi geçiyordu). En az bu kadar karakter ve en az üç harflik bir sözcük; notun TAMAMINI veren alıntı kısa da olsa geçer.
 */
export const MIN_QUOTE_CHARS = 12;

/** Boşluk, tire ve tırnak biçimi farkı alıntıyı düşürmez; harf, sayı ve noktalama aynen kalır (büyük / küçük harf DAHİL). */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Metindeki bir sayı: ayraçla (nokta, virgül, iki nokta) bölünmüş rakam grupları — "09:00" → ["09", "00"], "1.500" → ["1", "500"], "150" → ["150"]. */
export interface NumberToken {
  groups: string[];
}

export function numberTokens(text: string): NumberToken[] {
  return [...text.matchAll(/\p{Nd}+(?:[.,:]\p{Nd}+)*/gu)].map((m) => ({ groups: m[0].split(/[.,:]/) }));
}

const stripZeros = (digits: string) => digits.replace(/^0+(?=\p{Nd})/u, "");

/** Yalnız rakam dizileri, ayraçsız ve baştaki sıfırlar atılmış (rapor / pin kolaylığı). */
export function numbersOf(text: string): string[] {
  return numberTokens(text).map((t) => stripZeros(t.groups.join("")));
}

/**
 * Aynı sayı mı? Yalnız şu yazım farkları sayıyı değiştirmez:
 *  (a) aynı gruplar, ayraç ya da baştaki sıfır farkı:           "09:00" ↔ "9.00", "1,5" ↔ "1.5";
 *  (b) biri ayraçsız, öteki binlik ayraçlı (sonraki her grup TAM üç rakam): "1500" ↔ "1.500";
 *  (c) biri ayraçsız, ötekinin tek ek grubu yalnız sıfır (en çok iki rakam): "23" ↔ "23:00", "900" ↔ "900,00".
 * Rakamları aynı olup sayısı başka olanlar ayrışır: "1,5" ≠ "15", "11:00" ≠ "1100", "10,05" ≠ "1.005", "1.000" ≠ "1".
 * Bilinen sınır: karışık yazım ("1.500,50" ↔ "1500.50") ve boşluklu binlik ("1 500") eşleşmez → cümle tutulur (güvenli yön).
 */
export function sameNumber(a: NumberToken, b: NumberToken): boolean {
  const A = a.groups;
  const B = b.groups;
  if (A.length === B.length) return stripZeros(A[0]) === stripZeros(B[0]) && A.slice(1).every((g, i) => g === B[i + 1]);
  const [single, multi] = A.length === 1 ? [A[0], B] : B.length === 1 ? [B[0], A] : [null, null];
  if (single === null || multi === null) return false;
  if (multi.slice(1).every((g) => g.length === 3) && stripZeros(multi.join("")) === stripZeros(single)) return true;
  return multi.length === 2 && multi[1].length <= 2 && /^0+$/.test(multi[1]) && stripZeros(multi[0]) === stripZeros(single);
}

/** Notun modele gösterildiği metin (kimlik hariç): "başlık: içerik". */
export function noteText(note: RawNote): string {
  return `${note.title}: ${note.content}`;
}

/** Kimliği ("N3", "[N3]", "n3", "PROPERTY") kaynak metnine çevirir; tanınmıyorsa null. */
export function sourceTextOf(evidenceNote: string, notes: readonly RawNote[], propertyJson: string): string | null {
  const trimmed = evidenceNote.trim();
  const id = /^\[.*\]$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
  if (/^property$/i.test(id)) return propertyJson;
  const m = /^N(\d{1,3})$/i.exec(id);
  if (!m) return null;
  const note = notes[Number(m[1]) - 1];
  return note ? noteText(note) : null;
}

/** Modelin "koşul yok" anlamında bıraktığı biçimsel boşluklar (anlam kararı değil; alanın boş olup olmadığı). */
const NO_CONDITION = /^(?:|-|\u2014|\u2013|n\/?a|none|no|yok|null)$/iu;

/** Bir isteğin denetimi: boş liste = cümle gidebilir. */
export function checkRequest(req: RawRequest, notes: readonly RawNote[], propertyJson: string): RawCheckIssue[] {
  if (req.decision !== "answer") return ["not_answer"];
  const issues: RawCheckIssue[] = [];
  if (req.sentence.trim() === "") issues.push("empty_sentence");
  const source = sourceTextOf(req.evidence_note, notes, propertyJson);
  if (source === null) issues.push("unknown_note");
  else {
    const quote = normalizeForQuote(req.evidence_quote);
    const whole = normalizeForQuote(source);
    if (quote === "" || !whole.includes(quote)) issues.push("quote_not_in_note");
    else {
      // Notun tamamı ("başlık: içerik") ya da içeriğin tamamı verilmişse uzunluk aranmaz.
      const content = whole.includes(": ") ? whole.slice(whole.indexOf(": ") + 2) : whole;
      const isWhole = quote === whole || quote === content;
      if (!isWhole && (quote.length < MIN_QUOTE_CHARS || !/\p{L}{3,}/u.test(quote))) issues.push("quote_too_short");
    }
  }
  const inQuote = numberTokens(req.evidence_quote);
  if (numberTokens(req.sentence).some((n) => !inQuote.some((q) => sameNumber(n, q)))) issues.push("value_not_in_quote");
  if (req.same_entity === "no") issues.push("entity_mismatch");
  // Notta bir koşul yazıyorsa cümle ancak model o koşulun soruyu kapsadığını AÇIKÇA söylediğinde gider ("n/a" yetmez).
  const hasCondition = !NO_CONDITION.test(req.condition_in_source.trim());
  if (req.condition_covers_question === "no" || req.condition_covers_question === "unknown" || (hasCondition && req.condition_covers_question !== "yes")) {
    issues.push("condition_not_covering");
  }
  return issues;
}

export type RawArm = "raw" | "mechanical" | "declared";

/**
 * Kolun misafire gidecek metni:
 *  · raw        — modelin kendi cevabı, hiçbir denetim yok (gönderme dediyse boş);
 *  · mechanical — yalnız kodun sınayabildiği denetimlerden geçen cümleler;
 *  · declared   — ek olarak modelin varlık / koşul beyanı uygulanır.
 * Denetimli kollarda cevap onaylı cümlelerden kurulur; hiçbiri geçmediyse null (tur ev sahibinde kalır).
 */
export function armText(result: RawResult, arm: RawArm, notes: readonly RawNote[], propertyJson: string): string | null {
  if (arm === "raw") return result.would_send && result.reply.trim() !== "" ? result.reply : null;
  const kept = result.requests.filter((r) => {
    const issues = checkRequest(r, notes, propertyJson);
    return arm === "mechanical" ? !issues.some((i) => MECHANICAL_ISSUES.includes(i)) : issues.length === 0;
  });
  const text = [...new Set(kept.map((r) => r.sentence.trim()).filter(Boolean))].join(" ");
  return text === "" ? null : text;
}

/** Ham çıktının biçimi beklenen mi (şema dışı satır ölçüme girmez, ayrı sayılır). */
export function isRawResult(value: unknown): value is RawResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.requests) || typeof v.reply !== "string" || typeof v.would_send !== "boolean") return false;
  return v.requests.every((r) => {
    if (!r || typeof r !== "object") return false;
    const q = r as Record<string, unknown>;
    return (
      ["request_tr", "entity_asked", "entity_in_source", "attribute_asked", "condition_in_source", "evidence_note", "evidence_quote", "sentence", "reason_tr"].every((k) => typeof q[k] === "string") &&
      ["answer", "no_source", "host_decides"].includes(q.decision as string) &&
      ["yes", "no", "n/a"].includes(q.same_entity as string) &&
      ["yes", "no", "unknown", "n/a"].includes(q.condition_covers_question as string)
    );
  });
}
