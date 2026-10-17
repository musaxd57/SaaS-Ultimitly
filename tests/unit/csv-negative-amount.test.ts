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

// U30 (Codex 10-07): muhasebe parantezi para birimi metniyle; bütün tire sınıfı + tam genişlik eksi.
describe("U30 — negatif tutarın diğer yazımları", () => {
  it.each([
    ["USD (100.00)", -100],
    ["₺(1.500,50)", -1500.5],
    ["(USD 100)", -100],
    ["－100", -100], // tam genişlik eksi (U+FF0D)
    ["‒100", -100], // figür tiresi (U+2012)
    ["—100", -100], // uzun tire
    ["﹣100", -100], // küçük eksi (U+FE63)
  ])("%s → %d", (raw, expected) => expect(amount(raw)).toBe(expected));
  it.each([
    ["USD 100.00", 100],
    ["₺ 1.500", 1500],
    ["1'500", 1500],
  ])("KONTROL %s → %d", (raw, expected) => expect(amount(raw)).toBe(expected));
});

// U31 (Codex 10-07): rakamların arasında rakam / ayraç dışı bir şey varsa tutar UYDURULMAZ (NaN → rota satırı reddeder).
describe("U31 — okunamayan tutar başka bir tutara çevrilmez", () => {
  it.each(["100+50", "1e3", "12abc34", "100 – 50", "1/2"])("%s → NaN", (raw) => expect(amount(raw)).toBeNaN());
  it.each([
    ["1.500", 1500],
    ["1,234.56", 1234.56],
    ["₺ 1.500", 1500],
    ["100 TL", 100],
  ])("KONTROL %s → %d", (raw, expected) => expect(amount(raw)).toBe(expected));
  it("tutar hücresi boşsa / rakamsızsa tutar yok (hata değil)", () => {
    expect(amount("")).toBeUndefined();
    expect(amount("—")).toBeUndefined();
  });
});

// U32 (Codex 10-07): yalnız-tarih değeri sunucunun saat diliminden bağımsız UTC öğlen çapası.
describe("U32 — CSV tarihi sunucu saat diliminden bağımsız", () => {
  it.each(["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York", "Europe/Istanbul"])("TZ=%s → 2026-07-10T12:00Z", (tz) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      const row = parseCsv(`misafir,giriş,çıkış\nAyşe,10.07.2026,14.07.2026`)[0];
      expect(row.arrivalDate.toISOString()).toBe("2026-07-10T12:00:00.000Z");
      expect(row.departureDate.toISOString()).toBe("2026-07-14T12:00:00.000Z");
    } finally {
      process.env.TZ = prev;
    }
  });
});
