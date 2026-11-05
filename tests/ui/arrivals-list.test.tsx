// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";

// ---------------------------------------------------------------------------
// "Girişler" görünümü (kurucu H1 / H-2, 11-05): genel durum etiketi ("HAZIR" yok), faktör cümlesi, eksik şart yalnız engel /
// bilinmeyen faktörde, boş liste ve sığmayan giriş sayısı söylenir (sessiz kesme yok).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const row = (over: Partial<ArrivalsListRow> = {}): ArrivalsListRow => ({
  reservationId: "r1",
  propertyId: "p1",
  propertyName: "Lale 5",
  guestName: "Misafir",
  dayKey: "2026-11-07",
  dayLabel: "Bugün · 7 Kasım Cumartesi",
  checkInTime: "15:00",
  conversationId: "c1",
  overall: "not_ready",
  factors: [
    { key: "cleaning", state: "blocking", label: "Temizlik açık · atanan: Ayşe · başlanmadı", missing: 'çıkıştan (11:00) sonra "bitti" kaydı', basis: [] },
    { key: "access", state: "info", label: "Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi", missing: "giriş talimatı ve erişim kontrolü", basis: [] },
  ],
  ...over,
});

describe("Girişler listesi — görünüm", () => {
  it("genel durum + faktör cümlesi; eksik şart yalnız ENGEL / BİLİNMEYEN faktörde (bilgi satırında değil)", () => {
    render(<ArrivalsList rows={[row()]} truncated={0} />);
    expect(screen.getByText("HAZIR DEĞİL")).toBeTruthy();
    expect(screen.getByText("Temizlik açık · atanan: Ayşe · başlanmadı")).toBeTruthy();
    expect(screen.getByText(/eksik: çıkıştan \(11:00\) sonra "bitti" kaydı/)).toBeTruthy();
    expect(screen.queryByText(/eksik: giriş talimatı/)).toBeNull();
    expect(screen.getByRole("link", { name: "Konuşma" }).getAttribute("href")).toBe("/inbox/c1");
    // Görevler bağlantısı O DAİRENİN görevlerine süzülü açılır (satırdaki görev dayanakları orada).
    expect(screen.getByRole("link", { name: "Görevler" }).getAttribute("href")).toBe("/tasks?propertyId=p1");
  });

  it("🚨 'HAZIR' etiketi hiçbir durumda çizilmez — en iyisi 'TEMİZLİK HAZIR'", () => {
    render(
      <ArrivalsList
        rows={[
          row({ reservationId: "a", overall: "cleaning_ready" }),
          row({ reservationId: "b", overall: "unknown" }),
          row({ reservationId: "c", overall: "not_ready" }),
        ]}
        truncated={0}
      />,
    );
    expect(screen.getByText("TEMİZLİK HAZIR")).toBeTruthy();
    expect(screen.getByText("BİLİNMİYOR")).toBeTruthy();
    expect(screen.queryByText(/^HAZIR$/)).toBeNull();
  });

  it("günlere göre gruplanır; boş liste ve sığmayan giriş sayısı söylenir", () => {
    const { unmount } = render(
      <ArrivalsList rows={[row({ reservationId: "a" }), row({ reservationId: "b", dayKey: "2026-11-08", dayLabel: "Yarın · 8 Kasım Pazar" })]} truncated={3} />,
    );
    expect(screen.getByRole("region", { name: "Bugün · 7 Kasım Cumartesi" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Yarın · 8 Kasım Pazar" })).toBeTruthy();
    expect(screen.getByText("Ayrıca 3 giriş daha var; liste ilk 2 girişi gösteriyor.")).toBeTruthy();
    unmount();
    render(<ArrivalsList rows={[]} truncated={0} />);
    expect(screen.getByText("Bugün ve sonraki iki günde giriş yok.")).toBeTruthy();
  });
});
