import { describe, it, expect } from "vitest";
import { parseIcsDetailed } from "@/lib/import/ics";
import { zonedWallClockToUtc } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// KÖTÜ NİYETLİ TAKVİM BESLEMESİ (sızma testi 11-14, G E-1 — ÖLÇÜLDÜ). Takvim adresini ev sahibi girer; elle senkron dakikada 12, zamanlanmış
// senkron her 2 dakikada bir. 10 MB'lık besleme (130 bin "okunamayan ama TZID'li" etkinlik) olay döngüsünü 26 sn kilitliyordu: sonuç tavanı
// okunamayan etkinliği saymıyordu ve her TZID'li tarih iki kez yeni `Intl.DateTimeFormat` kuruyordu. Süre pini `ics-parse-cost.test.ts`.
// ---------------------------------------------------------------------------

const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
const badEvent = "BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Istanbul:20260101T120000\r\nDTEND:x\r\nEND:VEVENT\r\n";

describe("işlenen etkinlik bloğu tavanı", () => {
  it("🚨 20.000'den fazla etkinlik bloğu → okuma event_cap ile EKSİK (iptal yazılmaz); geçerli etkinlik okunmaya devam etmez", () => {
    const valid = "BEGIN:VEVENT\r\nUID:last\r\nDTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261012\r\nEND:VEVENT\r\n";
    const r = parseIcsDetailed(cal(badEvent.repeat(20_000) + valid));
    expect(r.incomplete).toContain("event_cap");
    expect(r.events).toEqual([]);
  });

  it("aşırı uygulama yok: tavanın altında okunamayan etkinlikler yalnız unreadable_event işaretler, geçerli etkinlik okunur", () => {
    const valid = "BEGIN:VEVENT\r\nUID:ok\r\nDTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261012\r\nEND:VEVENT\r\n";
    const r = parseIcsDetailed(cal(badEvent.repeat(19_999) + valid));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events.map((e) => e.sourceReference)).toEqual(["ok"]);
  });
});

describe("liste dışı TZID sınırı (besleme başına 32 farklı ad)", () => {
  // Hepsi geçerli ama çalışma ortamının desteklenen listesinde OLMAYAN takma adlar (doğrulaması pahalı yol).
  const NAMES = [
    ...Array.from({ length: 27 }, (_, i) => {
      const n = i - 14;
      return `Etc/GMT${n >= 0 ? "+" : ""}${n}`;
    }),
    "US/Eastern",
    "US/Pacific",
    "UTC",
    "GMT",
    "Turkey",
    "Asia/Istanbul",
  ];
  const event = (i: number, tz: string) =>
    `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART;TZID=${tz}:20260801T230000\r\nDTEND;TZID=${tz}:20260803T110000\r\nEND:VEVENT\r\n`;

  it("ilk 32 farklı ad dilimiyle okunur; 33.'sü dilimsiz (öğlen çapası — takvim günü yine doğru)", () => {
    expect(NAMES).toHaveLength(33);
    const r = parseIcsDetailed(cal(NAMES.map((tz, i) => event(i, tz)).join("")));
    expect(r.events).toHaveLength(33);
    const byUid = new Map(r.events.map((e) => [e.sourceReference, e]));
    expect(byUid.get("e0")!.arrivalDate.toISOString()).toBe(zonedWallClockToUtc(2026, 8, 1, 23, 0, 0, NAMES[0]!).toISOString());
    expect(byUid.get("e31")!.arrivalDate.toISOString()).toBe(zonedWallClockToUtc(2026, 8, 1, 23, 0, 0, NAMES[31]!).toISOString());
    expect(byUid.get("e32")!.arrivalDate.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });

  it("ayrıştırıcı TZID'yi büyük harfe çevirir; liste araması harf duyarsız (\"EUROPE/ISTANBUL\" listede sayılır)", async () => {
    const { isListedTimeZone } = await import("@/lib/timezone");
    expect(isListedTimeZone("EUROPE/ISTANBUL")).toBe(true);
    expect(isListedTimeZone("europe/istanbul")).toBe(true);
    expect(isListedTimeZone("US/EASTERN")).toBe(false);
    expect(isListedTimeZone("Foo/Bar")).toBe(false);
  });

  it("aşırı uygulama yok: listedeki ad (Europe/Istanbul) sınıra hiç girmez; aynı liste dışı ad tekrar tekrar kullanılabilir", () => {
    const body = NAMES.slice(0, 32).map((tz, i) => event(i, tz)).join("") + event(100, "Europe/Istanbul") + event(101, NAMES[0]!);
    const r = parseIcsDetailed(cal(body));
    const byUid = new Map(r.events.map((e) => [e.sourceReference, e]));
    expect(byUid.get("e100")!.arrivalDate.toISOString()).toBe("2026-08-01T20:00:00.000Z");
    expect(byUid.get("e101")!.arrivalDate.toISOString()).toBe(zonedWallClockToUtc(2026, 8, 1, 23, 0, 0, NAMES[0]!).toISOString());
  });
});

describe("önbellekli ofset biçimlendiricisi", () => {
  it("aynı dilim art arda / farklı anlar: sonuç önbelleksiz hesapla aynı; geçersiz ad her seferinde UTC (ofset 0)", () => {
    expect(zonedWallClockToUtc(2026, 8, 5, 23, 0, 0, "Europe/Istanbul").toISOString()).toBe("2026-08-05T20:00:00.000Z");
    expect(zonedWallClockToUtc(2026, 8, 5, 23, 0, 0, "Europe/Istanbul").toISOString()).toBe("2026-08-05T20:00:00.000Z");
    // DST: Berlin yazın +2, kışın +1 (aynı önbellekli biçimlendirici iki farklı anı doğru okur).
    expect(zonedWallClockToUtc(2026, 7, 1, 12, 0, 0, "Europe/Berlin").toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(zonedWallClockToUtc(2026, 1, 1, 12, 0, 0, "Europe/Berlin").toISOString()).toBe("2026-01-01T11:00:00.000Z");
    expect(zonedWallClockToUtc(2026, 8, 5, 23, 0, 0, "Nope/Zone").toISOString()).toBe("2026-08-05T23:00:00.000Z");
    expect(zonedWallClockToUtc(2026, 8, 5, 23, 0, 0, "Nope/Zone").toISOString()).toBe("2026-08-05T23:00:00.000Z");
  });
});
