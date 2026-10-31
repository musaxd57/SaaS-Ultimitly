import { describe, it, expect } from "vitest";
import { withoutRandomIds } from "../helpers/random-ids";

// Test yardımcısının kendi pini (10-12 gece): yalnız rastgele parçalar elenir, sızıntı yazımları DOKUNULMADAN kalır.
describe("withoutRandomIds", () => {
  it("rastgele parçaları eler: cuid · ISO zaman · epoch ms / sn · uzun onaltılık", () => {
    expect(withoutRandomIds('{"propertyId":"cmv5q6i42001cmu5x74hvfjw7"}')).toBe('{"propertyId":"<id>"}');
    expect(withoutRandomIds("at 2026-10-12T21:04:59.123Z")).toBe("at <ts>");
    expect(withoutRandomIds("ts=1791848291345 sec=1791848291.345")).toBe("ts=<ms> sec=<s>");
    expect(withoutRandomIds("event_id=9f86d081884c7d659a2feaa0c55ad015")).toBe("event_id=<hex>");
  });

  it("🚨 sızıntı yazımları KALIR (iddia onları yakalamaya devam eder)", () => {
    for (const leak of ["05551234567", "+905551234567", "5551234567", "+90 555 123 45 67", "12345678", "kod 4590", "4590dır", "kodu482913", "1800TL", "PIN:123456"]) {
      expect(withoutRandomIds(leak), leak).toBe(leak);
    }
  });
});
