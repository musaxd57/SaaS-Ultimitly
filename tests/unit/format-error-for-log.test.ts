import { describe, it, expect } from "vitest";
import { formatErrorForLog, redactSensitive as leafRedact } from "@/lib/redact";
import { formatErrorForLog as viaCore, redactSensitive as coreRedact } from "@/lib/report-error-core";

// F10 (Codex 09-05): alarm kurmayan log satırının biçimi. Davranışsal yazıcı testleri `tests/integration/log-sink-redaction.test.ts`.

describe("formatErrorForLog", () => {
  it("ad + ileti, merkezî redaksiyondan geçmiş; teşhis kodu kalır", () => {
    const out = formatErrorForLog(new Error("P2002 Unique constraint failed for ayse.yilmaz@example.com tel 0555 123 45 67"));
    expect(out).toBe("Error: P2002 Unique constraint failed for [EMAIL] tel [PHONE]");
  });

  it("cause zinciri kök sebep için eklenir (redakte)", () => {
    const err = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:3000 for ayse@example.com") });
    expect(formatErrorForLog(err)).toBe("TypeError: fetch failed (cause: Error: connect ECONNREFUSED 127.0.0.1:3000 for [EMAIL])");
  });

  it("🚨 yığın izi ve ham nesne yazılmaz", () => {
    const err = new Error("boom");
    expect(formatErrorForLog(err)).not.toContain("at ");
    expect(formatErrorForLog({ guestName: "Ayşe" })).toBe("[object Object]");
  });

  it("metin ve JSON gövde de redakte olur (yapısal geçiş); teşhis alanı kalır", () => {
    const out = formatErrorForLog('422 {"guestName":"Ayşe Yılmaz","code":"invalid"}');
    expect(out).not.toContain("Ayşe");
    expect(out).toContain("422");
    expect(out).toContain("invalid");
  });

  it("🚨 kısaltma redaksiyondan SONRA: tavan e-postanın ortasına düşse de adres parçası kalmaz", () => {
    const msg = `${"x".repeat(20)} ayse.yilmaz@example.com`;
    const out = formatErrorForLog(new Error(msg), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toContain("ayse");
  });

  it("asla fırlatmaz (ileti okuyucusu patlayan hata)", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", { get: () => { throw new Error("nope"); } });
    expect(formatErrorForLog(hostile)).toBe("unformattable error");
  });

  it("report-error-core aynı fonksiyonları yeniden dışa verir (eski import yolları çalışır)", () => {
    expect(viaCore).toBe(formatErrorForLog);
    expect(coreRedact).toBe(leafRedact);
  });
});
