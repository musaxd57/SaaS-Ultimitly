import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { getOccupancyByProperty } from "@/lib/reports";

// ---------------------------------------------------------------------------
// "BU AY (BUGÜNE KADAR)" DOLULUK PENCERESİ — AYIN 1'İNDE %0 OKUYORDU (08-08)
//
// Pencere "ayın 1'i → DÜN" idi (cutoff = bugünün yerel geceyarısı, dışlayıcı).
// Ayın 1'inde bu SIFIR gece demek; payda `max(1, 0)` ile 1'e zorlanıyor, pay
// zorunlu olarak 0 kalıyordu → 20 Ağustos'tan 20 Eylül'e kadar KESİNTİSİZ dolu
// bir daire 1 Eylül'de "%0", ertesi gün "%100" gösteriyordu. Aynı sayı donut'a
// ve delta rozetine de giriyor.
//
// Pencere artık "ayın 1'i → BUGÜN dahil". Bu gece bilinmeyen bir gelecek değil:
// rezervasyon ya kapsıyor ya kapsamıyor — panel kutucuğu ve /calendar de tam
// olarak bu geceyi gösteriyor.
//
// İKİ YÖN DE PİNLİ (fixture'lar bilerek böyle seçildi):
//   • pencereyi geri alan mutasyon (cutoff = bugün) → 1'inde %0, ayın ortasında
//     5/9 = %56 → KIRMIZI.
//   • pencereyi bir gün DAHA uzatan mutasyon (cutoff = yarın+1) → 1'inde 1/2 =
//     %50, ayın ortasında 5/11 = %45 → KIRMIZI.
// ---------------------------------------------------------------------------

describe("getOccupancyByProperty — bugüne kadarki pencere", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty(); // Organization.timezone default = Europe/Istanbul
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function stay(arrivalIso: string, departureIso: string) {
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Misafir",
        arrivalDate: new Date(arrivalIso),
        departureDate: new Date(departureIso),
        status: "confirmed",
      },
    });
  }

  it("AYIN 1'İ: bu gece dolu olan daire %100 okur (eski kod: %0)", async () => {
    // 20 Ağustos → 2 Eylül. Çıkış günü sayılmaz, yani Eylül'de sadece 1 GECE
    // doludur: 1 Eylül. Bugün 1 Eylül → pencere tam olarak {1 Eylül} = 1/1.
    // (Fixture bilerek 2 Eylül'de bitiyor: pencereyi yarına taşıyan bir mutasyon
    // 1/2 = %50 verir ve yakalanır.)
    await stay("2026-08-20T00:00:00Z", "2026-09-02T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T09:00:00.000Z")); // İstanbul 1 Eylül 12:00

    const rows = await getOccupancyByProperty(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].thisMonthRate).toBe(100);
  });

  it("AYIN 1'İ: bu gece BOŞ olan daire %0 okur — düzeltme 'her şey dolu' demiyor", async () => {
    // 20 Ağustos → 1 Eylül: çıkış 1 Eylül, yani 1 Eylül gecesi BOŞ.
    await stay("2026-08-20T00:00:00Z", "2026-09-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T09:00:00.000Z"));

    const rows = await getOccupancyByProperty(orgId);
    expect(rows[0].thisMonthRate).toBe(0);
  });

  it("AY ORTASI: payda tam olarak BUGÜNÜN gün numarası (5 gece / 10 gün = %50)", async () => {
    // 1 Eylül → 6 Eylül = 5 gece (1,2,3,4,5). Bugün 10 Eylül → payda 10.
    await stay("2026-09-01T00:00:00Z", "2026-09-06T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T09:00:00.000Z"));

    const rows = await getOccupancyByProperty(orgId);
    expect(rows[0].thisMonthRate).toBe(50); // eski kod: 5/9 = %56
  });

  it("AYIN SON GÜNÜ: cutoff ay sınırını devirir, gelecek ay pencereye SIZMAZ", async () => {
    // 31 Ağustos → 5 Eylül. Bugün 31 Ağustos: Ağustos'ta dolu gece sayısı 1
    // (yalnız 31'i), payda 31 → %3. Cutoff'un 1 Eylül'e taşması gerekiyor;
    // taşma yoksa 31 Ağustos gecesi hiç sayılmaz ve sonuç %0 olur.
    await stay("2026-08-31T00:00:00Z", "2026-09-05T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T09:00:00.000Z"));

    const rows = await getOccupancyByProperty(orgId);
    expect(rows[0].thisMonthRate).toBe(3); // round(1/31*100)
  });

  it("DELTA hâlâ eşit uzunlukta iki pencereyi karşılaştırır (ayın 1'inde 1 gece'ye 1 gece)", async () => {
    // Bu ay 1 Eylül dolu; geçen ay 1 Ağustos BOŞ (konaklama 2 Ağustos'ta başlıyor).
    await stay("2026-08-02T00:00:00Z", "2026-08-04T00:00:00Z");
    await stay("2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T09:00:00.000Z"));

    const rows = await getOccupancyByProperty(orgId);
    expect(rows[0].thisMonthRate).toBe(100);
    expect(rows[0].delta).toBe(100); // geçen ayın AYNI penceresi (1 Ağustos) boştu
  });
});
