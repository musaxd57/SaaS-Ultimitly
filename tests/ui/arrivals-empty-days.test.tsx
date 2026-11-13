// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";

// ---------------------------------------------------------------------------
// UX-10 D1 (kurucu 11-13 "UX-10 b iyi, güzelce uzun uzun düşünerek yap"; B066 / D050): üç gün HER ZAMAN başlığıyla; boş gün "Giriş yok.";
// liste kesilmişse son gösterilen günden sonraki günlere "Giriş yok." YAZILMAZ; hiç giriş yoksa tek sonraki adım.
// Tasarım: scratchpad/handoff/UX-10-girisler-tasarim.md §4.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const DAYS = [
  { key: "2026-11-07", label: "Bugün · 7 Kasım Cumartesi" },
  { key: "2026-11-08", label: "Yarın · 8 Kasım Pazar" },
  { key: "2026-11-09", label: "9 Kasım Pazartesi" },
];

const row = (over: Partial<ArrivalsListRow> = {}): ArrivalsListRow => ({
  reservationId: "r1",
  propertyId: "p1",
  propertyName: "Lale 5",
  guestName: "Misafir",
  dayKey: "2026-11-07",
  dayLabel: DAYS[0]!.label,
  checkInTime: "15:00",
  conversationId: null,
  overall: "unknown",
  factors: [],
  ...over,
});

const region = (name: string) => screen.getByRole("region", { name });

describe("Girişler — boş günler", () => {
  it("üç gün de başlığıyla görünür; boş gün 'Giriş yok.'", () => {
    render(<ArrivalsList rows={[row(), row({ reservationId: "r2", dayKey: "2026-11-09", dayLabel: DAYS[2]!.label })]} truncated={0} days={DAYS} />);
    expect(within(region(DAYS[0]!.label)).queryByText("Giriş yok.")).toBeNull();
    expect(within(region(DAYS[1]!.label)).getByText("Giriş yok.")).toBeTruthy();
    expect(within(region(DAYS[2]!.label)).queryByText("Giriş yok.")).toBeNull();
    expect(screen.getAllByTestId("arrival-row")).toHaveLength(2);
  });

  it("🚨 liste kesildiyse son gösterilen günden SONRAKİ günler 'Giriş yok.' demez (yalan olurdu)", () => {
    render(<ArrivalsList rows={[row()]} truncated={40} days={DAYS} />);
    expect(within(region(DAYS[1]!.label)).queryByText("Giriş yok.")).toBeNull();
    expect(within(region(DAYS[1]!.label)).getByText("Bu günün girişleri listeye sığmadı.")).toBeTruthy();
    expect(within(region(DAYS[2]!.label)).getByText("Bu günün girişleri listeye sığmadı.")).toBeTruthy();
    expect(screen.getByText("Ayrıca 40 giriş daha var; liste ilk 1 girişi gösteriyor.")).toBeTruthy();
  });

  it("kesilmemiş listede son günden sonraki boş gün gerçekten 'Giriş yok.'", () => {
    render(<ArrivalsList rows={[row()]} truncated={0} days={DAYS} />);
    expect(within(region(DAYS[2]!.label)).getByText("Giriş yok.")).toBeTruthy();
  });

  it("hiç giriş yok + mülk yok: üç başlık, 'Giriş yok.' ve tek adım 'Daire ekleyin'", () => {
    render(<ArrivalsList rows={[]} truncated={0} days={DAYS} emptyNextStep="add-property" />);
    expect(screen.getAllByText("Giriş yok.")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Daire ekleyin" }).getAttribute("href")).toBe("/properties/new");
    expect(screen.queryByRole("link", { name: "Takvimi açın" })).toBeNull();
  });

  it("hiç giriş yok + mülk var: tek adım 'Takvimi açın'", () => {
    render(<ArrivalsList rows={[]} truncated={0} days={DAYS} emptyNextStep="calendar" />);
    expect(screen.getByRole("link", { name: "Takvimi açın" }).getAttribute("href")).toBe("/calendar");
    expect(screen.queryByRole("link", { name: "Daire ekleyin" })).toBeNull();
  });

  it("giriş varken boş durum adımı çizilmez", () => {
    render(<ArrivalsList rows={[row()]} truncated={0} days={DAYS} emptyNextStep="calendar" />);
    expect(screen.queryByRole("link", { name: "Takvimi açın" })).toBeNull();
  });
});
