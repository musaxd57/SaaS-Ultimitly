import { describe, it, expect } from "vitest";
import { zonedDateStart, dateKeyInTimeZone, zonedDayRange } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// U34 (Codex 10-07, 15c8663): YAZ SAATİ GEÇİŞİ TAM GECEYARISINDA olan dilimlerde günün başlangıcı.
//  · yerel 00:00 hiç yok (ileri alma 00:00 → 01:00: Azor, Havana, Santiago) → eskiden önceki günün 23:00'ü dönüyordu;
//  · yerel 00:00 iki kez var (geri alma 01:00 → 00:00: Amman, Gaza, Hebron) → eskiden İKİNCİ geceyarısı dönüyordu.
// Değişmez: `zonedDateStart(gün)` o günün İLK anıdır — kendi günündedir, bir milisaniye öncesi önceki gündedir. Bellekteki takvim
// kuralı (`dateKeyInTimeZone`) ile gün aralığı sorgusu (`day-where.ts`) bu yüzden ayrışıyordu.
// ---------------------------------------------------------------------------

const ZONES = ["Atlantic/Azores", "America/Havana", "America/Santiago", "Asia/Amman", "Asia/Gaza", "Asia/Hebron", "Europe/Istanbul", "America/New_York"];

function days(from: string, to: string): [number, number, number, string][] {
  const out: [number, number, number, string][] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    out.push([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.toISOString().slice(0, 10)]);
  }
  return out;
}

describe("U34 — zonedDateStart günün gerçek ilk anı", () => {
  for (const tz of ZONES) {
    it(`${tz}: 2020–2027 her gün başlangıcı kendi gününde, 1 ms öncesi önceki günde`, () => {
      let special = 0;
      for (const [y, m, d, key] of days("2020-01-01", "2027-12-31")) {
        const s = zonedDateStart(y, m, d, tz);
        expect(dateKeyInTimeZone(s, tz), `${tz} ${key}`).toBe(key); // ⬅️ ARIZADA önceki gün (Azor 2026-03-29 → 28)
        expect(dateKeyInTimeZone(new Date(s.getTime() - 1), tz) < key, `${tz} ${key} önceki an`).toBe(true); // ⬅️ ARIZADA aynı gün (Amman)
        const local = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(s);
        if (local !== "00:00") special++;
      }
      // Anti-vakum: geceyarısı geçişi olan dilimlerde en az bir gün 00:00'dan başlamaz (ileri alma günü).
      if (["Atlantic/Azores", "America/Havana", "America/Santiago"].includes(tz)) expect(special).toBeGreaterThan(0);
      if (["Europe/Istanbul", "America/New_York"].includes(tz)) expect(special).toBe(0);
    });
  }

  it("Azor 29 Mart 2026: gün 01:00 yerel (= 01:00Z) başlar; gün aralığı 28 Mart'ın son saatini içermez", () => {
    const r = zonedDayRange(new Date("2026-03-29T12:00:00Z"), "Atlantic/Azores");
    expect(r.start.toISOString()).toBe("2026-03-29T01:00:00.000Z"); // ⬅️ ARIZADA 2026-03-29T00:00:00.000Z (= 28 Mart 23:00 yerel)
    expect(dateKeyInTimeZone(new Date("2026-03-29T00:30:00Z"), "Atlantic/Azores")).toBe("2026-03-28");
  });

  it("Amman 29 Ekim 2021: gün İLK geceyarısında başlar (yaz saati, 28 Ekim 21:00Z)", () => {
    expect(zonedDateStart(2021, 10, 29, "Asia/Amman").toISOString()).toBe("2021-10-28T21:00:00.000Z"); // ⬅️ ARIZADA 22:00Z
  });

  it("KONTROL: İstanbul / New York günleri eskisiyle aynı", () => {
    expect(zonedDateStart(2026, 9, 26, "Europe/Istanbul").toISOString()).toBe("2026-09-25T21:00:00.000Z");
    expect(zonedDateStart(2026, 3, 8, "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedDateStart(2026, 11, 1, "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(zonedDateStart(2026, 13, 1, "Europe/Istanbul").toISOString()).toBe("2026-12-31T21:00:00.000Z"); // ay taşması
  });

  it("KONTROL: geçersiz dilim fırlatmaz (eski düşüş: UTC)", () => {
    expect(zonedDateStart(2026, 3, 29, "Bozuk/Dilim").toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });
});
