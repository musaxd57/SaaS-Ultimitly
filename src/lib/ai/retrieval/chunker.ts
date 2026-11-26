// ---------------------------------------------------------------------------
// DETERMİNİSTİK PARÇALAYICI (RAG dilim 1, 09-09).
//
// Uzun bir "Genel" kalemi (host'un ev rehberi, 3–20k karakter) bugün ya
// bütünüyle isteme giriyor ya da bütçeden bütünüyle düşüyor; ortasındaki tek
// cümle (otopark kuralı) bulunamıyordu. Parçalama cümle sınırında, hedef
// `CHUNK_TARGET_CHARS`, sert tavan `CHUNK_MAX_CHARS`. Aynı girdi → aynı parçalar
// (kanıt `chunkIndex` ile atıf yapar; kararlılık şart).
//
// METİN DEĞİŞTİRİLMEZ: her parça kalem metninin `content.slice(start, end)`
// ile alınmış BİTİŞİK bir dilimidir (satır sonları dahil; kırpma, yeniden
// yazma, özet yok) — test bunu `content.includes(chunk)` ile pinler. TEK
// İSTİSNA `KB_TABLE_HEADER` açıkken: tablonun ortasından başlayan parçanın
// başına aynı kalemin tablo başlık satırı eklenir (`chunkItem`, `prefixChars`). Kısa kalem
// (≤ tavan) TEK parçadır ve metni birebir aynıdır; bu sayede küçük bilgi
// tabanlarında istem satırı legacy ile karakteri karakterine aynı kalır.
// ---------------------------------------------------------------------------

import { tableHeaderInfo } from "./flag";

export const CHUNK_TARGET_CHARS = 600;
export const CHUNK_MAX_CHARS = 900;
/** Sondaki kırıntı bu boydan kısaysa bir önceki parçaya eklenir (tavanı aşmıyorsa). */
const CHUNK_MIN_TAIL_CHARS = 120;

export interface KbChunkSource {
  id: string;
  category: string;
  title: string;
  content: string;
  updatedAt: Date;
}

export interface KbChunk extends KbChunkSource {
  /** Parça metni (kalem içeriğinin bitişik dilimi). Tek parçada `content` ile aynı. */
  text: string;
  chunkIndex: number;
  chunkCount: number;
  /**
   * `KB_TABLE_HEADER` açıkken parçanın başına eklenen tablo başlığının uzunluğu (satır sonu dahil); eklenmediyse YOK. Yeniden sıralayıcı
   * kırpması bu kadar uzar — başlık satırı tablo satırlarını kırpmanın dışına itmesin.
   */
  prefixChars?: number;
}

interface Span {
  start: number;
  end: number;
}

