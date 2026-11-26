// ---------------------------------------------------------------------------
// L4 (kurucu 10-17: "ev sahibi taslağı az değiştirip gönderdiyse değiştirdiği yerleri o daire için öğrensin (%40'tan az değişim)") —
// yapay zekâ taslağı ↔ ev sahibinin GÖNDERDİĞİ metin farkı. SAF + LLM'siz; metin üzerinde KALIP ARAMASI YOK (yalnız tek karakter / tek belirteç
// sınıf testi; doğrusal belirteçleyici + tavanlı en uzun ortak alt dizi) → karesel iş sınıfı dışında (CLAUDE.md ReDoS kuralı; süre pinli
// `host-history-attribution-cost.test.ts`). ÇAĞIRANI YOK (Dilim 0): taslak ↔ mesaj bağı
// (migration) ve neyin öğrenileceği kurucu sorusu (SORU 4, `docs/TASARIM-2026-10-17-l1-l4-gecmis-cevaplar-ve-duzenleme-farki.md` §5, §7).
//
// Ölçü: belirteç = harf / rakam dizisi (Türkçe küçük harf + ASCII katlama ile karşılaştırılır — yalnız büyük-küçük harf, noktalama ya da
// "ı/i ş/s" farkı DEĞİŞİKLİK DEĞİL); "11:00" tek belirteç. Değişiklik ağırlığı = her ardışık farklı parçada max(silinen, eklenen) belirteç
// (bir değer değişimi "11:00 → 12:00" 1 sayılır); oran = ağırlık / max(taslak, gönderilen). Sınıf: `unchanged` (0) · `light` (< 0,40, kurucu
// eşiği — düzeltme) · `rewrite` (≥ 0,40 — ev sahibinin kendi cevabı). Tavanı aşan metinde fark ÇIKARILMAZ (yalnız torba ölçüsüyle sınıf).
// 🚨 Temel ilke (Codex ilke 2'nin cümle düzeyi): taslaktan AYNEN kalan cümle HİÇBİR sınıfta ev sahibi kanıtı değildir; yalnız ev sahibinin
// İÇERİK olarak dokunduğu ya da eklediği cümle (`hostSentences`). Yalnız selam / kapanış değişikliği cümleyi "dokunulmuş" yapmaz.
// ---------------------------------------------------------------------------
import { foldTurkishAscii } from "@/lib/ai/fallback";

/** Kurucu eşiği (10-17): bu orandan AZ değişim düzeltmedir. */
export const EDIT_LIGHT_MAX_RATIO = 0.4;
/** Taraf başına belirteç tavanı (fark tablosu ≤ 400 × 400). */
export const MAX_DIFF_TOKENS = 400;
/** Ekleme / silme parçasının "içerik" sayılması için en az sözcük. */
const CONTENT_MIN_WORDS = 3;

export interface Token {
  text: string;
  folded: string;
  kind: "word" | "time" | "number";
  sentence: number;
}

export type EditClass = "unchanged" | "light" | "rewrite";
export type EditPartKind = "value_fix" | "insertion" | "deletion" | "style" | "moved" | "other";

export interface EditPart {
  op: "replace" | "insert" | "delete";
  kind: EditPartKind;
  from: string;
  to: string;
}

export interface EditAttribution {
  class: EditClass;
  ratio: number;
  capped: boolean;
  /** Ardışık farklı parçalar (tavan aşılınca boş). */
  parts: EditPart[];
  /** Gönderilen metnin ev sahibinin İÇERİK olarak dokunduğu / eklediği cümleleri (taslaktan aynen kalan cümle ASLA). */
  hostSentences: string[];
}

const isDigit = (c: string) => c >= "0" && c <= "9";
const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

/** Cümle sınırları (doğrusal): . ! ? ya da satır sonu; noktadan sonra boşluk / metin sonu gelmezse ("1.5", "lixusai.com") sınır değil. */
export function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const boundary = c === "\n" || ((c === "." || c === "!" || c === "?") && (i + 1 >= text.length || /\s/u.test(text[i + 1]!)));
    if (boundary) {
      const s = text.slice(start, i + 1).trim();
      if (s) out.push({ text: s, start, end: i + 1 });
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push({ text: tail, start, end: text.length });
  return out;
}

