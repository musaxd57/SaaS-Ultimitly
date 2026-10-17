import { describe, it, expect } from "vitest";
import { lifecycleTaskPresent, type LifecycleTaskLite } from "@/lib/tasks/lifecycle-presence";

// Kurucu D7 (10-15): "Ara temizlik sözü veya manuel temizlik, otomatik çıkış temizliğini engellemesin … tamamlanmış sistem görevi yalnız
// aynı rezervasyonun aynı çıkış temizliğiyse tekrar oluşturmayı engellesin. Çıkış tarihi sonradan değişmişse eski tamamlanmış işi otomatik
// olarak yeni tarihin temizliği sayma." · K4 (10-17, "önerildiği gibi"): aynı rezervasyonun çıkış gününe elle açılmış temizlik varsa sistem
// ikincisini açmaz; ara temizlik yine engellemez.
const TZ = "Europe/Istanbul";
const DEP = new Date("2026-10-20T00:00:00.000Z"); // yalnız-tarih çapası (UTC gece yarısı) → 20 Ekim
const t = (over: Partial<LifecycleTaskLite>): LifecycleTaskLite => ({ type: "cleaning", origin: "system", status: "todo", dueAt: DEP, ...over });

describe("yaşam döngüsü görevi 'zaten var mı?' (kurucu D7)", () => {
  it("görev yok → yok", () => {
    expect(lifecycleTaskPresent("cleaning", DEP, [], TZ)).toBe(false);
  });

  it("🚨 söz görevi / mesajdan açılan temizlik / ARA temizlik otomatik çıkış temizliğini ENGELLEMEZ (D7)", () => {
    const promise = { commitments: 1 };
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", _count: promise })], TZ)).toBe(false);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", status: "done", _count: promise })], TZ)).toBe(false);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "ai" })], TZ)).toBe(false);
    // Ara temizlik: konaklamanın ortasında, elle açılmış.
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", dueAt: new Date("2026-10-18T09:00:00.000Z") })], TZ)).toBe(false);
    // Vadesiz elle görev hangi güne ait olduğu bilinmez → saymaz.
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", dueAt: null })], TZ)).toBe(false);
  });

  it("🚨 K4 (kurucu 10-17): ev sahibinin AYNI çıkış gününe elle açtığı temizlik → var (sistem ikincisini AÇMAZ), bitmiş ya da açık", () => {
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual" })], TZ)).toBe(true); // ⬅️ ESKİDE false (iki görev yan yana)
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", _count: { commitments: 0 } })], TZ)).toBe(true);
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", status: "done", dueAt: new Date("2026-10-20T08:00:00.000Z") })], TZ)).toBe(true);
    // İstanbul günü: 20 Ekim 23:30 yerel = 20:30Z → aynı gün.
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", dueAt: new Date("2026-10-20T20:30:00.000Z") })], TZ)).toBe(true);
    // 21 Ekim 00:30 yerel = 20 Ekim 21:30Z → ERTESİ gün, saymaz.
    expect(lifecycleTaskPresent("cleaning", DEP, [t({ origin: "manual", dueAt: new Date("2026-10-20T21:30:00.000Z") })], TZ)).toBe(false);
  });

  it("K4 yalnız çıkış temizliği: elle açılmış giriş hazırlığı sistemin giriş hazırlığını engellemez; çıkış tarihi değişince eski gün saymaz", () => {
    expect(lifecycleTaskPresent("checkin_prep", DEP, [t({ type: "checkin_prep", origin: "manual" })], TZ)).toBe(false);
    expect(lifecycleTaskPresent("cleaning", new Date("2026-10-22T00:00:00.000Z"), [t({ origin: "manual" })], TZ)).toBe(false);
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
