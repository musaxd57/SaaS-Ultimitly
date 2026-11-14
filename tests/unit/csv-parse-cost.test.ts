import { describe, it, expect } from "vitest";
import { parseCsv, CsvParseError } from "@/lib/import/csv";
import { measureCost, costMessage } from "../helpers/linear-cost";

// Sızma testi 11-14 (C-E1, ölçüldü): 5 MB'lık yalnız virgülden oluşan iki satır (2,5 milyon sütun) olay döngüsünü 15 sn kilitliyordu.
// Sütun tavanı (200) ayrıştırıcıda: dosya hızlıca reddedilir. Sınırın altında ya da doğrusal (`linear-cost`).
const run = (text: string) => {
  try {
    parseCsv(text);
  } catch (e) {
    if (!(e instanceof CsvParseError)) throw e;
  }
};

describe("parseCsv — geniş başlık / çok sütun", () => {
  it("yalnız virgül (2,5 milyon sütun, iki satır) — reddedilir, kilitlemez", () => {
    const v = measureCost(run, (n) => `${",".repeat(n)}\n${",".repeat(n)}\n`, 2_500_000, 500);
    expect(v.ok, costMessage(v, 500)).toBe(true);
  });
  it("noktalı virgül ayracı ile aynı", () => {
    const v = measureCost(run, (n) => `${";".repeat(n)}\n${";".repeat(n)}\n`, 2_500_000, 500);
    expect(v.ok, costMessage(v, 500)).toBe(true);
  });
});