/** Doğrusal belirteçleyici: harf / rakam dizileri; "11:00" / "9.30" saat tek belirteç; her belirteç cümle sırasını taşır. */
export function tokenize(text: string): Token[] {
  const sentences = splitSentences(text);
  const out: Token[] = [];
  sentences.forEach((s, si) => {
    const src = text.slice(s.start, s.end);
    let i = 0;
    while (i < src.length) {
      if (!isWordChar(src[i]!)) {
        i++;
        continue;
      }
      let j = i;
      while (j < src.length && isWordChar(src[j]!)) j++;
      let tok = src.slice(i, j);
      let kind: Token["kind"] = /^\d+$/u.test(tok) ? "number" : "word";
      // Saat: 1-2 rakam + ":" / "." + tam 2 rakam (11:00, 9.30) — tek belirteç.
      if (kind === "number" && tok.length <= 2 && (src[j] === ":" || src[j] === ".") && isDigit(src[j + 1] ?? "") && isDigit(src[j + 2] ?? "") && !isDigit(src[j + 3] ?? "")) {
        tok = `${tok}:${src.slice(j + 1, j + 3)}`;
        kind = "time";
        j += 3;
      }
      out.push({ text: tok, folded: foldTurkishAscii(tok.toLocaleLowerCase("tr")), kind, sentence: si });
      i = j;
    }
  });
  return out;
}

/** Selam / kapanış / nezaket sözcükleri (kapalı küme, katlanmış) — yalnız bunlardan oluşan parça "style". */
const STYLE_WORDS: ReadonlySet<string> = new Set([
  "merhaba", "merhabalar", "selam", "selamlar", "iyi", "gunler", "aksamlar", "geceler", "yolculuklar", "tatiller", "dileriz", "dilerim",
  "tesekkurler", "tesekkur", "ederiz", "ederim", "rica", "saygilar", "saygilarimla", "sevgiler", "sevgiyle", "hos", "geldiniz", "kolay", "gelsin",
  "sayin", "degerli", "misafirimiz", "lutfen", "hi", "hello", "hey", "dear", "thanks", "thank", "you", "regards", "best", "kind", "cheers",
  "welcome", "please", "have", "a", "nice", "great", "day", "stay", "trip",
]);

type Op = { type: "eq" | "del" | "ins"; a?: Token; b?: Token };

/** En uzun ortak alt dizi (O(N·M), taraf başına ≤ 400) → düzenleme dizisi. Eşitlikte silme önce (kararlı çıktı). */
function diffTokens(a: Token[], b: Token[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i]!.folded === b[j]!.folded ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.folded === b[j]!.folded) ops.push({ type: "eq", a: a[i++], b: b[j++] });
    else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) ops.push({ type: "del", a: a[i++] });
    else ops.push({ type: "ins", b: b[j++] });
  }
  while (i < n) ops.push({ type: "del", a: a[i++] });
  while (j < m) ops.push({ type: "ins", b: b[j++] });
  return ops;
}

function partKind(dels: Token[], ins: Token[]): EditPartKind {
  const all = [...dels, ...ins];
  if (all.length > 0 && all.every((t) => STYLE_WORDS.has(t.folded))) return "style";
  const hasValue = (ts: Token[]) => ts.some((t) => t.kind !== "word");
  if (dels.length > 0 && ins.length > 0 && hasValue(dels) && hasValue(ins)) return "value_fix";
  const content = (ts: Token[]) => ts.filter((t) => !STYLE_WORDS.has(t.folded)).length;
  if (dels.length === 0 && content(ins) >= CONTENT_MIN_WORDS) return "insertion";
  if (ins.length === 0 && content(dels) >= CONTENT_MIN_WORDS) return "deletion";
  return "other";
}

/** Torba (çoklu küme) ölçüsü — yalnız tavanı aşan metinde sınıf için (fark tablosu kurulmaz). */
function bagRatio(a: Token[], b: Token[]): number {
  const count = new Map<string, number>();
  for (const t of a) count.set(t.folded, (count.get(t.folded) ?? 0) + 1);
  let common = 0;
  for (const t of b) {
    const c = count.get(t.folded) ?? 0;
    if (c > 0) {
      common++;
      count.set(t.folded, c - 1);
    }
  }
  const max = Math.max(a.length, b.length);
  return max === 0 ? 0 : (max - common) / max;
}

