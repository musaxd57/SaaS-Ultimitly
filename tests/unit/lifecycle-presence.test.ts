import { describe, it, expect } from "vitest";
import { lifecycleTaskPresent, type LifecycleTaskLite } from "@/lib/tasks/lifecycle-presence";

// Kurucu D7 (10-15): "Ara temizlik sözü veya manuel temizlik, otomatik çıkış temizliğini engellemesin … tamamlanmış sistem görevi yalnız
// aynı rezervasyonun aynı çıkış temizliğiyse tekrar oluşturmayı engellesin. Çıkış tarihi sonradan değişmişse eski tamamlanmış işi otomatik
// olarak yeni tarihin temizliği sayma."
const TZ = "Europe/Istanbul";
const DEP = new Date("2026-10-20T00:00:00.000Z"); // yalnız-tarih çapası (UTC gece yarısı) → 20 Ekim
const t = (over: Partial<LifecycleTaskLite>): LifecycleTaskLite => ({ type: "cleaning", origin: "system", status: "todo", dueAt: DEP, ...over });

describe("yaşam döngüsü görevi 'zaten var mı?' (kurucu D7)", () => {
  it("görev yok → yok", () => {
    expect(lifecycleTaskPresent("cleaning", DEP, [], TZ)).toBe(false);
  });

  it("🚨 elle açılmış / söz / mesajdan açılan temizlik otomatik çıkış temizliğini ENGELLEMEZ", () => {
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual" })], TZ)).toBe(false);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "ai" })], TZ)).toBe(false);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", status: "done" })], TZ)).toBe(false);
  });

  it("sistemin açık temizliği → var (ev sahibi tarihini elle başka güne taşımış olsa bile)", () => {
    expect(lifecycleTaskPresent("cleaning", DEP, [t({})], TZ)).toBe(true);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ status: "in_progress", dueAt: new Date("2026-10-22T09:00:00.000Z") })], TZ)).toBe(true);
  });

  it("bitmiş sistem temizliği AYNI çıkış gününde → var (ikinci kez açılmaz); saat farkı önemsiz", () => {
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ status: "done" })], TZ)).toBe(true);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ status: "done", dueAt: new Date("2026-10-20T11:30:00.000Z") })], TZ)).toBe(true);
  });

  it("🚨 çıkış tarihi sonradan değişti: ESKİ günün bitmiş temizliği yeni günün temizliği SAYILMAZ", () => {
    const newDep = new Date("2026-10-22T00:00:00.000Z");
    expect(lifecycleTaskPresent("cleaning", newDep, [t({ status: "done" })], TZ)).toBe(false);
  });

  it("tür ayrımı: temizlik görevi giriş hazırlığını karşılamaz", () => {
    expect(lifecycleTaskPresent("checkin_prep", DEP, [t({})], TZ)).toBe(false);
    expect(lifecycleTaskPresent("checkin_prep", DEP, [t({ type: "checkin_prep" })], TZ)).toBe(true);
  });
});
