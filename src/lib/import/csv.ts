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

function parseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return makeDate(+iso[1], +iso[2], +iso[3]);

  // DD/MM/YYYY (or with dots) — European first (most common for TR operators),
  // then MM/DD/YYYY, each calendar-validated so a bad date can't slip through.
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmy) {
    return makeDate(+dmy[3], +dmy[2], +dmy[1]) ?? makeDate(+dmy[3], +dmy[1], +dmy[2]);
  }
  return null; // no native-Date fallback: it accepts garbage and locale-drifts
}

// ---------------------------------------------------------------------------
// Amount: the LAST separator (. or ,) is the decimal point; earlier ones are
// thousands groupings — so both "1.234,56" (EU) and "1,234.56" (US) → 1234.56.
// ---------------------------------------------------------------------------
function parseAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return undefined;
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  const normalized =
    lastSep === -1 ? cleaned : `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${cleaned.slice(lastSep + 1)}`;
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? undefined : n;
}

/** Pick the file's delimiter from the header line (the majority of , vs ;). */
function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
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

  const results: CsvReservation[] = [];

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

    const arrivalDate = parseDate(get(arrivalIdx));
    const departureDate = parseDate(get(departureIdx));
    if (!arrivalDate || !departureDate) continue;

    const totalAmount = parseAmount(get(amountIdx));
    const currency = get(currencyIdx) || undefined;
    const channel = get(channelIdx) || undefined;
    const sourceReference = get(refIdx) || undefined;
    const notes = get(notesIdx) || undefined;

    results.push({
      guestName,
      arrivalDate,
      departureDate,
      ...(totalAmount !== undefined && !isNaN(totalAmount) ? { totalAmount } : {}),
      ...(currency ? { currency } : {}),
      ...(channel ? { channel } : {}),
      ...(sourceReference ? { sourceReference } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  return results;
}
