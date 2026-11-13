import { describe, it, expect } from "vitest";
import { automationDigestParts, notReadyArrivals, notReadyDetail, notReadyHeadline, type TodayArrivalInput } from "@/lib/today/core";

// AaaS "Bugün" ekranı (kurucu 11-13: "olabilir, kontrol ederek görerek yap") — saf çekirdek. Panel'e yalnız Girişler'in "HAZIR DEĞİL" dediği
// satırlar girer (ikinci kural yok; "bilinmiyor" ve bilgi satırı her sabah dolup duvar kâğıdına dönerdi). Sayaç satırında 0 olan parça yok.

// `overall` ürün tarafında okunmaz ("HAZIR DEĞİL" ⇔ engelleyen etken); fikstürde okunabilirlik için durur.
const row = (_overall: string, factors: Array<{ state: string; label: string }>, extra: Partial<TodayArrivalInput> = {}): TodayArrivalInput => ({
  reservationId: "r1",
  propertyName: "Deniz Daire",
  checkInTime: "15:00",
  readiness: { factors },
  ...extra,
});

describe("Bugün — hazır olmayan girişler", () => {
  it("yalnız HAZIR DEĞİL satırlar girer; ilk ENGEL başlığa, kalan engel sayısı alta", () => {
    const out = notReadyArrivals([
      row("not_ready", [
        { state: "info", label: "Önceki çıkış 11:00 → giriş 15:00" },
        { state: "blocking", label: "Temizlik açık · Ayşe · 09:40" },
        { state: "unknown", label: "Erişim bilinmiyor" },
        { state: "blocking", label: "Dairede açık bakım görevi var" },
      ]),
      row("unknown", [{ state: "unknown", label: "Temizlik bitti kaydı yok" }], { reservationId: "r2" }),
      row("cleaning_ready", [{ state: "ok", label: "Temizlik bitti" }], { reservationId: "r3" }),
    ]);
    expect(out).toEqual([
      { reservationId: "r1", propertyName: "Deniz Daire", checkInTime: "15:00", firstBlocking: "Temizlik açık · Ayşe · 09:40", moreBlocking: 1 },
    ]);
  });

  it("engel yoksa satır yok (bilinmiyor / bilgi Panel'e girmez); engel varsa girer", () => {
    expect(notReadyArrivals([row("unknown", [{ state: "unknown", label: "x" }, { state: "info", label: "y" }])])).toEqual([]);
    expect(notReadyArrivals([row("not_ready", [{ state: "blocking", label: "Aynı gece başka bir konaklama var" }])])).toHaveLength(1);
  });

  it("başlık saatle ya da saatsiz; alt satır daire · ilk engel · kalan sayı", () => {
    expect(notReadyHeadline({ checkInTime: "15:00" })).toBe("Bugün 15:00 giriş hazır değil");
    expect(notReadyHeadline({ checkInTime: null })).toBe("Bugünkü giriş hazır değil");
    expect(notReadyDetail({ propertyName: "Deniz Daire", firstBlocking: "Temizlik açık", moreBlocking: 0 })).toBe("Deniz Daire · Temizlik açık");
    expect(notReadyDetail({ propertyName: "Deniz Daire", firstBlocking: "Temizlik açık", moreBlocking: 2 })).toBe("Deniz Daire · Temizlik açık · 2 eksik daha");
  });
});

describe("Bugün — son 24 saatte sizin yerinize", () => {
  it("parçalar sabit sırada; 0 olan yazılmaz", () => {
    expect(automationDigestParts({ aiReplies: 6, welcomes: 0, checkins: 2, checkouts: 1, systemTasks: 3 })).toEqual([
      "6 misafir mesajı cevaplandı",
      "2 giriş mesajı gönderildi",
      "1 çıkış mesajı gönderildi",
      "3 görev açıldı",
    ]);
    expect(automationDigestParts({ aiReplies: 0, welcomes: 4, checkins: 0, checkouts: 0, systemTasks: 0 })).toEqual(["4 karşılama mesajı gönderildi"]);
  });

  it("hepsi 0 → boş (satır basılmaz)", () => {
    expect(automationDigestParts({ aiReplies: 0, welcomes: 0, checkins: 0, checkouts: 0, systemTasks: 0 })).toEqual([]);
  });
});
