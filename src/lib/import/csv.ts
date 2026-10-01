// CSV reservation parser — RFC 4180 tokenizer with flexible column detection
// and multi-format date support (Codex #25).
//
// STRUCTURAL corruption (unbalanced quote, a data row whose field count differs
// from the header, too many rows / an over-long cell) throws CsvParseError so
// the caller fails CLOSED — a broken file can never silently shift values into
// the wrong columns. ROW-LEVEL issues (missing guest/date, an invalid calendar
// date like 31/02) are skipped, preserving the existing partial-import contract.
//
// No new dependency: node has no built-in CSV reader and none is installed;
// a correct RFC 4180 tokenizer is small, fully testable, and keeps our
// Turkish-specific delimiter + header-alias + date logic in one place.

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export interface CsvReservation {
  guestName: string;
  arrivalDate: Date;
  departureDate: Date;
  totalAmount?: number;
  currency?: string;
  channel?: string;
  sourceReference?: string;
  notes?: string;
  /**
   * RFC 5545 durum TOKEN'ı (`"CANCELLED"`), kardeş `IcsReservation.status` ile
   * AYNI sözlük — rotanın `isCancelledRow`u ayrıştırıcıdan bağımsız kalsın diye.
   * Tanınmayan/boş değerde `undefined` (= bugünkü davranış: `confirmed` yazılır).
   */
  status?: string;
}

// Hard limits (DoS guards; the route also caps the upload at 5 MB).
const MAX_ROWS = 10_000; // header + data records
const MAX_FIELD_LEN = 20_000; // one cell

// ---------------------------------------------------------------------------
// Column name aliases (case-insensitive)
// ---------------------------------------------------------------------------
const GUEST_COLS = ["guest_name", "guestname", "guest name", "name", "misafir_adı", "misafir", "ad"];
const ARRIVAL_COLS = ["arrival", "arrival_date", "arrivaldate", "check_in", "checkin", "check-in", "giriş", "giris", "start_date", "startdate"];
const DEPARTURE_COLS = ["departure", "departure_date", "departuredate", "check_out", "checkout", "check-out", "çıkış", "cikis", "end_date", "enddate"];
const AMOUNT_COLS = ["amount", "total", "total_amount", "totalamount", "price", "tutar", "fiyat"];
const CURRENCY_COLS = ["currency", "para_birimi", "currency_code"];
const CHANNEL_COLS = ["channel", "source", "platform", "kanal"];
const REF_COLS = ["reference", "source_reference", "ref", "booking_id", "reservation_id", "id", "uid"];
const NOTES_COLS = ["notes", "note", "description", "comment", "notlar", "not"];
const STATUS_COLS = ["status", "durum", "reservation_status", "booking_status", "rezervasyon_durumu"];

/**
 * Serbest metin durum hücresini RFC 5545 token'ına indirger.
 *
 * 🚨 YALNIZ İPTAL TANINIR — `confirmed`/`pending`/`completed` BİLEREK
 * eşlenmez. Gerekçe: "status" başlıklı bir sütun her zaman REZERVASYON durumu
 * değildir; Airbnb/Booking dışa aktarımlarında ödeme durumu ("pending",
 * "paid") de aynı başlığı taşıyabiliyor. `pending` eşlenseydi tamamen ödenmiş
 * bir konaklama doluluk tahmininde bir, diğer sekiz yüzeyde başka türlü
 * sayılırdı. İptal ise tek yönlü ve yıkıcı-olmayan: tanımadığımız her değer
 * bugünkü davranışa (`confirmed`) düşer, yani yanlış-negatif güvenli.
 *
 * ÖN EK eşleşmesi: gerçek dışa aktarımlar "Cancelled by guest", "Canceled",
 * "İptal edildi" yazıyor — tam eşleşme bunların hiçbirini yakalamazdı.
 */
function normalizeStatus(raw: string): string | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  // "iptal"/"i̇ptal" — Türkçe İ'nin toLowerCase'i birleşik nokta üretebilir.
  const folded = v.replace(/̇/g, "");
  return folded.startsWith("cancel") || folded.startsWith("iptal") ? "CANCELLED" : undefined;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9ğüşıöçа-яёî]/g, "_").trim();
}

function findCol(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h === alias || h.replace(/[\s_-]/g, "") === alias.replace(/[\s_-]/g, ""));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Date parsing — YYYY-MM-DD, DD/MM/YYYY (or DD.MM.YYYY), MM/DD/YYYY.
// `makeDate` REJECTS calendar-invalid dates: new Date(2026, 1, 31) silently
// rolls over to Mar 3, so we verify the parts survived the round-trip.
// ---------------------------------------------------------------------------
function makeDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // rolled over ⇒ invalid
  return dt;
}

/** Gün / ay sırası DOSYA başına (↓`fileDayOrder`). */
type DayOrder = "dmy" | "mdy";

const SLASH_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

