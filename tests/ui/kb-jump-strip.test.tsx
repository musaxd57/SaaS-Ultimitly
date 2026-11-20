// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/knowledge" }));

import { KbManager, KB_JUMP_MIN_PROPERTIES, type KbItem } from "@/components/knowledge/kb-manager";

// Bilgi Tabanı — "Daireye git" şeridi (FB gezisi 11-20 akşam): 12 dairede liste telefonda 13.000 px; aranan daire için baştan sona
// kaydırmak gerekiyordu. Şerit var olan `#kb-<daire>` çapalarına götürür; az dairede çizilmez.

const props = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Lale ${i + 1}` }));
const itemFor = (propertyId: string): KbItem => ({
  id: `k-${propertyId}`,
  propertyId,
  propertyName: propertyId,
  category: "general",
  title: "Otopark",
  content: "Bina altında otopark var.",
  language: "tr",
  isActive: true,
});

describe("KbManager — daireye atlama şeridi", () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fromTemplates: [] }) })));
  });

  it("eşikten fazla dairenin bilgisi varken şerit çizilir; her çip o dairenin kartına götürür (çapa gerçekten var)", () => {
    const properties = props(KB_JUMP_MIN_PROPERTIES + 1);
    render(<KbManager properties={properties} items={properties.map((p) => itemFor(p.id))} />);
    const nav = screen.getByRole("navigation", { name: "Daireye git" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(properties.map((p) => p.name));
    for (const [i, a] of links.entries()) {
      const href = a.getAttribute("href")!;
      expect(href).toBe(`#kb-${properties[i]!.id}`);
      // Hedef sayfada var ve bir karttır (çapasız bağlantı sessizce hiçbir yere gitmez).
      expect(document.getElementById(href.slice(1))).not.toBeNull();
      expect(a.getAttribute("aria-current")).toBeNull();
    }
  });

  it("yalnız BİLGİSİ OLAN daireler şeritte (bilgisi olmayan dairenin kartı yok)", () => {
    const properties = props(6);
    const withItems = properties.slice(0, 4);
    render(<KbManager properties={properties} items={withItems.map((p) => itemFor(p.id))} />);
    const nav = screen.getByRole("navigation", { name: "Daireye git" });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(withItems.map((p) => p.name));
  });

  it("eşik ve altında şerit YOK (az dairede kalabalık etmesin)", () => {
    const properties = props(KB_JUMP_MIN_PROPERTIES);
    render(<KbManager properties={properties} items={properties.map((p) => itemFor(p.id))} />);
    expect(screen.queryByRole("navigation", { name: "Daireye git" })).toBeNull();
    cleanup();
    render(<KbManager properties={props(8)} items={[]} />);
    expect(screen.queryByRole("navigation", { name: "Daireye git" })).toBeNull();
  });
});
