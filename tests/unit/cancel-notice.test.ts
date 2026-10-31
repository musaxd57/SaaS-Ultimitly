import { describe, it, expect } from "vitest";
import { cancelNoticeDate } from "@/lib/billing/cancel-notice";

// ---------------------------------------------------------------------------
// "Yenileme iptal edildi" bildirim tarihi (gece-4 S2-10): durum tablosu. Ayarlar sayfasındaki satır içi hesap saf fonksiyona çıkarıldı;
// davranış aynı (bildirim yalnız planlı iptal + erişim açık + dönem sonu ileride), tarih işletmenin diliminde.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-18T09:00:00Z");
const END = new Date("2026-11-17T09:00:00Z");
const TZ = "Europe/Istanbul";
const at = (over: Partial<{ cancelAtPeriodEnd: boolean; active: boolean; periodEnd: Date | null }>) =>
  cancelNoticeDate({ cancelAtPeriodEnd: true, active: true, periodEnd: END, ...over }, TZ, "tr-TR", NOW);

describe("cancelNoticeDate", () => {
  it("planlı iptal + erişim açık + dönem sonu ileride → uzun tarih", () => {
    expect(at({})).toBe("17 Kasım 2026");
  });

  it("iptal planlı değil / erişim kapalı / dönem sonu bilinmiyor / geçmiş ya da tam şimdi → bildirim yok", () => {
    expect(at({ cancelAtPeriodEnd: false })).toBeNull();
    expect(at({ active: false })).toBeNull();
    expect(at({ periodEnd: null })).toBeNull();
    expect(at({ periodEnd: new Date(NOW.getTime() - 1) })).toBeNull();
    expect(at({ periodEnd: NOW })).toBeNull();
  });

  it("tarih işletmenin diliminde: UTC 21:30 İstanbul'da ertesi gün", () => {
    expect(at({ periodEnd: new Date("2026-11-17T21:30:00Z") })).toBe("18 Kasım 2026");
    expect(cancelNoticeDate({ cancelAtPeriodEnd: true, active: true, periodEnd: new Date("2026-11-17T21:30:00Z") }, "UTC", "tr-TR", NOW)).toBe("17 Kasım 2026");
  });
});
