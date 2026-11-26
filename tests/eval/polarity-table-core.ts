/* ---------------------------------------------------------------------------
 * OLUMLULUK ("var / yok") TABLOSU — ortak çekirdek (26 Kasım, kurucu S-2: "önce kontrol et").
 *
 * Test dosyası DEĞİL. İki ölçer kullanır:
 *   · `tests/eval/polarity-table-replay.ts`  — ÜCRETSİZ, model yok: ürünün bugünkü kod denetimi + "yalnız emin olduğunda tut" adayları.
 *   · `tests/eval/part-reader-strength.ts`   — ÜCRETLİ: aynı satırları ürünün parça okuyucusuna okutur.
 *
 * Ürün kodu DEĞİŞMEZ. Bugünkü hâl ürünün KENDİ işleviyle ölçülür: `composeVerifiedReply` (`meaningJudge: "reader"` — parça kipinde
 * okuyucu koşarken kodda kalan denetimler, `CODE_KEPT_ISSUES`). İhtiyacın sözcükleri / konuları ürünün kendi işlevleriyle kurulur
 * (`needTerms`, `requestTopics`; sorgular [Türkçe arama sorgusu, özgün dildeki sorgu] — `conversation-items/extract.ts` düzeni).
 * Doğrulama: üç parça koşusundaki 27 `polarity_mismatch` reddi bu kurulumla birebir yeniden üretildi (sorun + danışma bulguları dahil).
 *
 * Adaylar ürünü DEĞİŞTİRMEZ: ürünün hükmünü sarar. Ürün `polarity_mismatch` ile tuttuysa aday "kod bundan emin mi" diye bakar; emin
 * değilse olumluluk bulgusu tutmaz (karar okuyucuya kalır), başka kodda kalan bulgu varsa yine tutar. Olumluluk ürünün kendi
 * okumasıyla (`partSignature(…).negative`) yan cümle / cümle başına okunur; dil ürünün `confidentLanguage` işleviyle.
 * ------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import path from "node:path";
import { composeVerifiedReply, groundEvidence, type PartSource } from "../../src/lib/ai/answer-parts";
import { missesAskedFacility, partSignature } from "../../src/lib/ai/answer-binding";
import { confidentLanguage } from "../../src/lib/ai/language-signal";
import { needTerms } from "../../src/lib/conversation-items/topic-absence";
import { requestTopics } from "../../src/lib/conversation-items/relation";
import { kbLine } from "../../src/lib/ai/retrieval/kb-line";
import type { ItemKind } from "../../src/lib/conversation-items/core";

export const REPO = path.resolve(__dirname, "..", "..");
export const TABLE_PATH = path.join(REPO, "evals", "olumluluk-tablosu.json");

export interface KbItem {
  category: string;
  title: string;
  content: string;
}
export interface TableRow {
  id: string;
  group: "a" | "b" | "c";
  origin: string;
  kbSet: string;
  guestMessage: string;
  request: { intent: string; query_tr: string; query_original: string };
  part: string;
  evidence: string;
  partLang: string;
  kbLang: string;
  expect: "gecir" | "tut";
  label: string;
  reason: string;
  form: string;
  observedIssues?: string[];
  observedAdvisory?: string[];
}
export interface Table {
  kbSets: Record<string, KbItem[]>;
  rows: TableRow[];
}

export function loadTable(file = TABLE_PATH): Table {
  return JSON.parse(readFileSync(file, "utf8")) as Table;
}

export function sourcesOf(table: Table, kbSet: string): PartSource[] {
  const items = table.kbSets[kbSet];
  if (!items) throw new Error(`bilinmeyen bilgi tabanı: ${kbSet}`);
  return items.map((k, i) => ({ id: `kb:${i + 1}`, text: kbLine(k) }));
}

export function needOf(row: Pick<TableRow, "request">) {
  const q = row.request;
  const queries = [q.query_tr, q.query_original].filter((x, i, a) => x && a.indexOf(x) === i);
  return { ref: "R1", terms: needTerms(queries), topics: requestTopics(q.query_tr, "", q.intent as ItemKind), queries };
}

export interface CodeVerdict {
  /** Kodun bugünkü hükmü (okuyucu kipi): tutuyor mu. */
  held: boolean;
  /** Kodda kalan (tutan) bulgular. */
  issues: string[];
  advisory: string[];
}

export function productVerdict(table: Table, row: TableRow): CodeVerdict {
  const v = composeVerifiedReply({
    parts: [{ ref: "R1", status: "answered", text: row.part, evidence: row.evidence }],
    needs: [needOf(row)],
    sources: sourcesOf(table, row.kbSet),
    meaningJudge: "reader",
  }).verdicts[0];
  if (v.status === "verified") return { held: false, issues: [], advisory: [...(v.advisory ?? [])] };
  return { held: true, issues: [...(v.issues ?? [])], advisory: [...((v as { advisory?: string[] }).advisory ?? [])] };
}

