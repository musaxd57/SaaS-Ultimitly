// ---------------------------------------------------------------------------
// DOSYADAN BİLGİ TABANI — ÇIKARMA YARDIMCILARI (S2; Opus 10-23 akşam KB incelemesi R3, tasarım `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md`
// §9). SAF ve tarayıcıda da çalışır (Node modülü yok): PDF / Word / metin dosyası tarayıcıda açılır, buradaki yardımcılar o ham çıktıyı
// `kb-import/document.ts splitDocument`in beklediği SAYFA METNİNE çevirir. Hiçbir yüzeye BAĞLI DEĞİL.
//
// Sorunlar (ölçüldü / belgelendi):
//  · pdf.js `getTextContent` satır verir, BOŞ SATIR vermez → `splitDocument` paragraf ve başlık bulamıyordu (bütün sayfa tek blok). Çözüm:
//    satırlar y koordinatıyla kurulur, büyük dikey boşlukta ya da yazı boyu değişiminde boş satır eklenir.
//  · Word tabloları (`mammoth`) etiket ve değer hücrelerini ayrı bloklara böler ("Wi-Fi" | "abc123") → değer "Genel"e düşer. Çözüm: satır →
//    "etiket: değer".
//  · Bozuk Türkçe: eski PDF / Windows-1252 yanlış okuması "ý þ ð", çift UTF-8 "Ä± ÅŸ Ã§", Unicode eşlemesiz yazı tipi `(cid:NN)` / özel alan
//    karakteri / U+FFFD. Dedektör ev sahibine "karakterler bozuk görünüyor" dedirtir; onarım yalnız ÖNİZLEME önerisidir (ev sahibi onaylar).
//  · Metin dosyası: UTF-8 değilse Türkçe Windows kod sayfası (1254) — 1252 değil (ğ / ş / ı yalnız 1254'te).
// Hiçbir kalıpta karesel iş yok: karakter karakter tek geçiş ya da sabit sözcük.
// ---------------------------------------------------------------------------

/** pdf.js `TextItem`ın bize gereken alt kümesi (`transform` = [a, b, c, d, e, f]; e = x, f = y; |d| ≈ yazı boyu). */
export interface PdfTextItem {
  str: string;
  transform: readonly number[];
  height?: number;
  hasEOL?: boolean;
}

/** Bir satır: aynı taban çizgisindeki parçalar. */
interface PdfLine {
  y: number;
  size: number;
  parts: { x: number; str: string }[];
}

/** Alt çeyrek (sıralı dizinin %25 noktası): paragraf boşlukları satır aralığından büyüktür, az satırlı sayfada ortanca onlara kayıyordu. */
const lowerQuartile = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * 0.25)];
};

/**
 * pdf.js metin parçalarından sayfa metni: aynı taban çizgisindeki (y farkı yazı boyunun %40'ından az) parçalar soldan sağa tek satır;
 * satırlar yukarıdan aşağı. İki satır arasındaki dikey boşluk sayfanın tipik satır aralığının 1,4 katını aşarsa ya da yazı boyu %15'ten fazla
 * değişirse araya BOŞ SATIR (paragraf / başlık sınırı) girer. Tipik satır aralığı = AYNI yazı boyundaki ardışık satırların boşluklarının alt
 * çeyreği (başlık ve paragraf boşlukları tahmini büyütmesin). Metin dışında hiçbir şey eklenmez; boşluklar tekleşir. Saf, O(n log n).
 */
export function pdfItemsToPageText(items: readonly PdfTextItem[]): string {
  const usable = items.filter((it) => typeof it.str === "string" && Array.isArray(it.transform) && it.transform.length >= 6);
  if (usable.length === 0) return "";
  const lines: PdfLine[] = [];
  const sorted = [...usable].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  for (const it of sorted) {
    const y = it.transform[5];
    const size = Math.abs(it.transform[3]) || it.height || 0;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < Math.max(1, 0.4 * Math.max(size, last.size))) {
      last.parts.push({ x: it.transform[4], str: it.str });
      last.size = Math.max(last.size, size);
    } else {
      lines.push({ y, size, parts: [{ x: it.transform[4], str: it.str }] });
    }
  }
  const jump = (a: PdfLine, b: PdfLine) => a.size > 0 && b.size > 0 && Math.abs(a.size - b.size) / Math.max(a.size, b.size) > 0.15;
  const gaps = lines.slice(1).map((l, i) => ({ gap: lines[i].y - l.y, jump: jump(lines[i], l) })).filter((g) => g.gap > 0);
  const sameSize = gaps.filter((g) => !g.jump).map((g) => g.gap);
  const typical = lowerQuartile(sameSize.length > 0 ? sameSize : gaps.map((g) => g.gap));
  const out: string[] = [];
  lines.forEach((l, i) => {
    const text = l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;
    if (i > 0 && out.length > 0) {
      const prev = lines[i - 1];
      const gap = prev.y - l.y;
      if ((typical > 0 && gap > 1.4 * typical) || jump(prev, l)) out.push("");
    }
    out.push(text);
  });
  return out.join("\n");
}

/**
 * Word tablo satırları → metin satırları: iki hücreli satır "etiket: değer" (etiket zaten ":" ile bitiyorsa tekrar eklenmez); başka satırlar
 * hücreleri " · " ile birleştirir; boş hücreler atlanır. Her satır ayrı paragraf olur (aralarında boş satır) — `splitDocument` her satırı bir
 * blok görür, etiket ile değer AYNI blokta kalır.
 */
