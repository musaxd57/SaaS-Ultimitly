import { describe, it, expect } from "vitest";
import { parseIcsDetailed } from "@/lib/import/ics";
import { measureCost, costMessage } from "../helpers/linear-cost";

// Kötü niyetli takvim beslemesi (sızma testi 11-14, G E-1). Önce: 1 MB okunamayan-TZID'li etkinlik 2,5 sn, 9.000 geçerli TZID'li etkinlik
// 3,7 sn, 60 bin farklı uydurma TZID 2,3 sn. Aile boyutu bayt; gövde etkinlik bloğu tavanının (20.000) altında ve üstünde ölçülür.
const FULL = 1_500_000;
let salt = 0;
const fill = (unit: (i: number) => string) => (n: number) => {
  const parts: string[] = ["BEGIN:VCALENDAR\r\n"];
  let len = 0;
  for (let i = 0; len < n; i++) {
    const u = unit(i + salt);
    parts.push(u);
    len += u.length;
  }
  salt += 1_000_000;
  parts.push("END:VCALENDAR\r\n");
  return parts.join("");
};
const FAMILIES: [string, (n: number) => string][] = [
  ["okunamayan ama TZID'li etkinlik (DTEND bozuk)", fill(() => "BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Istanbul:20260101T120000\r\nDTEND:x\r\nEND:VEVENT\r\n")],
  [
    "geçerli TZID'li etkinlik",
    fill((i) => `BEGIN:VEVENT\r\nUID:u${i}\r\nDTSTART;TZID=Europe/Istanbul:20260101T150000\r\nDTEND;TZID=Europe/Istanbul:20260103T110000\r\nEND:VEVENT\r\n`),
  ],
  ["her etkinlikte farklı uydurma TZID", fill((i) => `BEGIN:VEVENT\r\nDTSTART;TZID=Foo/Bar${i}:20260101T120000\r\nDTEND:x\r\nEND:VEVENT\r\n`)],
];

describe("iCal ayrıştırma — süre (kötü niyetli besleme)", () => {
  for (const [name, family] of FAMILIES) {
    it(name, () => {
      const v = measureCost((s: string) => parseIcsDetailed(s), family, FULL, 300);
      expect(v.ok, costMessage(v, 300)).toBe(true);
    });
  }
});
