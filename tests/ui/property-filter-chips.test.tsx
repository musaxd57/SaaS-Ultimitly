// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PropertyFilterChips, centeredScrollLeft, type PropertyFilterChip } from "@/components/property-filter-chips";

// Daire süzgeci (Görevler · Takvim · İptaller): telefonda TEK SATIR + yana kaydırma, geniş ekranda sarar. FB gezisi 11-20 akşam: 12 dairede
// çipler 390 px'te 5 satır tutuyordu (asıl içerik ilk ekranın altında). jsdom yerleşim ölçmez — pin sınıf + davranış düzeyinde; ekran
// ölçümü (şerit yüksekliği, yatay taşma yok) gezi raporunda.

afterEach(cleanup);

const items = (active: string): PropertyFilterChip[] => [
  { key: "all", href: "/tasks", label: "Tümü", active: active === "all" },
  ...["Lale 3", "Lale 5", "Sahil Evi"].map((name, i) => ({ key: `p${i}`, href: `/tasks?propertyId=p${i}`, label: name, active: active === `p${i}` })),
];

describe("PropertyFilterChips", () => {
  it("telefonda tek satır yana kayar, sm ve üstünde sarar; çipler ezilmez / kırılmaz", () => {
    render(<PropertyFilterChips items={items("all")} />);
    const nav = screen.getByRole("navigation", { name: "Daire süzgeci" });
    const cls = nav.className.split(/\s+/);
    expect(cls).toContain("overflow-x-auto");
    expect(cls).not.toContain("flex-wrap"); // öneksiz sarma = telefonda çok satır (eski hâl)
    expect(cls).toContain("sm:flex-wrap");
    expect(cls).toContain("sm:overflow-visible");
    for (const a of screen.getAllByRole("link")) {
      expect(a.className).toContain("shrink-0");
      expect(a.className).toContain("whitespace-nowrap");
    }
  });

  it("metin ve adresler çağıranın verdiğiyle aynı; yalnız seçili çip aria-current taşır", () => {
    render(<PropertyFilterChips items={items("p1")} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Tümü", "Lale 3", "Lale 5", "Sahil Evi"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/tasks", "/tasks?propertyId=p0", "/tasks?propertyId=p1", "/tasks?propertyId=p2"]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, null, "page", null]);
  });

  it("seçili çip açılışta şeridin ortasına gelir — yalnız şeridin kendi yatay konumu değişir, pencere kaydırılmaz", () => {
    // jsdom yerleşim ölçmez: çip konumlarını elle veririz (her çip 100 px, şerit 300 px görünür, şerit sayfada 16 px içeride).
    const left = vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "NAV") return 16;
      const order = ["Tümü", "Lale 3", "Lale 5", "Sahil Evi"].indexOf(this.textContent ?? "");
      return 16 + Math.max(0, order) * 100;
    });
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    const pageScroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = pageScroll;
    try {
      const view = render(<PropertyFilterChips items={items("p2")} />);
      const nav = screen.getByRole("navigation");
      // "Sahil Evi" şeritte 300 px'te başlar; ortalamak için 300 − (300 − 100) / 2 = 200.
      expect(nav.scrollLeft).toBe(200);
      view.rerender(<PropertyFilterChips items={items("all")} />);
      expect(nav.scrollLeft).toBe(0); // ilk çip: sola taşmaz
      // Aynı seçimle yeniden çizim kullanıcının elle kaydırdığı şeridi geri sıçratmaz.
      nav.scrollLeft = 77;
      view.rerender(<PropertyFilterChips items={items("all")} />);
      expect(nav.scrollLeft).toBe(77);
      expect(pageScroll).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
      left.mockRestore();
      width.mockRestore();
      client.mockRestore();
    }
  });

  it("ortalama hesabı: çip şeridin ortasına gelir, konum eksiye inmez", () => {
    expect(centeredScrollLeft(0, 100, 300)).toBe(0);
    expect(centeredScrollLeft(300, 100, 300)).toBe(200);
    expect(centeredScrollLeft(1000, 80, 358)).toBe(861);
    expect(centeredScrollLeft(50, 400, 300)).toBe(100);
  });
});
