import { describe, it, expect } from "vitest";
import { parseCsv, CsvParseError, detectDelimiter } from "@/lib/import/csv";

// Codex #25 — RFC 4180 correctness + fail-closed on structural corruption.
// Real-shaped fixtures; the OLD line-split parser mis-handled several of these.

const HEAD = "guest_name,arrival,departure,notes";

describe("parseCsv — RFC 4180 fields", () => {
  it("quoted field containing a COMMA is one field (not split into columns)", () => {
    const csv = `${HEAD}\n"Yılmaz, Ahmet",2026-07-10,2026-07-14,"kapı yanı"`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].guestName).toBe("Yılmaz, Ahmet");
    expect(rows[0].notes).toBe("kapı yanı");
  });

  it("escaped double-quote (doubled) inside a quoted field", () => {
    const csv = `${HEAD}\n"Ahmet ""Reis"" Yıl",2026-07-10,2026-07-14,x`;
    expect(parseCsv(csv)[0].guestName).toBe('Ahmet "Reis" Yıl');
  });

  it("a NEWLINE inside a quoted cell stays in the cell (does NOT start a new row)", () => {
    // The old parser split on \n first → this row shattered and columns shifted.
    const csv = `${HEAD}\n"Ada Guest",2026-07-10,2026-07-14,"satır1\nsatır2"`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBe("satır1\nsatır2");
  });

  it("CRLF line endings and a UTF-8 BOM are handled", () => {
    const csv = `﻿${HEAD}\r\nAda,2026-07-10,2026-07-14,note\r\nBora,2026-08-01,2026-08-03,note2\r\n`;
    const rows = parseCsv(csv);
    expect(rows.map((r) => r.guestName)).toEqual(["Ada", "Bora"]);
  });

  it("empty fields are preserved (not treated as a shifted column)", () => {
    const rows = parseCsv(`${HEAD}\nAda,2026-07-10,2026-07-14,`);
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBeUndefined(); // empty → omitted, arrival/departure intact
    expect(rows[0].arrivalDate.getFullYear()).toBe(2026);
  });

  it("semicolon-delimited files (TR/Excel) are detected from the header", () => {
    const rows = parseCsv(`guest_name;arrival;departure\n"Yıl; Ahmet";2026-07-10;2026-07-14`);
    expect(rows).toHaveLength(1);
    expect(rows[0].guestName).toBe("Yıl; Ahmet"); // ; inside quotes is literal
  });

  it("delimiter detection ignores a comma INSIDE a quoted HEADER cell (Codex #25.3)", () => {
    // Codex's exact example: `"Misafir, adı";Giriş tarihi` is SEMICOLON-delimited.
    // A quote-blind count ties (1 comma, 1 semicolon) and wrongly picks "," —
    // quote-aware counting ignores the quoted comma and correctly picks ";".
    expect(detectDelimiter('"Misafir, adı";Giriş tarihi')).toBe(";");
    // Sanity: a genuinely comma-delimited header with a quoted semicolon → ",".
    expect(detectDelimiter('"a; b",arrival,departure')).toBe(",");
    // …and it flows through parseCsv on a real semicolon file with a quoted comma.
    const rows = parseCsv(`"Misafir, adı";giriş;çıkış\n"Yıl, Ahmet";2026-07-10;2026-07-14`);
    expect(rows[0].guestName).toBe("Yıl, Ahmet");
  });

  it("Turkish + EU/US amount and column aliases still work", () => {
    const rows = parseCsv(`misafir,giriş,çıkış,tutar,para_birimi\nAyşe,10.07.2026,14.07.2026,"1.234,56",EUR`);
    expect(rows[0]).toMatchObject({ guestName: "Ayşe", totalAmount: 1234.56, currency: "EUR" });
    expect(rows[0].arrivalDate.getMonth()).toBe(6); // July (DD.MM.YYYY)
  });
});

describe("parseCsv — calendar validation (row-level skip)", () => {
  it("an invalid calendar date (31/02) is rejected, not rolled to March", () => {
    // new Date(2026,1,31) silently becomes Mar 3 — must be skipped instead.
    const rows = parseCsv(`${HEAD}\nAda,31/02/2026,2026-07-14,x`);
    expect(rows).toHaveLength(0);
  });

  it("rows missing a guest name or a date are skipped (partial import preserved)", () => {
    const csv = `${HEAD}\n,2026-07-10,2026-07-14,x\nAda,,2026-07-14,x\nBora,2026-08-01,2026-08-03,ok`;
    const rows = parseCsv(csv);
    expect(rows.map((r) => r.guestName)).toEqual(["Bora"]);
  });
});

describe("parseCsv — FAIL-CLOSED on structural corruption", () => {
  it("a row with the WRONG column count throws (never shifts values silently)", () => {
    // An unescaped comma splits a row into 5 fields where the header has 4.
    const csv = `${HEAD}\nAda,2026-07-10,2026-07-14,note,EXTRA`;
    expect(() => parseCsv(csv)).toThrow(CsvParseError);
    expect(() => parseCsv(csv)).toThrow(/kolon bekleniyordu/);
  });

  it("an unbalanced (unclosed) quote throws instead of swallowing the rest of the file", () => {
    const csv = `${HEAD}\n"Ada,2026-07-10,2026-07-14,note`;
    expect(() => parseCsv(csv)).toThrow(/Kapatılmamış tırnak/);
  });

  it("a stray quote in the MIDDLE of an unquoted field throws", () => {
    const csv = `${HEAD}\nAda"x,2026-07-10,2026-07-14,note`;
    expect(() => parseCsv(csv)).toThrow(/Hatalı tırnak/);
  });

  it("empty input and header-only input return no rows (no throw)", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv(HEAD)).toEqual([]);
  });
});
