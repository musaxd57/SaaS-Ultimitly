import { describe, it, expect } from "vitest";
import { isStorableDate, reservationSchema, taskSchema, taskUpdateSchema } from "@/lib/validators";

// SAKLANABİLİR TARİH (sızma testi 11-14, M-1). `z.coerce.date()` 10000 yılını geçerli sayıyordu; veritabanı sürücüsü onu yazamaz → 500 +
// hata raporu (yetkili kullanıcı kendi işletmesinden ortak uyarı kovasını doldurabilirdi). 1900–9999 dışı → doğrulama hatası (400).
const Y10K = 253402300800000; // 10000-01-01T00:00:00Z

describe("isStorableDate", () => {
  it("1900–9999 içi kabul, dışı ve geçersiz tarih ret (sınırlar dahil)", () => {
    expect(isStorableDate(new Date("2026-11-14T10:00:00Z"))).toBe(true);
    expect(isStorableDate(new Date("1900-01-01T00:00:00Z"))).toBe(true);
    expect(isStorableDate(new Date("9999-12-31T23:59:59Z"))).toBe(true);
    expect(isStorableDate(new Date(Y10K))).toBe(false);
    expect(isStorableDate(new Date("1899-12-31T23:59:59Z"))).toBe(false);
    expect(isStorableDate(new Date(Number.NaN))).toBe(false);
  });
});

describe("şemalar 10000 yılını reddeder, olağan tarihi kabul eder", () => {
  it("görev oluşturma / güncelleme dueAt", () => {
    const base = { propertyId: "p1", title: "Temizlik" };
    expect(taskSchema.safeParse({ ...base, dueAt: Y10K }).success).toBe(false);
    expect(taskSchema.safeParse({ ...base, dueAt: "2026-11-20T10:00:00Z" }).success).toBe(true);
    expect(taskSchema.safeParse({ ...base, dueAt: "" }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ dueAt: Y10K }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ dueAt: "2026-11-20T10:00:00Z" }).success).toBe(true);
  });
  it("rezervasyon giriş / çıkış tarihi", () => {
    const base = { propertyId: "p1", guestName: "Ayşe Lale", arrivalDate: "2026-12-01", departureDate: "2026-12-04" };
    expect(reservationSchema.safeParse(base).success).toBe(true);
    expect(reservationSchema.safeParse({ ...base, departureDate: Y10K }).success).toBe(false);
    expect(reservationSchema.safeParse({ ...base, arrivalDate: Y10K }).success).toBe(false);
  });
});