export function tableRowsToText(rows: readonly (readonly string[])[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => c.length > 0);
    if (cells.length === 0) continue;
    if (cells.length === 2) lines.push(`${cells[0].replace(/:$/, "")}: ${cells[1]}`);
    else lines.push(cells.join(" · "));
  }
  return lines.join("\n\n");
}

export type MojibakeKind = "win1252_turkish" | "double_utf8" | "unmapped_font" | "replacement_char";

export interface MojibakeReport {
  /** Şüpheli karakter oranı (harflere göre). */
  ratio: number;
  kinds: MojibakeKind[];
  /** Oran %1'i aşıyorsa ev sahibine "Bu dosyadaki Türkçe karakterler bozuk görünüyor" denir. */
  suspicious: boolean;
}

/** Çift UTF-8 (UTF-8 baytları Latin-1 diye okunmuş) Türkçe harfleri → doğru harf. Sabit sözlük (yalnız Türkçe ve sık Batı Avrupa harfleri). */
const DOUBLE_UTF8: readonly [string, string][] = [
  ["Ä±", "ı"],
  ["Ä°", "İ"],
  ["ÅŸ", "ş"],
  ["Åž", "Ş"],
  ["ÄŸ", "ğ"],
  ["Äž", "Ğ"],
  ["Ã§", "ç"],
  ["Ã‡", "Ç"],
  ["Ã¼", "ü"],
  ["Ãœ", "Ü"],
  ["Ã¶", "ö"],
  ["Ã–", "Ö"],
  ["Ã¢", "â"],
  ["Ã®", "î"],
  ["Ã»", "û"],
  ["Ã©", "é"],
  ["Ã¨", "è"],
  ["Ã ", "à"],
];
/** Windows-1254 baytları 1252 diye okunmuş Türkçe harfler (ı ş ğ İ Ş Ğ → ý þ ð Ý Þ Ð). */
const WIN1252_TURKISH: Readonly<Record<string, string>> = { "ý": "ı", "þ": "ş", "ð": "ğ", "Ý": "İ", "Þ": "Ş", "Ð": "Ğ" };

/**
 * Bozuk karakter dedektörü (saf, doğrusal). Sayılanlar: 1252 / 1254 karışıklığı harfleri (ý þ ð Ý Þ Ð — Türkçe metinde bu harfler normalde
 * geçmez), çift UTF-8 ikilileri, Unicode eşlemesiz yazı tipi izi (`(cid:NN)`, özel kullanım alanı karakteri), yerine-koyma karakteri (U+FFFD).
 */
export function detectMojibake(text: string): MojibakeReport {
  let letters = 0;
  let bad = 0;
  const kinds = new Set<MojibakeKind>();
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) letters += 1;
    if (ch in WIN1252_TURKISH) {
      bad += 1;
      kinds.add("win1252_turkish");
    } else if (ch === "�") {
      bad += 1;
      kinds.add("replacement_char");
    } else if (/\p{Co}/u.test(ch)) {
      bad += 1;
      kinds.add("unmapped_font");
    }
  }
  for (const [from] of DOUBLE_UTF8) {
    let at = text.indexOf(from);
    while (at !== -1) {
      bad += 1;
      kinds.add("double_utf8");
      at = text.indexOf(from, at + from.length);
    }
  }
  const cid = text.match(/\(cid:\d{1,5}\)/g);
  if (cid) {
    bad += cid.length;
    kinds.add("unmapped_font");
  }
  const ratio = letters === 0 ? (bad > 0 ? 1 : 0) : bad / letters;
  return { ratio, kinds: [...kinds], suspicious: ratio > 0.01 };
}

/**
 * Önizleme onarımı (ev sahibi ONAYLAR, kendiliğinden uygulanmaz): çift UTF-8 ikilileri ve 1252 / 1254 harfleri Türkçe karşılığına döner.
 * Eşlemesiz yazı tipi izi ve U+FFFD onarılamaz (bilgi kayıp) — dokunulmaz, dedektör söyler.
 */
export function repairTurkishMojibake(text: string): string {
  let out = text;
  for (const [from, to] of DOUBLE_UTF8) out = out.split(from).join(to);
  let fixed = "";
  for (const ch of out) fixed += WIN1252_TURKISH[ch] ?? ch;
  return fixed;
}

export type SniffedKind = "pdf" | "docx" | "txt";

/**
 * Dosya türü İLK BAYTLARDAN (uzantıya / tarayıcının bildirdiği türe güvenilmez): "%PDF-" → pdf · "PK\x03\x04" (zip) → docx adayı (asıl
 * doğrulama mammoth açarken) · ilk 4 KB'de NUL baytı yoksa → txt · başka her şey null (reddedilir).
 */
export function sniffDocumentKind(bytes: Uint8Array): SniffedKind | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "docx";
  if (bytes.length === 0) return null;
  const end = Math.min(bytes.length, 4096);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return null;
  return "txt";
}

/** Metin dosyası çözümü: UTF-8 (BOM silinir) geçerliyse o; değilse Türkçe Windows kod sayfası 1254 (1252 DEĞİL). */
export function decodeTextFile(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1254" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1254").decode(bytes), encoding: "windows-1254" };
  }
}
