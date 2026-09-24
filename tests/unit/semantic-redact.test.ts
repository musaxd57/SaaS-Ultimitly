import { describe, it, expect } from "vitest";
import { isDateOrTimeToken, isProtectedNumericRun, redactForSemanticModel } from "@/lib/ai/semantic/redact";

// ---------------------------------------------------------------------------
// ANLAM KATMANI REDAKSİYONU (09-24). İki yön birlikte pinlenir:
//  · tarih/saat KORUNUR (katmanın işi onları anlamak; genel redaksiyon tarihleri telefon sanıyordu);
//  · telefon hiçbir yazımda koruma kılıfıyla KAÇAMAZ (ikinci inceleme: noktalı/tireli telefonlar
//    tarih+saat parçaları sanılıp açıkta gidiyordu — ölçülmüş sızıntı).
// ---------------------------------------------------------------------------

const r = (t: string) => redactForSemanticModel(t, ["Ayşe Yılmaz"]);

describe("telefon — hiçbir yazımda kaçmaz", () => {
  const PHONES: [string, string][] = [
    ["Mon numéro: 06.12.34.56.78", "06.12.34.56.78"],
    ["call me +33 6.12.34.56.78", "6.12.34.56.78"],
    ["Tel 0532.123.45.67", "0532.123.45.67"],
    ["phone 0532 123 45 67", "0532 123 45 67"],
    ["tel: 0049 171 12.34.567", "171 12.34.567"],
    ["reach me at 555.123.45.67 please", "555.123.45.67"],
    ["My number is 12-34-56-78-90", "12-34-56-78-90"],
    ["telefon 0171-12-34-56", "0171-12-34-56"],
    ["Türkiye: 0 (532) 123-45-67", "123-45-67"],
    ["07.12.34.56.78 is my WhatsApp", "07.12.34.56.78"],
    ["14.10.2026 532 123 45 67", "532 123 45 67"],
  ];
  for (const [text, secret] of PHONES) {
    it(text, () => {
      const out = r(text);
      expect(out).not.toContain(secret);
      expect(out).toContain("[PHONE]");
    });
  }
});

describe("tarih/saat — korunur", () => {
  const KEPT: [string, string[]][] = [
    ["can we check in 12.10.2026 at 11:00", ["12.10.2026", "11:00"]],
    ["ankunft 2026-10-12, danke", ["2026-10-12"]],
    ["We arrive 14.10.2026 3 people, leave 2026/10/16 11:30", ["14.10.2026 3", "2026/10/16 11:30"]],
    ["12.10.2026 - 14.10.2026 müsait mi?", ["12.10.2026 - 14.10.2026"]],
    ["12.10.2026 11:00 giriş", ["12.10.2026 11:00"]],
    ["saat 9.30 civarı, 10:00-12:00 arası", ["9.30", "10:00-12:00"]],
    ["10/14/2026 at 9:15", ["10/14/2026", "9:15"]],
  ];
  for (const [text, parts] of KEPT) {
    it(text, () => {
      const out = r(text);
      for (const p of parts) expect(out).toContain(p);
      expect(out).not.toContain("[PHONE]");
    });
  }

  it("ad + telefon + e-posta birlikte: yalnız tarih/saat kalır", () => {
    const out = r("Ben Ayşe Yılmaz, 2026-10-14 ile 15.10.2026 arası; 11:30 gibi gelebilir miyiz? +90 532 123 45 67 · ayse@example.com");
    expect(out).toContain("2026-10-14");
    expect(out).toContain("15.10.2026");
    expect(out).toContain("11:30");
    for (const leak of ["Ayşe", "Yılmaz", "532 123 45 67", "ayse@example.com"]) expect(out).not.toContain(leak);
  });

  it("yer tutucu taklit edilemez: girdideki işaret karakteri silinir, korunan değer başka yere taşınmaz", () => {
    const out = r(`fake ${"⁣"}KEEP0${"⁣"} marker 11:00`);
    expect(out).toBe("fake KEEP0 marker 11:00");
  });
});

describe("parça kuralları (alan aralıkları)", () => {
  it("geçerli tarih/saat", () => {
    for (const t of ["2026-10-14", "2026/1/5", "14.10.2026", "5/10/26", "10/14/2026", "11:00", "9.30", "24:00"]) {
      expect(isDateOrTimeToken(t), t).toBe(true);
    }
  });
  it("biçim tutsa da alan aralığı dışı → tarih/saat DEĞİL", () => {
    for (const t of ["56.78", "12.34.56", "34.56.78", "2026-13-01", "2026-12-32", "32.10.2026", "25:00", "11:60", "13.13.2026"]) {
      expect(isDateOrTimeToken(t), t).toBe(false);
    }
  });
  it("dizi kuralı: en az bir tarih/saat; en fazla bir küçük sayı; 4+ haneli grup ya da '+' dizisi korunmaz", () => {
    expect(isProtectedNumericRun("14.10.2026 3")).toBe(true);
    expect(isProtectedNumericRun("14.10.2026 3 4")).toBe(false);
    expect(isProtectedNumericRun("11:00 0532")).toBe(false);
    expect(isProtectedNumericRun("+33 11:00")).toBe(false);
    expect(isProtectedNumericRun("3 4")).toBe(false);
    expect(isProtectedNumericRun("12.10.2026 - 14.10.2026")).toBe(true);
  });
});
