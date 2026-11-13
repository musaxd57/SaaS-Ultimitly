import { AUTO_PROMOTION_MIN_DECISIONS, AUTO_PROMOTION_MIN_RATE, AUTO_PROMOTION_WINDOW_DAYS } from "@/lib/ai-suggestions/core";

// ---------------------------------------------------------------------------
// TASLAK ↔ GÖNDERİLEN METİN BAĞI — SAF ÇEKİRDEK (kurucu 11-13: "embedding yapılarak asıl metin farkı incelenerek dahi tutulsun, buraya ML
// ekle"; tasarım docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md). Veritabanı / ağ YOK; deterministik.
//  · Gerçek metin farkı: belirteç düzeyinde en uzun ortak alt dizi (sınırlı girdi), değer değişimi, cümle silme, bilgi ekleme.
//  · Sınıf: ham sayılardan türetilir, SÜRÜMLÜDÜR (`CLASSIFIER_VERSION`) — eşik değişince geçmiş yeniden sınıflandırılır, yeniden ölçülmez.
//  · Öğrenme: tekrar eden ekleme madenciliği (anlam vektörü ya da belirteç benzerliğiyle açgözlü kümeleme), konu başına kabul istatistiği,
//    işletmeler arası yalnız SAYI.
// 🚨 Misafir / ev sahibi metnine uygulanan kalıplarda karesel iş YOK (CLAUDE.md ReDoS kuralı): belirteçleme tek geçişli `matchAll`, en uzun ortak
// alt dizi `DIFF_TOKEN_CAP` ile sınırlı (süre pini `tests/unit/reply-draft-core-cost.test.ts`).
// ---------------------------------------------------------------------------

export const CLASSIFIER_VERSION = 1;
/** En uzun ortak alt dizi her iki metinde en çok bu kadar belirteçle hesaplanır (fazlası kesilir, `truncated` işaretlenir). */
export const DIFF_TOKEN_CAP = 600;

export type DraftUse = "approved" | "seeded";
export type DraftLinkKind = DraftUse | "implicit";
export type DraftOutcome = "unchanged" | "minor_edit" | "major_edit" | "rewritten";
export type EditKind = "tone" | "added_info" | "corrected_value" | "removed_sentence" | "rewrite";

export const OUTCOME_THRESHOLDS = {
  minorLexical: 0.85,
  minorSemantic: 0.9,
  minorMaxAddedRun: 6,
  rewriteLexical: 0.35,
  rewriteSemantic: 0.8,
  removedSentenceOverlap: 0.3,
  addedInfoMinContent: 3,
} as const;

interface Token {
  t: string;
  value: boolean;
}

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}⠀]/gu;
// Değer belirteçleri ÖNCE: bağlantı · e-posta · saat (14:00 / 14.00) · sayı (1.250,50 dahil) · harf/rakam dizisi. Her seçenek ya sabit bir başla
// (http, rakam) ya da tek sınıfla başlar; iç içe niceleyici yalnız ayraç ZORUNLU olan grupta → doğrusal.
const TOKEN_RE = /https?:\/\/[^\s]{1,300}|[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]{1,253}\.[\p{L}]{2,24}|\d{1,2}[:.]\d{2}(?!\d)|\d+(?:[.,]\d+)*|[\p{L}\p{N}]+/gu;
/** Gün ve ay adları da DEĞERDİR ("cuma" → "cumartesi" bir olgu düzeltmesidir). Kapalı küme, yalnız ölçüm için (karar vermez). */
const CALENDAR_WORDS = new Set([
  "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar",
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
]);

