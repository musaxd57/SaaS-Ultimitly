import { describe, it, expect } from "vitest";
import { LIFECYCLE_SENDABLE_STATUSES, lifecycleStatusAllows, lifecycleStatusWhere } from "@/lib/lifecycle-status";

// Otomatik mesajın gönderilebildiği rezervasyon durumları — TEK KAYNAK (Codex 11-17 D1). Gönderici sorguları, doğrudan yolun son talebi ve
// kalıcı kuyruğun işçisi aynı kümeyi buradan okur; "bekliyor" gibi ara durum hiçbir türde gönderilebilir değildir.
describe("otomatik mesaj — gönderilebilir rezervasyon durumu", () => {
  it("karşılama ve giriş yalnız onaylıya; çıkış onaylı + tamamlanmışa", () => {
    expect(LIFECYCLE_SENDABLE_STATUSES).toEqual({ welcome: ["confirmed"], checkin: ["confirmed"], checkout: ["confirmed", "completed"] });
  });

  it.each([
    ["welcome", "confirmed", true],
    ["welcome", "pending", false],
    ["welcome", "completed", false],
    ["welcome", "cancelled", false],
    ["checkin", "confirmed", true],
    ["checkin", "pending", false],
    ["checkin", "completed", false],
    ["checkout", "confirmed", true],
    ["checkout", "completed", true],
    ["checkout", "pending", false],
    ["checkout", "cancelled", false],
    ["checkin", "bilinmeyen-durum", false],
  ] as const)("%s + %s → %s", (kind, status, expected) => {
    expect(lifecycleStatusAllows(kind, status)).toBe(expected);
  });

  it("sorgu parçası: tek durumda düz eşitlik, birden çok durumda `in` (gönderici sorgularının bugünkü biçimi)", () => {
    expect(lifecycleStatusWhere("welcome")).toBe("confirmed");
    expect(lifecycleStatusWhere("checkin")).toBe("confirmed");
    expect(lifecycleStatusWhere("checkout")).toEqual({ in: ["confirmed", "completed"] });
  });
});
