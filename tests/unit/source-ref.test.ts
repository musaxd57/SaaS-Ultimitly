import { describe, it, expect } from "vitest";
import { normalizeSourceReference, SOURCE_REFERENCE_MAX } from "@/lib/import/source-ref";
import { parseIcsDetailed } from "@/lib/import/ics";
import { parseCsv } from "@/lib/import/csv";

// Tur 7 CAL-3: içe aktarılan kimlik doğduğu yerde saklanacak biçime getirilir.
describe("normalizeSourceReference", () => {
  it("boş → null; kısa aynen (kırpılmış); uzun 200'e kesilir; eşgüçlü", () => {
    expect(normalizeSourceReference("  ")).toBeNull();
    expect(normalizeSourceReference(null)).toBeNull();
    expect(normalizeSourceReference("  abc@airbnb.com ")).toBe("abc@airbnb.com");
    const long = "x".repeat(248);
    expect(normalizeSourceReference(long)).toBe("x".repeat(SOURCE_REFERENCE_MAX));
    expect(normalizeSourceReference(normalizeSourceReference(long))).toBe(normalizeSourceReference(long));
  });

  it("kesim vekil çifti bölmez", () => {
    const s = "a".repeat(199) + "😀" + "b";
    const out = normalizeSourceReference(s)!;
    expect(out).toBe("a".repeat(199));
    expect(normalizeSourceReference(out)).toBe(out);
  });

  it("🚨 iki ayrıştırıcı da kimliği saklanacak biçimde verir (200'den uzun UID)", () => {
    const uid = "E".repeat(248);
    const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:20261115\nDTEND;VALUE=DATE:20261117\nSUMMARY:Rez\nEND:VEVENT\nEND:VCALENDAR`;
    expect(parseIcsDetailed(ics).events[0].sourceReference).toHaveLength(SOURCE_REFERENCE_MAX);
    const csv = `reference,Status,Guest name,Start date,End date\n${uid},Confirmed,Ayşe,15.11.2026,17.11.2026`;
    expect(parseCsv(csv)[0].sourceReference).toHaveLength(SOURCE_REFERENCE_MAX);
  });
});

describe("normalizeSourceReference — eşgüçlülük (Haiku 11-05)", () => {
  it("🚨 kesimden sonra sonda kalan boşluk kırpılır: ikinci geçiş aynı değeri verir", () => {
    const s = "A".repeat(195) + "     " + "XYZ";
    const once = normalizeSourceReference(s);
    expect(once).toBe("A".repeat(195));
    expect(normalizeSourceReference(once)).toBe(once);
  });

  it("rastgele 3.000 girdide f(f(x)) === f(x) ve uzunluk ≤ 200", () => {
    const alphabet = ["a", "Z", " ", "\t", "😀", "ş", "-", "@"];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 3000; i++) {
      const len = Math.floor(rnd() * 260);
      let x = "";
      for (let j = 0; j < len; j++) x += alphabet[Math.floor(rnd() * alphabet.length)];
      const y = normalizeSourceReference(x);
      expect(normalizeSourceReference(y)).toBe(y);
      if (y) expect(y.length).toBeLessThanOrEqual(SOURCE_REFERENCE_MAX);
    }
  });
});

