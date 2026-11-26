import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { stayDay, stayDayInZone, stayRangeLabel, upcomingStay } from "../helpers/stay-dates";

// Zaman bombası sınıfı (11-13): saati KENDİSİ okuyan ürün yolunu sınayan test, konaklamayı sabit tarihle kurarsa takvim o güne gelince
// ürün değişmeden kırmızıya döner. Ayrıntı: `tests/helpers/stay-dates.ts`.

describe("bağıl konaklama tarihi yardımcıları", () => {
  const NOW = new Date("2026-11-13T22:30:00Z"); // İstanbul'da 14 Kasım 01:30 — gün sınırının öte yanı

  it("stayDay: yalnız tarih (00:00Z), UTC gününe göre; eksi değer geçmiş", () => {
    expect(stayDay(0, NOW).toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(stayDay(12, NOW).toISOString()).toBe("2026-11-25T00:00:00.000Z");
    expect(stayDay(-1, NOW).toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("stayDayInZone: işletme diliminin takvim gününe göre (İstanbul 01:30 = UTC 22:30 → İstanbul günü bir ileride)", () => {
    expect(stayDayInZone(0, "Europe/Istanbul", NOW).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(stayDayInZone(-1, "Europe/Istanbul", NOW).toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(stayDayInZone(0, "UTC", NOW).toISOString()).toBe(stayDay(0, NOW).toISOString());
    // Gün ortasında iki yardımcı aynı günü verir.
    const noon = new Date("2026-11-13T09:00:00Z");
    expect(stayDayInZone(3, "Europe/Istanbul", noon).toISOString()).toBe(stayDay(3, noon).toISOString());
  });

  it("ay / yıl sınırını taşır", () => {
    expect(stayDay(20, NOW).toISOString()).toBe("2026-12-03T00:00:00.000Z");
    expect(stayDay(50, NOW).toISOString()).toBe("2027-01-02T00:00:00.000Z");
  });

  it("upcomingStay: 12 gün sonra giriş, 3 gece — İstanbul günü UTC gününün bir ilerisindeyken de gelecekte", () => {
    const stay = upcomingStay(NOW);
    expect(stay.arrivalDate.toISOString()).toBe("2026-11-25T00:00:00.000Z");
    expect(stay.departureDate.toISOString()).toBe("2026-11-28T00:00:00.000Z");
    // İstanbul'da bugün = 14 Kasım; giriş hâlâ 11 gün ileride.
    expect(stay.arrivalDate.getTime() - Date.UTC(2026, 10, 14)).toBe(11 * 86_400_000);
  });

  it("stayRangeLabel: ürünün kısa aralık biçimi (aynı ay / ay geçişi)", () => {
    expect(stayRangeLabel({ arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00Z") })).toBe("12–15 Kas");
    expect(stayRangeLabel({ arrivalDate: new Date("2026-11-30T00:00:00Z"), departureDate: new Date("2026-12-03T00:00:00Z") })).toBe("30 Kas–3 Ara");
  });
});

describe("🚨 saati kendisi okuyan yolu sınayan test konaklama tarihini sabit yazmaz", () => {
  // Bu çağrılar `now` almaz ya da testte gerçek saatle (`now: new Date()`) çağrılır; sonuçları konaklama tarihinin bugüne göre yerine bağlıdır.
  const REAL_CLOCK_PATHS = /\bapplyChannelAutoReply\s*\(|\blistConversationDecisions\s*\(/;
  // Sabit konaklama tarihi (yıl-ay-gün yazılı). Bu satırın yazıldığı günden (2026-11-13) ÖNCEKİ tarihler artık dönemez → serbest
  // (bilerek "bitmiş konaklama" kuran testler). O gün ve sonrası: bağıl yardımcı.
  const FIXED_STAY_DATE = /\b(?:arrivalDate|departureDate):\s*new Date\(\s*["'`](\d{4}-\d{2}-\d{2})/g;
  const FLOOR = "2026-11-01";
  // İKİNCİ SINIF (11-13, saat 35 gün ileri alınınca bulundu): GERİYE bakan pencere. Takvim beslemesi 60 günden eski çıkışı dışarıda bırakır
  // (`ICAL_FEED_PAST_DAYS`); bugün pencerenin içindeki sabit GEÇMİŞ tarih de zamanla dışarı düşer (4–7 Ekim fikstürü 6 Aralık'ta düşecekti).
  // Bu satırın yazıldığı gün pencerenin zaten dışında kalan tarihler (eylül ortasından öncesi) bir daha içeri giremez → serbest.
  const LOOKBACK_PATHS = /@\/app\/api\/calendar\/\[token\]\/route/;
  const LOOKBACK_FLOOR = "2026-09-01";

  function walk(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(?:test|spec)\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }
  // Bu dosyanın kendisi taranmaz: aşağıdaki kontrol testi kalıbı sınamak için sabit tarihli örnek satırlar taşır.
  const SELF = path.basename(import.meta.url);
  const files = walk(path.join(process.cwd(), "tests"), []).filter((f) => path.basename(f) !== SELF);

  it("tarama boş değil (anti-vakum): saati okuyan yolu çağıran test dosyaları bulunuyor", () => {
    expect(files.length).toBeGreaterThan(300);
    const callers = files.filter((f) => REAL_CLOCK_PATHS.test(readFileSync(f, "utf8")));
    expect(callers.length).toBeGreaterThan(20);
    // Düzeltilen dört dosya taranan kümede (yol değişirse pin sessizce boşalmasın).
    for (const name of ["host-channel-answer", "host-channel-alert-paths", "conversation-items-auto-reply", "active-danger-alert"]) {
      expect(callers.some((f) => f.endsWith(`${name}.test.ts`)), name).toBe(true);
    }
  });

  it("o dosyalarda bugünden sonraya düşebilecek sabit konaklama tarihi yok", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!REAL_CLOCK_PATHS.test(src)) continue;
      for (const m of src.matchAll(FIXED_STAY_DATE)) {
        if (m[1]! >= FLOOR) offenders.push(`${path.relative(process.cwd(), f)}: ${m[0]}`);
      }
    }
    expect(offenders, "sabit tarih yerine tests/helpers/stay-dates.ts (upcomingStay / stayDay)").toEqual([]);
  });

  it("🚨 geriye bakan pencereyi (takvim beslemesi, 60 gün) sınayan testte pencereden düşebilecek sabit konaklama tarihi yok", () => {
    const callers = files.filter((f) => LOOKBACK_PATHS.test(readFileSync(f, "utf8")));
    // Anti-vakum: beslemeyi çağıran dosyalar bulunuyor ve düzeltilen dosya aralarında.
    expect(callers.length).toBeGreaterThanOrEqual(2);
    expect(callers.some((f) => f.endsWith("ical-feed-rate-limit.test.ts"))).toBe(true);
    const offenders: string[] = [];
    for (const f of callers) {
      for (const m of readFileSync(f, "utf8").matchAll(FIXED_STAY_DATE)) {
        if (m[1]! >= LOOKBACK_FLOOR) offenders.push(`${path.relative(process.cwd(), f)}: ${m[0]}`);
      }
    }
    expect(offenders, "sabit tarih yerine tests/helpers/stay-dates.ts (stayDay)").toEqual([]);
  });

  it("kalıp sabit tarihi yakalar, bağıl kurulumu yakalamaz (kontrol)", () => {
    const hit = (s: string) => [...s.matchAll(FIXED_STAY_DATE)].map((m) => m[1]);
    expect(hit('arrivalDate: new Date("2026-11-12T00:00:00Z"), departureDate: new Date("2026-11-15T00:00:00.000Z")')).toEqual(["2026-11-12", "2026-11-15"]);
    expect(hit("arrivalDate: new Date('2027-01-05')")).toEqual(["2027-01-05"]);
    expect(hit("...upcomingStay(), arrivalDate: stayDay(3), departureDate: new Date(Date.now() + 86_400_000)")).toEqual([]);
    expect(REAL_CLOCK_PATHS.test("await applyChannelAutoReply(id)")).toBe(true);
    expect(REAL_CLOCK_PATHS.test("(await listConversationDecisions(prisma, ctx))[0]")).toBe(true);
    expect(REAL_CLOCK_PATHS.test("import { applyChannelAutoReply } from")).toBe(false);
    // Eşik: patlayan fikstürün tarihi (12 Kasım 2026) yasak tarafta; bilerek bitmiş konaklama kuran eski tarihler serbest tarafta.
    expect("2026-11-12" >= FLOOR).toBe(true);
    expect("2026-06-13" >= FLOOR).toBe(false);
    // Geriye bakan pencere: düşecek fikstür (4 Ekim 2026) yasak tarafta; pencerenin zaten dışındaki tarih serbest tarafta.
    expect(LOOKBACK_PATHS.test('import { GET } from "@/app/api/calendar/[token]/route";')).toBe(true);
    expect(LOOKBACK_PATHS.test('import { GET } from "@/app/api/calendar/route";')).toBe(false);
    expect("2026-10-04" >= LOOKBACK_FLOOR).toBe(true);
    expect("2026-06-13" >= LOOKBACK_FLOOR).toBe(false);
  });
});
