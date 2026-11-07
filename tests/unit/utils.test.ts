import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatTime,
  initials,
  truncate,
  safeJsonParse,
  fromNow,
} from "@/lib/utils";

describe("formatCurrency", () => {
  it("renders an em dash for null/undefined", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
  });

  it("formats numbers with the given currency", () => {
    expect(formatCurrency(420, "EUR")).toContain("420");
  });
});

describe("formatDate", () => {
  it("renders an em dash for empty input", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("shows the UTC calendar day of a date-only reservation value (no tz drift)", () => {
    // Stored as UTC midnight of June 4 — must read as June 4 everywhere.
    expect(formatDate("2026-06-04T00:00:00.000Z")).toBe("04 Haz 2026");
    // Late-UTC instant on June 4 still belongs to June 4 (not rolled to the 5th).
    expect(formatDate("2026-06-04T23:30:00.000Z")).toBe("04 Haz 2026");
  });
});

describe("initials", () => {
  it("takes up to two uppercase initials", () => {
    expect(initials("John Smith")).toBe("JS");
    expect(initials("ayşe")).toBe("A");
    expect(initials("Maria Garcia Lopez")).toBe("MG");
  });
});

describe("truncate", () => {
  it("leaves short strings untouched", () => {
    expect(truncate("kısa", 80)).toBe("kısa");
  });
  it("appends an ellipsis to long strings", () => {
    const out = truncate("a".repeat(100), 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(11);
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });
  it("returns the fallback on invalid JSON", () => {
    expect(safeJsonParse("{not json", { ok: true })).toEqual({ ok: true });
    expect(safeJsonParse(null, [])).toEqual([]);
  });
});

describe("fromNow", () => {
  it("describes very recent times as 'az önce'", () => {
    expect(fromNow(new Date())).toBe("az önce");
  });
  it("renders an em dash for empty input", () => {
    expect(fromNow(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// ORG-TIMEZONE GÖSTERİM KATMANI (.eu / yurt dışı müşteri hazırlığı).
//
// Doğruluk katmanı (gün sınırları, saat kapıları) org.timezone'a çoktan bağlıydı;
// GÖSTERİM Europe/Istanbul'a çakılıydı. Artık gerçek an render eden yardımcılar
// (formatDateTime / formatTime / fromNow'un mutlak-gün fallback'i) çağıranın
// verdiği tz'yi kullanır. `formatDate` BİLEREK dışarıda: date-only rezervasyon
// değerlerini UTC'de tutar, tz verilirse UTC'nin batısındaki dilimlerde gün kayar.
// ---------------------------------------------------------------------------
describe("gösterim katmanı org.timezone'u izler", () => {
  // 2026-06-04T22:30Z → Istanbul'da 5 Haziran 01:30, Londra'da 4 Haziran 23:30.
  const LATE = "2026-06-04T22:30:00.000Z";

  it("formatDateTime verilen tz'de render eder (varsayılan Istanbul korunur)", () => {
    const ist = formatDateTime(LATE);
    expect(ist).toBe(formatDateTime(LATE, "Europe/Istanbul")); // varsayılan = Istanbul
    const lon = formatDateTime(LATE, "Europe/London");
    expect(lon).not.toBe(ist); // tz gerçekten uygulanıyor
    expect(ist).toContain("05 Haz");
    expect(lon).toContain("04 Haz");
  });

  it("formatTime verilen tz'nin duvar saatini verir", () => {
    expect(formatTime(LATE, "Europe/Istanbul")).toBe("01:30");
    expect(formatTime(LATE, "Europe/London")).toBe("23:30");
    expect(formatTime(LATE, "UTC")).toBe("22:30");
    expect(formatTime(LATE)).toBe(formatTime(LATE, "Europe/Istanbul"));
  });

  it("formatDate tz ALMAZ — date-only değer her yerde aynı günü gösterir", () => {
    // Regresyon kilidi: biri formatDate'e tz eklerse rezervasyon günü kayar.
    expect(formatDate(LATE)).toBe("04 Haz 2026");
    expect((formatDate as (d: unknown, tz?: unknown) => string).length).toBe(1);
  });

  it("fromNow 30 günü aşınca tz-farkında mutlak güne düşer", () => {
    // 40 gün önce, UTC'de günün son yarım saati: Istanbul'da ERTESİ gün.
    const old = new Date(Date.now() - 40 * 86_400_000);
    old.setUTCHours(22, 30, 0, 0);
    const iso = old.toISOString();
    const ist = fromNow(iso, "Europe/Istanbul");
    const utc = fromNow(iso, "UTC");
    expect(ist).not.toBe(utc); // eski davranış ikisini de UTC gününe düşürüyordu
    expect(fromNow(iso)).toBe(ist); // varsayılan Istanbul
  });

  it("farklı tz'ler formatter önbelleğinde birbirine karışmaz", () => {
    const a = formatDateTime(LATE, "Europe/Istanbul");
    const b = formatDateTime(LATE, "Europe/London");
    expect(formatDateTime(LATE, "Europe/Istanbul")).toBe(a); // ikinci okuma aynı
    expect(formatDateTime(LATE, "Europe/London")).toBe(b);
    expect(a).not.toBe(b);
  });
});
