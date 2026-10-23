// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CalendarSources, type CalendarSourceRow } from "@/components/properties/calendar-sources";

// F16 (09-26): kısmi okunan takvim ("partial") mülk sayfasında YEŞİL onayla gösterilmez — okunan
// rezervasyonlar alındı ama takvimin tamamı değil; host boş görünen günlere güvenmemeli.

const row = (lastStatus: string | null): CalendarSourceRow => ({
  id: "cs1",
  label: "Airbnb",
  urlMasked: "www.airbnb.com/…/abc",
  lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
  lastStatus,
  lastResult: "2 yeni rezervasyon",
});

afterEach(cleanup);

describe("takvim kaynağı durum işareti", () => {
  it("kısmi okuma: uyarı işareti, başarı işareti YOK", () => {
    render(<CalendarSources propertyId="p1" sources={[row("partial")]} />);
    expect(screen.getByLabelText("Takvimin bir kısmı okunamadı")).toBeTruthy();
    expect(screen.queryByLabelText("Son okuma başarılı")).toBeNull();
  });

  it("tam okuma: başarı işareti (uyarı yok)", () => {
    render(<CalendarSources propertyId="p1" sources={[row("ok")]} />);
    expect(screen.getByLabelText("Son okuma başarılı")).toBeTruthy();
    expect(screen.queryByLabelText("Takvimin bir kısmı okunamadı")).toBeNull();
  });

  it("hata: hata işareti", () => {
    render(<CalendarSources propertyId="p1" sources={[row("error")]} />);
    expect(screen.getByLabelText("Son okuma başarısız")).toBeTruthy();
    expect(screen.queryByLabelText("Son okuma başarılı")).toBeNull();
  });
});