/** Karşılaştırma için normal biçim: NFKC, görünmez karakter yok, Türkçe küçük harf, boşluklar teke iner. */
export function normalizeForDiff(s: string): string {
  return s.normalize("NFKC").replace(INVISIBLE, "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

export function tokenize(normalized: string): Token[] {
  const out: Token[] = [];
  for (const m of normalized.matchAll(TOKEN_RE)) {
    const t = m[0];
    // RAKAM TAŞIYAN her belirteç değerdir (Haiku 11-13): "lale2024" → "lale2025" bir Wi-Fi şifresi / kapı kodu düzeltmesidir; yalnız rakamla
    // başlayanı saymak bunu "üslup" sayıp temiz onaya yazıyordu.
    out.push({ t, value: /\p{Nd}/u.test(t) || t.startsWith("http") || t.includes("@") || CALENDAR_WORDS.has(t) });
  }
  return out;
}

/** İçerik belirteci: değer ya da en az 3 harflik sözcük (bağlaç / ek kırıntısı sayılmaz). */
function isContent(tok: Token): boolean {
  return tok.value || [...tok.t].length >= 3;
}

/** Belirteç dizileri arasında en uzun ortak alt dizi → her iki taraftaki eşleşmiş konumlar (sınırlı girdi; O(n·m), n,m ≤ DIFF_TOKEN_CAP). */
function lcsMatches(a: readonly string[], b: readonly string[]): { inA: boolean[]; inB: boolean[]; length: number } {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const inA = new Array<boolean>(n).fill(false);
  const inB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      inA[i] = true;
      inB[j] = true;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return { inA, inB, length: dp[0] };
}

/** Eşleşmemiş ardışık belirteç dizileri (eklenen / çıkarılan parçalar). */
function runsOf(tokens: readonly Token[], matched: readonly boolean[]): Token[][] {
  const runs: Token[][] = [];
  let cur: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (matched[k]) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(tokens[k]);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function multiset(tokens: readonly Token[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t.t, (m.get(t.t) ?? 0) + 1);
  return m;
}

function sameMultiset(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Taslağın cümleleri (özgün metinden; nokta / ünlem / soru / üç nokta + boşluk ya da satır sonu). Ayrılan sınıflar örtüşmez → doğrusal. */
function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?…]+\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DraftDiff {
  /** Normalleştirilmiş iki metin birebir aynı. */
  identical: boolean;
  /** 2·LCS / (|taslak| + |gönderilen|), belirteç düzeyinde; ikisi de boşsa 1. */
  lexicalSim: number;
  tokensAdded: number;
  tokensRemoved: number;
  /** Saat / tarih / sayı / tutar / bağlantı / e-posta / gün-ay adı kümesi farklı. */
  valueChanged: boolean;
  /** Taslağın en az bir cümlesi gönderilende neredeyse hiç geçmiyor. */
  removedSentence: boolean;
  /** En uzun eklenen ardışık dizi (belirteç). */
  maxAddedRun: number;
  /** Eklenen parçalar (normalleştirilmiş metin, en az `addedInfoMinContent` içerik belirteçli olanlar) — öğrenme için. */
  addedSpans: { text: string; contentTokens: number }[];
  /** Çıkarılan parçalar (normalleştirilmiş metin). */
  removedSpans: string[];
  /** Girdi `DIFF_TOKEN_CAP`'i aştı; fark ilk belirteçlerle hesaplandı. */
  truncated: boolean;
}

export function diffDraft(draft: string, sent: string): DraftDiff {
  const nd = normalizeForDiff(draft);
  const ns = normalizeForDiff(sent);
  const allD = tokenize(nd);
  const allS = tokenize(ns);
  const truncated = allD.length > DIFF_TOKEN_CAP || allS.length > DIFF_TOKEN_CAP;
  const d = allD.slice(0, DIFF_TOKEN_CAP);
  const s = allS.slice(0, DIFF_TOKEN_CAP);
  const { inA, inB, length } = lcsMatches(
    d.map((x) => x.t),
    s.map((x) => x.t),
  );
  const total = d.length + s.length;
  const lexicalSim = total === 0 ? 1 : (2 * length) / total;
  const added = runsOf(s, inB);
  const removed = runsOf(d, inA);
  const valueChanged = !sameMultiset(multiset(allD.filter((x) => x.value)), multiset(allS.filter((x) => x.value)));
  const sentBag = multiset(allS);
  // Cümle başına iş cümlenin KENDİ boyuyla sınırlı (gönderilen metnin sayacı kopyalanmaz — kopya cümle sayısı × metin boyu, karesel olurdu):
  // örtüşme = Σ min(cümledeki sayı, gönderilendeki sayı).
  const removedSentence = sentencesOf(draft).some((sentence) => {
    const toks = tokenize(normalizeForDiff(sentence)).filter(isContent);
    if (toks.length < 3) return false;
    let hit = 0;
    for (const [t, c] of multiset(toks)) hit += Math.min(c, sentBag.get(t) ?? 0);
    return hit / toks.length < OUTCOME_THRESHOLDS.removedSentenceOverlap;
  });
  return {
    identical: nd === ns,
    lexicalSim,
    tokensAdded: s.length - length,
    tokensRemoved: d.length - length,
    valueChanged,
    removedSentence,
    maxAddedRun: added.reduce((mx, r) => Math.max(mx, r.length), 0),
    addedSpans: added
      .map((r) => ({ text: r.map((x) => x.t).join(" "), contentTokens: r.filter(isContent).length }))
      .filter((r) => r.contentTokens >= OUTCOME_THRESHOLDS.addedInfoMinContent),
    removedSpans: removed.map((r) => r.map((x) => x.t).join(" ")),
    truncated,
  };
}

/** Sınıfın girdisi = SAKLANAN ham sayılar (eşik değişince geçmiş, metne yeniden bakmadan yeniden sınıflandırılır). */
export interface OutcomeInput {
  identical: boolean;
  /** Fark ilk `DIFF_TOKEN_CAP` belirteçle hesaplandı — kesilen kısımda ne değiştiği bilinmez, "küçük düzeltme" denmez (Haiku 11-13). */
  truncated: boolean;
  lexicalSim: number;
  valueChanged: boolean;
  removedSentence: boolean;
  maxAddedRun: number;
  addedSpanCount: number;
}

export function outcomeInputOf(diff: DraftDiff): OutcomeInput {
  return {
    identical: diff.identical,
    truncated: diff.truncated,
    lexicalSim: diff.lexicalSim,
    valueChanged: diff.valueChanged,
    removedSentence: diff.removedSentence,
    maxAddedRun: diff.maxAddedRun,
    addedSpanCount: diff.addedSpans.length,
  };
}

/**
 * Sonuç sınıfı (sürüm 1). Anlam benzerliği (`semanticSim`) ölçülmediyse `null` — kural yalnız metin farkıyla karar verir; ölçülünce yeniden
 * çağrılır. Değer değişimi hiçbir zaman "küçük düzeltme" değildir (modelin en tehlikeli hatası bir olguyu yanlış yazmasıdır).
 */
export function classifyOutcome(diff: OutcomeInput, semanticSim: number | null): DraftOutcome {
  if (diff.identical) return "unchanged";
  const T = OUTCOME_THRESHOLDS;
  const lowSemantic = semanticSim === null || semanticSim < T.rewriteSemantic;
  if (diff.lexicalSim < T.rewriteLexical && lowSemantic) return "rewritten";
  if (
    !diff.truncated &&
    !diff.valueChanged &&
    !diff.removedSentence &&
    diff.lexicalSim >= T.minorLexical &&
    diff.maxAddedRun < T.minorMaxAddedRun &&
    (semanticSim === null || semanticSim >= T.minorSemantic)
  ) {
    return "minor_edit";
  }
  return "major_edit";
}

export function editKindsOf(diff: OutcomeInput, outcome: DraftOutcome): EditKind[] {
  if (outcome === "unchanged") return [];
  if (outcome === "rewritten") return ["rewrite"];
  const kinds: EditKind[] = [];
  if (diff.valueChanged) kinds.push("corrected_value");
  if (diff.removedSentence) kinds.push("removed_sentence");
  if (diff.addedSpanCount > 0) kinds.push("added_info");
  if (kinds.length === 0) kinds.push("tone");
  return kinds;
}

/** "Temiz onay" — özerklik teklifinin tek ölçüsü: değiştirilmeden ya da yalnız üslup düzeltmesiyle gönderildi. */
export function isCleanApproval(outcome: DraftOutcome, kinds: readonly EditKind[]): boolean {
  return outcome === "unchanged" || (outcome === "minor_edit" && kinds.every((k) => k === "tone"));
}

// ── Öğrenme ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AcceptanceRow {
  intent: string | null;
  outcome: DraftOutcome;
  kinds: readonly EditKind[];
  at: Date;
}

/**
 * Konu (niyet) başına kabul: son `AUTO_PROMOTION_WINDOW_DAYS` günde karar sayısı, temiz onay sayısı, oran, hazır mı — eylem önerilerinin
 * `promotionReadiness` ölçütüyle AYNI eşikler (kurucu 10-12 "2 hafta ≥ %90"). Niyeti olmayan satır "general" sayılır.
 */
export function draftAcceptance(rows: readonly AcceptanceRow[], now: Date): Map<string, { decided: number; clean: number; rate: number; ready: boolean }> {
  const since = now.getTime() - AUTO_PROMOTION_WINDOW_DAYS * 86_400_000;
  const acc = new Map<string, { decided: number; clean: number }>();
  for (const r of rows) {
    const t = r.at.getTime();
    if (t < since || t > now.getTime()) continue;
    const key = r.intent || "general";
    const cur = acc.get(key) ?? { decided: 0, clean: 0 };
    cur.decided++;
    if (isCleanApproval(r.outcome, r.kinds)) cur.clean++;
    acc.set(key, cur);
  }
  const out = new Map<string, { decided: number; clean: number; rate: number; ready: boolean }>();
  for (const [k, v] of acc) {
    const rate = v.clean / v.decided;
    out.set(k, { ...v, rate, ready: v.decided >= AUTO_PROMOTION_MIN_DECISIONS && rate >= AUTO_PROMOTION_MIN_RATE });
  }
  return out;
}

export interface SpanForMining {
  id: string;
  propertyId: string | null;
  conversationId: string;
  text: string;
  /** Birim vektör (anlam); yoksa belirteç benzerliği kullanılır. */
  vector: readonly number[] | Float32Array | null;
  /** Metin maskelenirken sır bulundu — asla aday olmaz. */
  hasSecret: boolean;
  at: Date;
}

export interface AdditionCandidate {
  propertyId: string | null;
  text: string;
  conversations: number;
  spanIds: string[];
}

export const MINING = { windowDays: 30, minConversations: 3, cosine: 0.86, jaccard: 0.6 } as const;
/** Kümenin temsilcisi bu kadar en yeni üye arasından seçilir (iş küme boyuyla sınırlı). */
const MEDOID_SAMPLE = 50;

function cosine(a: readonly number[] | Float32Array, b: readonly number[] | Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
  return dot;
}

function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a).filter(isContent).map((x) => x.t));
  const B = new Set(tokenize(b).filter(isContent).map((x) => x.t));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function similar(x: SpanForMining, y: SpanForMining): boolean {
  if (x.vector && y.vector && x.vector.length === y.vector.length) return cosine(x.vector, y.vector) >= MINING.cosine;
  return jaccard(x.text, y.text) >= MINING.jaccard;
}