// ─── adaylar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Kalem satırının içeriği ("- [KATEGORİ] Başlık: içerik" → içerik). */
function contentOf(line: string): string {
  const close = line.indexOf("] ");
  const colon = close >= 0 ? line.indexOf(": ", close) : -1;
  return colon >= 0 ? line.slice(colon + 2) : line;
}

/** Cümleler (nokta / ünlem / soru / noktalı virgül). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?;؟]+(?:\s|$)|;/u)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
}
/** Yan cümleler: cümleler + virgül. */
export function clausesOf(text: string): string[] {
  return sentencesOf(text)
    .flatMap((s) => s.split(/[,،]/u))
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
}
/** Parçaların olumluluk kümesi (ürünün olumsuzluk okuması). */
function polarities(pieces: readonly string[]): Set<boolean> {
  return new Set(pieces.map((p) => partSignature(p).negative));
}

export interface CandidateFeatures {
  kbContent: string;
  partSentencePol: boolean[];
  kbSentencePol: boolean[];
  partClausePol: boolean[];
  kbClausePol: boolean[];
  partLang: string | null;
  kbLang: string | null;
}

export function featuresOf(table: Table, row: TableRow): CandidateFeatures {
  const g = groundEvidence(sourcesOf(table, row.kbSet), row.evidence);
  const kbContent = g ? contentOf(g.source.text) : row.evidence;
  return {
    kbContent,
    partSentencePol: [...polarities(sentencesOf(row.part))],
    kbSentencePol: [...polarities(sentencesOf(kbContent))],
    partClausePol: [...polarities(clausesOf(row.part))],
    kbClausePol: [...polarities(clausesOf(kbContent))],
    partLang: confidentLanguage(row.part),
    kbLang: confidentLanguage(kbContent),
  };
}

/** Tek yönlü ve iki tarafın yönü farklı: kodun "ters" dediği şey yapısal olarak kesin. */
const oneWayOpposite = (a: boolean[], b: boolean[]) => a.length === 1 && b.length === 1 && a[0] !== b[0];

export const CANDIDATES = {
  /** Bugünkü ürün (sarmalayıcı yok). */
  bugun: () => true,
  /** A1: iki taraf da CÜMLE düzeyinde tek yönlü ve yönleri ters. */
  A1_cumle_tek_yon: (f: CandidateFeatures) => oneWayOpposite(f.partSentencePol, f.kbSentencePol),
  /** A2: iki taraf da YAN CÜMLE (virgül dahil) düzeyinde tek yönlü ve yönleri ters (en dar "emin"). */
  A2_yan_cumle_tek_yon: (f: CandidateFeatures) => oneWayOpposite(f.partClausePol, f.kbClausePol),
  /** A3: A1 + iki taraf da AYNI tanınan dilde (diller arası her karar okuyucuya). */
  A3_cumle_tek_yon_ayni_dil: (f: CandidateFeatures) =>
    oneWayOpposite(f.partSentencePol, f.kbSentencePol) && f.partLang !== null && f.partLang === f.kbLang,
  /** A4: yalnız KALEM karışıksa (cümle düzeyinde iki yön) okuyucuya; kalem tek yönlüyse bugünkü kural. */
  A4_kalem_tek_yonluyse: (f: CandidateFeatures) => f.kbSentencePol.length === 1,
} as const satisfies Record<string, (f: CandidateFeatures) => boolean>;
export type CandidateName = keyof typeof CANDIDATES;

/**
 * Adayla kodun hükmü: olumluluk bulgusu yalnız aday "emin" derse tutar; kodda kalan öteki bulgular aynen tutar. Olumluluk bulgusu kalkınca
 * ürün bir sonraki adımda okuyucu kipinde de kodda kalan kapsam denetimini (`subject_partial` — istek iki tesis adlandırıyor, parça birini
 * hiç anmıyor) koşardı; aynı ürün işleviyle (`missesAskedFacility`) burada da koşulur.
 */
export function candidateVerdict(row: Pick<TableRow, "part" | "request">, v: CodeVerdict, sure: boolean): CodeVerdict {
  if (!v.held || !v.issues.includes("polarity_mismatch") || sure) return v;
  const issues = v.issues.filter((i) => i !== "polarity_mismatch");
  if (issues.length === 0 && missesAskedFacility(row.part, needOf(row).queries)) issues.push("subject_partial");
  return { held: issues.length > 0, issues, advisory: v.advisory };
}

/** Satır sınıfı: beklenen ↔ kodun hükmü. */
export function outcomeOf(row: Pick<TableRow, "expect">, v: CodeVerdict): "dogru_tutma" | "haksiz_tutma" | "kacirma" | "dogru_gecirme" {
  if (row.expect === "tut") return v.held ? "dogru_tutma" : "kacirma";
  return v.held ? "haksiz_tutma" : "dogru_gecirme";
}
