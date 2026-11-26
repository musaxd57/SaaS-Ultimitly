import { describe, it, expect } from "vitest";
import { legacyTruncatedSourceReference, normalizeSourceReference, SOURCE_REFERENCE_MAX } from "@/lib/import/source-ref";
import { parseIcsDetailed } from "@/lib/import/ics";
import { parseCsv } from "@/lib/import/csv";

// Tur 7 CAL-3: içe aktarılan kimlik doğduğu yerde saklanacak biçime getirilir.
describe("normalizeSourceReference", () => {
  it("boş → null; kısa aynen (kırpılmış); tam 200 karakter aynen; uzun kimlik 'baş + ~ + özet' olur (≤ 200); eşgüçlü", () => {
    expect(normalizeSourceReference("  ")).toBeNull();
    expect(normalizeSourceReference(null)).toBeNull();
    expect(normalizeSourceReference("  abc@airbnb.com ")).toBe("abc@airbnb.com");
    expect(normalizeSourceReference("y".repeat(SOURCE_REFERENCE_MAX))).toBe("y".repeat(SOURCE_REFERENCE_MAX));
    const long = "x".repeat(248);
    const out = normalizeSourceReference(long)!;
    expect(out).toMatch(/^x{156}~[A-Za-z0-9_-]{43}$/);
    expect(out).toHaveLength(SOURCE_REFERENCE_MAX);
    expect(normalizeSourceReference(out)).toBe(out);
  });

  // 🚨 Takvim C1 (Codex 11-10): eskiden uzun kimlik 200'e KESİLİYORDU → ilk 200 karakteri aynı iki FARKLI kimlik tek kimliğe düşüyor,
  // iki rezervasyon tek satırda birleşiyordu.
  it("🚨 ilk 200 karakteri AYNI iki farklı uzun kimlik FARKLI değerlere gider; aynı kimlik hep aynı değere", () => {
    const prefix = "040000008200E00074C5B7101A82E008" + "0".repeat(190);
    const a = normalizeSourceReference(`${prefix}-rezervasyon-A`)!;
    const b = normalizeSourceReference(`${prefix}-rezervasyon-B`)!;
    expect(a).not.toBe(b); // ⬅️ ESKİDE ikisi de aynı 200 karakterdi
    expect(a.slice(0, 156)).toBe(b.slice(0, 156)); // okunur baş aynı, ayıran özet
    expect(normalizeSourceReference(`  ${prefix}-rezervasyon-A  `)).toBe(a);
  });

  it("uzun kimlikte baş kısım vekil çifti bölmez; sonuç yine ≤ 200 ve eşgüçlü", () => {
    const s = "a".repeat(155) + "😀" + "b".repeat(80);
    const out = normalizeSourceReference(s)!;
    expect(out.startsWith("a".repeat(155) + "~")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(SOURCE_REFERENCE_MAX);
    expect(normalizeSourceReference(out)).toBe(out);
  });

  it("eski (kesilmiş) biçim yalnız uzun kimlikte vardır ve eski yazımla BİREBİR aynıdır (eski satırlar / silme kayıtları bununla bulunur)", () => {
    expect(legacyTruncatedSourceReference("abc@airbnb.com")).toBeNull();
    expect(legacyTruncatedSourceReference("y".repeat(SOURCE_REFERENCE_MAX))).toBeNull();
    expect(legacyTruncatedSourceReference("x".repeat(248))).toBe("x".repeat(SOURCE_REFERENCE_MAX));
    expect(legacyTruncatedSourceReference("a".repeat(199) + "😀" + "b")).toBe("a".repeat(199)); // yarım vekil atılırdı
    expect(legacyTruncatedSourceReference("A".repeat(195) + "     " + "XYZ")).toBe("A".repeat(195)); // sondaki boşluk kırpılırdı
  });

  it("🚨 iki ayrıştırıcı da kimliği saklanacak biçimde verir (200'den uzun UID) ve eski biçimi ayrıca taşır; kısa kimlikte eski biçim alanı yok", () => {
    const uid = "E".repeat(248);
    const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:20261115\nDTEND;VALUE=DATE:20261117\nSUMMARY:Rez\nEND:VEVENT\nEND:VCALENDAR`;
    const ev = parseIcsDetailed(ics).events[0];
    expect(ev.sourceReference).toBe(normalizeSourceReference(uid));
    expect(ev.legacySourceReference).toBe("E".repeat(SOURCE_REFERENCE_MAX));
    const csv = `reference,Status,Guest name,Start date,End date\n${uid},Confirmed,Ayşe,15.11.2026,17.11.2026`;
    const row = parseCsv(csv)[0];
    expect(row.sourceReference).toBe(normalizeSourceReference(uid));
    expect(row.legacySourceReference).toBe("E".repeat(SOURCE_REFERENCE_MAX));
    const short = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:abc@airbnb.com\nDTSTART;VALUE=DATE:20261115\nDTEND;VALUE=DATE:20261117\nSUMMARY:Rez\nEND:VEVENT\nEND:VCALENDAR`;
    expect("legacySourceReference" in parseIcsDetailed(short).events[0]).toBe(false);
  });

  it("🚨 aynı dosyada ilk 200 karakteri aynı iki uzun UID iki AYRI etkinlik olarak okunur (tek kimlikte birleşmez)", () => {
    const prefix = "P".repeat(210);
    const ics = [
      "BEGIN:VCALENDAR",
      `BEGIN:VEVENT\nUID:${prefix}-A\nDTSTART;VALUE=DATE:20261115\nDTEND;VALUE=DATE:20261117\nSUMMARY:Rez A\nEND:VEVENT`,
      `BEGIN:VEVENT\nUID:${prefix}-B\nDTSTART;VALUE=DATE:20261120\nDTEND;VALUE=DATE:20261122\nSUMMARY:Rez B\nEND:VEVENT`,
      "END:VCALENDAR",
    ].join("\n");
    const parsed = parseIcsDetailed(ics);
    expect(new Set(parsed.events.map((e) => e.sourceReference)).size).toBe(2); // ⬅️ ESKİDE 1
    expect(parsed.incomplete).not.toContain("duplicate_uid"); // ⬅️ ESKİDE "aynı kimlik iki kez" sayılıp okuma eksik işaretleniyordu
  });
});

describe("normalizeSourceReference — eşgüçlülük (Haiku 11-05)", () => {
  it("🚨 kesimden sonra sonda kalan boşluk kırpılır: ikinci geçiş aynı değeri verir", () => {
    // (200'ü aşmayan girdi: kesim yok, yalnız baştaki / sondaki boşluk kırpılır.)
    const s = "A".repeat(195) + "     ";
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

