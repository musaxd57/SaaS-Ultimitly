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
// yazma, özet yok) — test bunu `content.includes(chunk)` ile pinler. Kısa kalem
// (≤ tavan) TEK parçadır ve metni birebir aynıdır; bu sayede küçük bilgi
// tabanlarında istem satırı legacy ile karakteri karakterine aynı kalır.
// ---------------------------------------------------------------------------

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

/** Tek başına tavanı aşan aralığı kelime sınırından böler (son çare). */
function hardSplit(content: string, span: Span): Span[] {
  const out: Span[] = [];
  let start = span.start;
  while (span.end - start > CHUNK_MAX_CHARS) {
    const limit = start + CHUNK_MAX_CHARS;
    const window = content.slice(start, limit);
    const ws = window.lastIndexOf(" ");
    // Boşluk yoksa (patolojik tek kelime) tavanda sert kes.
    const cut = ws > 0 ? start + ws : limit;
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

export function chunkItem(item: KbChunkSource): KbChunk[] {
  const texts = chunkText(item.content);
  return texts.map((text, i) => ({
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