function parseDate(raw: string, order: DayOrder): Date | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return makeDate(+iso[1], +iso[2], +iso[3]);

  // DD/MM/YYYY (or with dots) or MM/DD/YYYY — the order is decided once for the whole FILE (↓fileDayOrder), each cell
  // calendar-validated so a bad date can't slip through.
  const parts = s.match(SLASH_DATE);
  if (parts) {
    return order === "mdy" ? makeDate(+parts[3], +parts[1], +parts[2]) : makeDate(+parts[3], +parts[2], +parts[1]);
  }
  return null; // no native-Date fallback: it accepts garbage and locale-drifts
}

/**
 * 🚨 GÜN / AY SIRASI DOSYA BAŞINA (10-01, 15 ajan incelemesi A09 — ölçüldü). Eskiden HÜCRE başına "önce gün/ay, olmazsa ay/gün"
 * deneniyordu: ABD biçimli bir Airbnb dışa aktarımında "3/10/2026 – 3/12/2026" (2 gece) 3 Ekim – 3 Aralık (61 gece) okunuyor, aynı
 * satırda "3/10/2026 – 3/14/2026" giriş 3 Ekim / çıkış 14 Mart çıkıyordu. Artık tarih sütunlarındaki TÜM hücreler birlikte okunur:
 * ilk sayısı 12'den büyük bir hücre varsa gün/ay, ikinci sayısı 12'den büyük bir hücre varsa ay/gün; ikisi birden varsa dosya
 * karışıktır (açık hata, tahmin yok); hiçbiri yoksa eskisi gibi gün/ay (Türkiye varsayılanı).
 */
function fileDayOrder(rows: readonly string[][], dateCols: readonly number[]): DayOrder {
  let dayFirst = false;
  let monthFirst = false;
  for (let i = 1; i < rows.length; i++) {
    for (const idx of dateCols) {
      if (idx < 0) continue;
      const m = (rows[i][idx] ?? "").trim().match(SLASH_DATE);
      if (!m) continue;
      const a = +m[1];
      const b = +m[2];
      if (a > 12 && b <= 12) dayFirst = true;
      else if (b > 12 && a <= 12) monthFirst = true;
    }
  }
  if (dayFirst && monthFirst) {
    throw new CsvParseError("Tarihlerde gün ve ay sırası karışık. Dosyayı tek bir tarih biçimiyle kaydedip yeniden yükleyin.");
  }
  return monthFirst ? "mdy" : "dmy";
}

// ---------------------------------------------------------------------------
// Amount. The last separator is USUALLY the decimal point ("1.234,56" EU and
// "1,234.56" US → 1234.56), EXCEPT when it's actually a thousands separator with
// no decimals at all — the common Turkish "₺1.500" (=1500) / "12.000" (=12000).
// Rule: a trailing group of EXACTLY 3 digits is a THOUSANDS group (not a decimal)
// when there's more than one separator OR the leading group is 1-3 digits. A
// trailing group of 1, 2, or 4+ digits is always a decimal ("1.5", "1,50", "1.2345").
// ---------------------------------------------------------------------------
function parseAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return undefined;
  const sign = amountSign(raw);
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (lastSep === -1) {
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? undefined : sign * n;
  }
  const afterLast = cleaned.slice(lastSep + 1);
  const sepCount = (cleaned.match(/[.,]/g) ?? []).length;
  const leadingDigits = cleaned.slice(0, lastSep).replace(/[.,]/g, "").length;
  const isThousands = afterLast.length === 3 && (sepCount > 1 || leadingDigits <= 3);
  const normalized = isThousands
    ? cleaned.replace(/[.,]/g, "")
    : `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${afterLast}`;
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? undefined : sign * n;
}

const MINUS_SIGNS = /[-\u2212\u2013]/; // ASCII eksi, matematik eksisi (U+2212), en tire (U+2013)

/**
 * Tutarın İŞARETİ (K1, kurucu kararı 09-30): eskiden rakam dışı her şey silindiği için "-100" / "(100)" sessizce +100
 * kaydediliyordu (kayıtlı tutar yanlış). Negatif = ilk rakamdan ÖNCE ya da son rakamdan SONRA eksi işareti ("-₺100",
 * "TRY -1.500", "100-") ya da muhasebe parantezi "(100)". Negatif satır içe aktarmada açık hatayla REDDEDİLİR (rota);
 * iade / düzeltme anlamı ayrıca kararlaştırılana kadar. Doğrusal.
 */
function amountSign(raw: string): 1 | -1 {
  const t = raw.trim();
  const first = t.search(/\d/);
  if (first === -1) return 1;
  let last = t.length - 1;
  while (last >= 0 && !(t[last] >= "0" && t[last] <= "9")) last--;
  if (MINUS_SIGNS.test(t.slice(0, first)) || MINUS_SIGNS.test(t.slice(last + 1))) return -1;
  return t.startsWith("(") && t.endsWith(")") ? -1 : 1;
}

/**
 * Pick the file's delimiter from the header record (majority of , vs ;), but
 * QUOTE-AWARE: a comma/semicolon INSIDE a quoted header cell is data, not a
 * separator — e.g. `"Misafir, adı";Giriş` is semicolon-delimited, and counting
 * the quoted comma would wrongly pick "," and shift every column.
 */