/**
 * Tekrar eden ekleme madenciliği (düzeltmeden öğrenme): AYNI dairede, pencere içinde, anlamca aynı eklemeyi en az `minConversations` FARKLI
 * konuşmada yapmış ev sahibi → bilgi tabanı adayı. Açgözlü kümeleme (eskiden yeniye; her parça temsilcisine benzeyen ilk kümeye), temsilci
 * metin = kümenin en çok üyesine benzeyen üyesi (eşitlikte en yeni). Sır taşıyan parça kümeye hiç girmez. Deterministik.
 */
export function mineRecurringAdditions(spans: readonly SpanForMining[], now: Date): AdditionCandidate[] {
  const since = now.getTime() - MINING.windowDays * 86_400_000;
  const pool = spans
    .filter((s) => !s.hasSecret && s.at.getTime() >= since && s.at.getTime() <= now.getTime())
    .slice()
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  const clusters: SpanForMining[][] = [];
  for (const s of pool) {
    const home = clusters.find((c) => c[0].propertyId === s.propertyId && similar(c[0], s));
    if (home) home.push(s);
    else clusters.push([s]);
  }
  const out: AdditionCandidate[] = [];
  for (const c of clusters) {
    const conversations = new Set(c.map((s) => s.conversationId)).size;
    if (conversations < MINING.minConversations) continue;
    // Temsilci yalnız EN YENİ `MEDOID_SAMPLE` üye arasından seçilir: tüm küme üzerinde ikili kıyas küme boyunun karesiyle büyürdü (Haiku 11-13).
    const sample = c.slice(-MEDOID_SAMPLE);
    let best = sample[0];
    let bestScore = -1;
    for (const s of sample) {
      const score = sample.filter((o) => o !== s && similar(s, o)).length;
      if (score > bestScore || (score === bestScore && s.at.getTime() >= best.at.getTime())) {
        best = s;
        bestScore = score;
      }
    }
    out.push({ propertyId: c[0].propertyId, text: best.text, conversations, spanIds: c.map((s) => s.id) });
  }
  return out;
}

/** İşletmeler arası (platform) sayım: yalnız niyet × sonuç sayıları; en az `minOrgs` işletme yoksa `null` (küçük kümede işletme tanınır). */
export function platformOutcomeCounts(
  rows: readonly { organizationId: string; intent: string | null; outcome: DraftOutcome }[],
  minOrgs = 5,
): Map<string, Record<DraftOutcome, number>> | null {
  if (new Set(rows.map((r) => r.organizationId)).size < minOrgs) return null;
  const out = new Map<string, Record<DraftOutcome, number>>();
  for (const r of rows) {
    const key = r.intent || "general";
    const cur = out.get(key) ?? { unchanged: 0, minor_edit: 0, major_edit: 0, rewritten: 0 };
    cur[r.outcome]++;
    out.set(key, cur);
  }
  return out;
}
