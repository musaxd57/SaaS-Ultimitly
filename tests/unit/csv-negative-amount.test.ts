import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/import/csv";

// ---------------------------------------------------------------------------
// K1 (kurucu kararı 09-30): CSV'de negatif tutar sessizce pozitife ÇEVRİLMEZ. Ayrıştırıcı işareti korur; içe aktarma rotası
// negatif satırı açık hatayla reddeder (iade / düzeltme anlamı ayrıca kararlaştırılana kadar). Eskiden rakam dışı her şey
// silindiği için "-100" ve "(100)" +100 kaydediliyordu.
// ---------------------------------------------------------------------------

const amount = (v: string) => parseCsv(`misafir,giriş,çıkış,tutar\nAyşe,10.07.2026,14.07.2026,"${v}"`)[0].totalAmount;

describe("CSV tutarı — işaret korunur", () => {
  it.each([
    ["-100", -100],
    ["(100)", -100],
    ["−250", -250], // matematik eksisi
    ["- 1.500", -1500],
    ["TRY -1.500,50", -1500.5],
    ["-₺1.500", -1500],
    ["100-", -100], // muhasebe dışa aktarımlarında sondaki eksi
  ])("%s → %d", (raw, expected) => expect(amount(raw)).toBe(expected));

  it.each([
    ["100", 100],
    ["₺1.500", 1500],
    ["1.234,56", 1234.56],
    ["TRY 1.500", 1500],
  ])("KONTROL %s → %d (pozitif aynen)", (raw, expected) => expect(amount(raw)).toBe(expected));

  it("hücre tavanına yakın girdide doğrusal (hücre tavanı ayrıştırıcıda)", () => {
    const t0 = Date.now();
    expect(amount(`${"-".repeat(4_000)}1${"x".repeat(4_000)}`)).toBe(-1);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
