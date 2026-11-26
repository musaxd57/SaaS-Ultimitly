import { describe, it, expect } from "vitest";
import { parseCsv, CsvParseError } from "@/lib/import/csv";

// ---------------------------------------------------------------------------
// CSV gün / ay sırası DOSYA başına (10-01, 15 ajan incelemesi A09 — ölçüldü). Eskiden HÜCRE başına "önce gün/ay, olmazsa ay/gün":
// ABD biçimli Airbnb dışa aktarımında "3/10/2026 – 3/12/2026" (2 gece) 3 Ekim – 3 Aralık (61 gece) okunuyordu; aynı satırda giriş ve
// çıkış farklı sırayla okunabiliyordu (3 Ekim → 14 Mart). Artık tarih sütunlarının tamamı birlikte okunur.
// ---------------------------------------------------------------------------

const nights = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
const header = "Confirmation code,Status,Guest name,Start date,End date";

describe("gün / ay sırası dosya başına", () => {
  it("🚨 ABD biçimli dışa aktarım (bir hücrede ikinci sayı > 12) → TÜM satırlar ay/gün okunur", () => {
    const rows = parseCsv(
      [
        header,
        "HM1,Confirmed,Lale A,3/10/2026,3/12/2026",
        "HM2,Confirmed,Lale B,3/10/2026,3/14/2026",
        "HM3,Confirmed,Lale C,12/30/2026,1/2/2027",
        "HM4,Canceled by guest,Lale D,4/5/2026,4/7/2026",
      ].join("\n"),
    );
    expect(rows.map((r) => [r.guestName, r.arrivalDate.getMonth() + 1, r.arrivalDate.getDate(), nights(r.arrivalDate, r.departureDate)])).toEqual([
      ["Lale A", 3, 10, 2],
      ["Lale B", 3, 10, 4],
      ["Lale C", 12, 30, 3],
      ["Lale D", 4, 5, 2],
    ]);
  });

  it("KONTROL: Türk / Avrupa biçimi (bir hücrede ilk sayı > 12) → gün/ay, bugünkü gibi", () => {
    const rows = parseCsv([header, "R1,Confirmed,Lale,03.10.2026,05.10.2026", "R2,Confirmed,Lale,30.12.2026,02.01.2027"].join("\n"));
    expect(rows.map((r) => [r.arrivalDate.getMonth() + 1, r.arrivalDate.getDate(), nights(r.arrivalDate, r.departureDate)])).toEqual([
      [10, 3, 2],
      [12, 30, 3],
    ]);
  });

  it("KONTROL: kanıt yoksa (her iki sayı ≤ 12) bugünkü varsayılan gün/ay", () => {
    const rows = parseCsv([header, "R1,Confirmed,Lale,03/10/2026,05/10/2026"].join("\n"));
    expect([rows[0].arrivalDate.getMonth() + 1, rows[0].arrivalDate.getDate()]).toEqual([10, 3]);
  });

  it("KONTROL: ISO tarih (YYYY-MM-DD) sıradan etkilenmez", () => {
    const rows = parseCsv([header, "R1,Confirmed,Lale,2026-03-10,2026-03-12", "R2,Confirmed,Lale,3/14/2026,3/16/2026"].join("\n"));
    expect(rows.map((r) => [r.arrivalDate.getMonth() + 1, r.arrivalDate.getDate()])).toEqual([
      [3, 10],
      [3, 14],
    ]);
  });

  it("🚨 karışık dosya (hem 31/01 hem 01/31) → açık hata, tahmin yok", () => {
    const text = [header, "R1,Confirmed,Lale,31/01/2026,02/02/2026", "R2,Confirmed,Lale,01/31/2026,02/02/2026"].join("\n");
    expect(() => parseCsv(text)).toThrow(CsvParseError);
    expect(() => parseCsv(text)).toThrow(/gün ve ay sırası karışık/);
  });
});