export function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++; // escaped "" — stays inside the quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (ch === ",") commas++;
      else if (ch === ";") semis++;
      else if (ch === "\n" || ch === "\r") break; // end of the (unquoted) header record
    }
  }
  return semis > commas ? ";" : ",";
}

/**
 * RFC 4180 tokenizer over the WHOLE text (never split by line first — a quoted
 * cell may itself contain newlines). Quotes toggle "inside" state; "" is a
 * literal quote; the delimiter and CR/LF are literal while inside quotes.
 * Throws CsvParseError on an unbalanced quote, a stray mid-field quote, an
 * over-long cell, or too many rows.
 */
function tokenizeCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let dirty = false; // record has at least one field/char started

  const endField = () => {
    if (field.length > MAX_FIELD_LEN) throw new CsvParseError("Bir hücre çok uzun — dosya bozuk olabilir.");
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    rows.push(record);
    record = [];
    dirty = false;
    if (rows.length > MAX_ROWS) throw new CsvParseError(`Çok fazla satır (en fazla ${MAX_ROWS}).`);
  };

  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.length === 0) {
        inQuotes = true; // opening quote at field start (RFC)
        dirty = true;
      } else {
        throw new CsvParseError("Hatalı tırnak kullanımı — dosya bozuk olabilir.");
      }
    } else if (ch === delimiter) {
      endField();
      dirty = true;
    } else if (ch === "\n" || ch === "\r") {
      if (dirty || field.length > 0 || record.length > 0) endRecord();
      if (ch === "\r" && text[i + 1] === "\n") i++; // CRLF
    } else {
      field += ch;
      dirty = true;
    }
  }
  if (inQuotes) throw new CsvParseError("Kapatılmamış tırnak — dosya bozuk.");
  if (dirty || field.length > 0 || record.length > 0) endRecord(); // trailing record (no final newline)
  return rows;
}

/**
 * Parse a CSV string into reservation objects. THROWS CsvParseError on
 * structural corruption (fail-closed); silently skips rows missing a guest name
 * or a valid arrival/departure date (partial-import contract preserved).
 */
export function parseCsv(text: string): CsvReservation[] {
  const clean = text.replace(/^﻿/, ""); // strip UTF-8 BOM
  if (!clean.trim()) return [];

  const delimiter = detectDelimiter(clean);
  const rows = tokenizeCsv(clean, delimiter).filter((r) => !(r.length === 1 && r[0].trim() === "")); // drop blank lines
  if (rows.length < 2) return [];

  const expectedCols = rows[0].length;
  const headers = rows[0].map(normalizeHeader);
  const guestIdx = findCol(headers, GUEST_COLS);
  const arrivalIdx = findCol(headers, ARRIVAL_COLS);
  const departureIdx = findCol(headers, DEPARTURE_COLS);
  const amountIdx = findCol(headers, AMOUNT_COLS);
  const currencyIdx = findCol(headers, CURRENCY_COLS);
  const channelIdx = findCol(headers, CHANNEL_COLS);
  const refIdx = findCol(headers, REF_COLS);
  const notesIdx = findCol(headers, NOTES_COLS);
  const statusIdx = findCol(headers, STATUS_COLS);

  const results: CsvReservation[] = [];
  const dayOrder = fileDayOrder(rows, [arrivalIdx, departureIdx]);

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    // FAIL-CLOSED: a data row whose field count differs from the header means the
    // structure is broken (an unescaped delimiter/newline, a shifted column) —
    // parsing further would read values from the wrong fields.
    if (cols.length !== expectedCols) {
      throw new CsvParseError(
        `Satır ${i + 1}: ${expectedCols} kolon bekleniyordu, ${cols.length} bulundu — dosya bozuk.`,
      );
    }
    const get = (idx: number): string => (idx >= 0 ? (cols[idx] ?? "").trim() : "");

    const guestName = get(guestIdx);
    if (!guestName) continue; // row-level skip (semantic, not structural)

    const arrivalDate = parseDate(get(arrivalIdx), dayOrder);
    const departureDate = parseDate(get(departureIdx), dayOrder);
    if (!arrivalDate || !departureDate) continue;

    const totalAmount = parseAmount(get(amountIdx));
    const currency = get(currencyIdx) || undefined;
    const channel = get(channelIdx) || undefined;
    const sourceReference = get(refIdx) || undefined;
    const notes = get(notesIdx) || undefined;
    const status = normalizeStatus(get(statusIdx));

    results.push({
      guestName,
      arrivalDate,
      departureDate,
      ...(totalAmount !== undefined && !isNaN(totalAmount) ? { totalAmount } : {}),
      ...(currency ? { currency } : {}),
      ...(channel ? { channel } : {}),
      ...(sourceReference ? { sourceReference } : {}),
      ...(notes ? { notes } : {}),
      ...(status ? { status } : {}),
    });
  }

  return results;
}
