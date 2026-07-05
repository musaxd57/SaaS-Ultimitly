// CSV reservation parser with flexible column detection and multi-format date support.

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
// Date parsing — supports YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
// ---------------------------------------------------------------------------
function parseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10), 12, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmyMatch) {
    // Try DD/MM/YYYY first (European format — most common for Turkish operators)
    const dmy = new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10), 12, 0, 0);
    if (!isNaN(dmy.getTime()) && parseInt(dmyMatch[2], 10) <= 12) return dmy;
    // Fall back to MM/DD/YYYY
    const mdy = new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[1], 10) - 1, parseInt(dmyMatch[2], 10), 12, 0, 0);
    if (!isNaN(mdy.getTime())) return mdy;
  }

  // MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const d = new Date(parseInt(mdyMatch[3], 10), parseInt(mdyMatch[1], 10) - 1, parseInt(mdyMatch[2], 10), 12, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: native parse
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// ---------------------------------------------------------------------------
// Simple CSV parser (handles quoted fields with commas, strips BOM)
// ---------------------------------------------------------------------------
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "," || ch === ";") && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a possibly-formatted amount. The LAST separator (. or ,) is the decimal
 * point; earlier separators are thousands groupings — so both "1.234,56" (EU)
 * and "1,234.56" (US) parse to 1234.56. The old single `.replace(",",".")`
 * turned both into 1.234.
 */
function parseAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return undefined;
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  const normalized =
    lastSep === -1
      ? cleaned
      : `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${cleaned.slice(lastSep + 1)}`;
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Parse a CSV string and return an array of reservation objects.
 * Skips rows with missing guest name, arrival date, or departure date.
 */
export function parseCsv(text: string): CsvReservation[] {
  // Strip BOM if present
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const rawHeaders = parseCsvLine(lines[0]).map(normalizeHeader);

  const guestIdx = findCol(rawHeaders, GUEST_COLS);
  const arrivalIdx = findCol(rawHeaders, ARRIVAL_COLS);
  const departureIdx = findCol(rawHeaders, DEPARTURE_COLS);
  const amountIdx = findCol(rawHeaders, AMOUNT_COLS);
  const currencyIdx = findCol(rawHeaders, CURRENCY_COLS);
  const channelIdx = findCol(rawHeaders, CHANNEL_COLS);
  const refIdx = findCol(rawHeaders, REF_COLS);
  const notesIdx = findCol(rawHeaders, NOTES_COLS);

  const results: CsvReservation[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const get = (idx: number): string => (idx >= 0 ? (cols[idx] ?? "").trim() : "");

    const guestName = guestIdx >= 0 ? get(guestIdx) : "";
    if (!guestName) continue;

    const arrivalRaw = arrivalIdx >= 0 ? get(arrivalIdx) : "";
    const departureRaw = departureIdx >= 0 ? get(departureIdx) : "";
    if (!arrivalRaw || !departureRaw) continue;

    const arrivalDate = parseDate(arrivalRaw);
    const departureDate = parseDate(departureRaw);
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