/** Cümle sınırı: noktalama + boşluk + büyük harf/rakam/tırnak/madde imi. */
const SENTENCE_BOUNDARY = /[.!?…]\s+(?=[\p{Lu}\p{N}"'(\[•\-–])/gu;

/** Satır → kırpılmış aralık; boş satır atlanır. */
function lineSpans(content: string): Span[] {
  const out: Span[] = [];
  let offset = 0;
  for (const raw of content.split("\n")) {
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = offset + leading;
    const end = offset + raw.length - trailing;
    if (end > start) out.push({ start, end });
    offset += raw.length + 1;
  }
  return out;
}

/** Bir satırı cümle aralıklarına böl (sınır regex'i noktalamadan sonra keser). */
function sentenceSpans(content: string, line: Span): Span[] {
  const out: Span[] = [];
  const text = content.slice(line.start, line.end);
  let cursor = 0;
  for (const m of text.matchAll(SENTENCE_BOUNDARY)) {
    const cut = m.index + 1; // noktalamadan hemen sonra
    out.push({ start: line.start + cursor, end: line.start + cut });
    cursor = m.index + m[0].length;
  }
  out.push({ start: line.start + cursor, end: line.end });
  return out.filter((s) => s.end > s.start);
}

/** Yer tutucu kısa bir ifadedir; pencere sonunda bundan uzun süredir açık parantez yer tutucu sayılmaz. */
const PLACEHOLDER_SPAN_MAX = 80;

/**
 * Penceredeki son boşluk — köşeli / açılı parantez İÇİNDEKİ boşluk hariç (#208 A5 F10, 09-27): "[ŞİFRE BURAYA]" iki parçaya
 * bölününce ikisinde de yer tutucu tanınmıyor, "DOLDURULMAMIŞ YER TUTUCU" notu yazılmıyordu. Pencere sonunda kısa süredir açık
 * parantez (tavanı aşan yer tutucu) parantezin ÖNÜNDEN kesilir; uzun süredir açıksa (kapanmayan "[" — patolojik girdi) eski kural.
 */
function lastSafeSpace(window: string): number {
  let depth = 0;
  let openAt = -1;
  let safe = -1;
  for (let i = 0; i < window.length; i++) {
    const ch = window[i];
    if (ch === "[" || ch === "<") {
      if (depth === 0) openAt = i;
      depth += 1;
    } else if ((ch === "]" || ch === ">") && depth > 0) depth -= 1;
    else if (ch === " " && depth === 0) safe = i;
  }
  if (depth > 0 && window.length - openAt > PLACEHOLDER_SPAN_MAX) return window.lastIndexOf(" ");
  return safe > 0 ? safe : window.lastIndexOf(" ");
}

/** Tek başına tavanı aşan aralığı kelime sınırından böler (son çare). */
function hardSplit(content: string, span: Span): Span[] {
  const out: Span[] = [];
  let start = span.start;
  while (span.end - start > CHUNK_MAX_CHARS) {
    const limit = start + CHUNK_MAX_CHARS;
    const window = content.slice(start, limit);
    const ws = lastSafeSpace(window);
    // Boşluk yoksa (patolojik tek kelime) tavanda sert kes — vekil çiftini (emoji) ortadan bölmeden (Haiku 10-23 öğle: parça yarım
    // karakterle bitiyordu).
    const hard = /[\uD800-\uDBFF]/.test(content[limit - 1] ?? "") ? limit - 1 : limit;
    const cut = ws > 0 ? start + ws : hard;
    out.push({ start, end: cut });
    start = cut;
    while (start < span.end && content[start] === " ") start++;
  }
  if (span.end > start) out.push({ start, end: span.end });
  return out;
}

function unitSpans(content: string): Span[] {
  const units: Span[] = [];
  for (const line of lineSpans(content)) {
    for (const s of sentenceSpans(content, line)) {
      if (s.end - s.start > CHUNK_MAX_CHARS) units.push(...hardSplit(content, s));
      else units.push(s);
    }
  }
  return units;
}

export function chunkSpans(content: string): Span[] {
  if (content.length <= CHUNK_MAX_CHARS) return [{ start: 0, end: content.length }];
  const units = unitSpans(content);
  if (units.length === 0) return [{ start: 0, end: content.length }];
  const chunks: Span[] = [];
  let cur: Span | null = null;
  for (const u of units) {
    if (!cur) {
      cur = { ...u };
      continue;
    }
    if (u.end - cur.start <= CHUNK_TARGET_CHARS) {
      cur.end = u.end;
    } else {
      chunks.push(cur);
      cur = { ...u };
    }
  }
  if (cur) chunks.push(cur);
  // Kısa kuyruk bir önceki parçaya yapışır (tavan izin veriyorsa) — "…devam eder."
  // gibi tek cümlelik bir parça tek başına anlam taşımaz.
  if (chunks.length >= 2) {
    const tail = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (tail.end - tail.start < CHUNK_MIN_TAIL_CHARS && tail.end - prev.start <= CHUNK_MAX_CHARS) {
      chunks.splice(chunks.length - 2, 2, { start: prev.start, end: tail.end });
    }
  }
  return chunks;
}

export function chunkText(content: string): string[] {
  return chunkSpans(content).map((s) => content.slice(s.start, s.end));
}

/** Markdown tablo satırı: kırpılmış satır "|" ile başlar. */
function isTableRow(line: string): boolean {
  return line.trimStart().startsWith("|");
}

/** Markdown tablo ayıracı ("| --- | :---: |"): yalnız | - : ve boşluk, en az bir "-". Düzenli ifadesiz, doğrusal. */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") || !t.includes("-")) return false;
  for (const ch of t) if (ch !== "|" && ch !== "-" && ch !== ":" && ch !== " " && ch !== "\t") return false;
  return true;
}

/**
 * Her parça başlangıcı için, parça bir Markdown tablosunun ORTASINDAN başlıyorsa o tablonun başlık satırı (başlık satırı parçanın
 * İÇİNDEYSE ya da tablo dışındaysa null). Tek geçiş: satırlar sırayla okunur, "başlık satırı + hemen ardından ayıraç" yeni tabloyu açar,
 * tablo satırı olmayan satır kapatır. Başlangıçlar artan sırada (parçalayıcının çıktısı) — doğrusal.
 */
export function tableHeadersAt(content: string, starts: readonly number[]): (string | null)[] {
  return tableHeadsAt(content, starts).map((h) => h?.header ?? null);
}

/** `tableHeadersAt` + tablonun ayıraç satırı (içe aktarma devam parçasını geçerli Markdown tablosu olarak başlatır). */
export function tableHeadsAt(content: string, starts: readonly number[]): ({ header: string; separator: string } | null)[] {
  const lines: { start: number; text: string }[] = [];
  let pos = 0;
  for (const text of content.split("\n")) {
    lines.push({ start: pos, text });
    pos += text.length + 1;
  }
  const active: ({ header: string; separator: string; start: number } | null)[] = [];
  let cur: { header: string; separator: string; start: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (!isTableRow(t)) cur = null;
    // Yeni tablo yalnız tablo DIŞINDAYKEN açılır (Haiku 10-28: tablonun içindeki "| - | - |" satırı ayıraç sayılıp bir önceki veri satırını
    // başlık yapıyordu).
    else if (cur === null && !isTableSeparator(t) && i + 1 < lines.length && isTableSeparator(lines[i + 1].text)) {
      cur = { header: t.trim(), separator: lines[i + 1].text.trim(), start: lines[i].start };
    }
    active.push(cur);
  }
  const out: ({ header: string; separator: string } | null)[] = [];
  let li = 0;
  for (const s of starts) {
    while (li + 1 < lines.length && lines[li + 1].start <= s) li++;
    const a = active[li];
    // Başlangıç başlık satırının KENDİSİNDE (ya da içinde) ise başlık zaten parçadadır (Haiku 10-28: satır ortasından başlayan parça başlığı
    // ikinci kez alıyordu); ayıraç satırından ya da sonraki bir satırdan başlıyorsa eklenir.
    out.push(a && lines[li].start > a.start && isTableRow(lines[li].text) ? { header: a.header, separator: a.separator } : null);
  }
  return out;
}

export function chunkItem(item: KbChunkSource): KbChunk[] {
  const spans = chunkSpans(item.content);
  // Anahtar kapalıyken parça metni kalem metninin AYNEN dilimidir (yukarıdaki değişmez). Açıkken yalnız tablonun ortasından başlayan
  // parçanın başına başlık satırı + satır sonu eklenir; dilimin kendisi değişmez (`text.endsWith(dilim)`).
  const headers = tableHeaderInfo().enabled ? tableHeadersAt(item.content, spans.map((s) => s.start)) : null;
  const texts = spans.map((s, i) => {
    const slice = item.content.slice(s.start, s.end);
    const h = headers?.[i];
    return h ? `${h}\n${slice}` : slice;
  });
  return texts.map((text, i) => ({
    ...(headers?.[i] ? { prefixChars: headers[i]!.length + 1 } : {}),
    id: item.id,
    category: item.category,
    title: item.title,
    content: item.content,
    updatedAt: item.updatedAt,
    text,
    chunkIndex: i,
    chunkCount: texts.length,
  }));
}

export function chunkItems(items: readonly KbChunkSource[]): KbChunk[] {
  const out: KbChunk[] = [];
  for (const it of items) out.push(...chunkItem(it));
  return out;
}

/** Parça için kararlı anahtar (kanıt/önbellek). */
export function chunkKey(c: Pick<KbChunk, "id" | "chunkIndex">): string {
  return `${c.id}#${c.chunkIndex}`;
}