function classify(ratio: number): EditClass {
  if (ratio === 0) return "unchanged";
  return ratio < EDIT_LIGHT_MAX_RATIO ? "light" : "rewrite";
}

/** Taslak → gönderilen metin farkı ve ev sahibine ait cümleler. */
export function attributeEdit(draft: string, sent: string): EditAttribution {
  const a = tokenize(draft);
  const b = tokenize(sent);
  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    const ratio = bagRatio(a, b);
    return { class: classify(ratio), ratio, capped: true, parts: [], hostSentences: [] };
  }
  const ops = diffTokens(a, b);
  // 1. geçiş: ardışık farklı parçalar (+ gönderilen metindeki komşu belirteçler — salt silmenin yerini bulmak için).
  type Hunk = { dels: Token[]; ins: Token[]; prevB?: Token; nextB?: Token; moved: boolean };
  const hunks: Hunk[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k]!.type === "eq") {
      k++;
      continue;
    }
    const prevB = k > 0 ? ops[k - 1]!.b : undefined;
    const h: Hunk = { dels: [], ins: [], prevB, moved: false };
    while (k < ops.length && ops[k]!.type !== "eq") {
      const op = ops[k++]!;
      if (op.type === "del") h.dels.push(op.a!);
      else h.ins.push(op.b!);
    }
    h.nextB = k < ops.length ? ops[k]!.b : undefined;
    hunks.push(h);
  }
  // 2. TAŞIMA (Opus 10-17 F1): taslak cümlesinin yeri değiştiyse fark onu "silindi + eklendi" görür → ev sahibi kanıtı SANILIRDI. Salt ekleme
  // parçası, aynı belirteç dizisindeki bir salt silme parçasıyla eşleşirse ikisi de taşımadır: ağırlık 0, cümle dokunulmuş sayılmaz.
  const key = (ts: Token[]) => ts.map((t) => t.folded).join(" ");
  const deletesByKey = new Map<string, Hunk[]>();
  for (const h of hunks) if (h.ins.length === 0 && h.dels.length > 0) deletesByKey.set(key(h.dels), [...(deletesByKey.get(key(h.dels)) ?? []), h]);
  for (const h of hunks) {
    if (h.dels.length > 0 || h.ins.length === 0) continue;
    const match = deletesByKey.get(key(h.ins))?.find((d) => !d.moved);
    if (match) {
      match.moved = true;
      h.moved = true;
    }
  }
  const parts: EditPart[] = [];
  const touched = new Set<number>(); // gönderilen metnin içerik olarak dokunulan cümleleri
  let weight = 0;
  for (const h of hunks) {
    const { dels, ins, prevB, nextB } = h;
    const kind: EditPartKind = h.moved ? "moved" : partKind(dels, ins);
    if (!h.moved) weight += Math.max(dels.length, ins.length);
    parts.push({
      op: dels.length > 0 && ins.length > 0 ? "replace" : ins.length > 0 ? "insert" : "delete",
      kind,
      from: dels.map((t) => t.text).join(" "),
      to: ins.map((t) => t.text).join(" "),
    });
    if (kind !== "style" && kind !== "moved") {
      for (const t of ins) touched.add(t.sentence);
      if (ins.length === 0) {
        // Salt silme: silinen yerin iki yanındaki gönderilen cümle(ler) dokunulmuştur ("Havuz…" cümlesini silmek kalan cümleleri kanıt YAPMAZ —
        // silme bütün bir cümleyse komşular aynen kalmıştır; cümle İÇİ silmede ise o cümle değişmiştir).
        if (prevB && nextB && prevB.sentence === nextB.sentence) touched.add(prevB.sentence);
      }
    }
  }
  const ratio = Math.max(a.length, b.length) === 0 ? 0 : weight / Math.max(a.length, b.length);
  const sentences = splitSentences(sent);
  return {
    class: classify(ratio),
    ratio,
    capped: false,
    parts,
    hostSentences: [...touched].sort((x, y) => x - y).map((i) => sentences[i]!.text),
  };
}
