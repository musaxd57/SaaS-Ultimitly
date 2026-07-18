// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { SettingsSections, type SettingsViewGroup } from "@/components/settings/settings-sections";

const GROUPS: SettingsViewGroup[] = [
  {
    label: "İşletme Ayarları",
    items: [
      { id: "yapay-zeka", label: "Yapay Zekâ", content: <div>AI GÖRÜNÜMÜ</div> },
      { id: "otomatik-mesajlar", label: "Otomatik Mesajlar", content: <div>MESAJ GÖRÜNÜMÜ</div> },
      {
        id: "baglantilar",
        label: "Bağlantılar",
        content: (
          <div id="hospitable">
            BAĞLANTILAR GÖRÜNÜMÜ
            <input aria-label="feed" defaultValue="" />
          </div>
        ),
      },
      { id: "bildirimler", label: "Bildirimler", content: <div>BİLDİRİM GÖRÜNÜMÜ</div> },
      { id: "saat-dilimi", label: "Saat Dilimi", content: <div>SAAT GÖRÜNÜMÜ</div> },
    ],
  },
  { label: null, items: [{ id: "faturalandirma", label: "Faturalandırma", content: <div>FATURA GÖRÜNÜMÜ</div> }] },
  { label: null, items: [{ id: "hesap-guvenlik", label: "Hesap ve Güvenlik", content: <div>HESAP GÖRÜNÜMÜ</div> }] },
];

function activePanel() {
  return screen.getAllByRole("region", { hidden: true }).find((p) => !p.hasAttribute("hidden"));
}
// The desktop nav is the <nav> element; scope queries to it (the mobile <select>
// duplicates every label as an <option>, which would make getByText ambiguous).
function nav() {
  return screen.getByRole("navigation", { name: "Ayarlar bölümleri" });
}

describe("SettingsSections (UI)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => cleanup());

  it("renders the desktop nav grouped, with the İşletme Ayarları header + a mobile select", () => {
    render(<SettingsSections groups={GROUPS} initialViewId="yapay-zeka" />);
    expect(within(nav()).getByText("İşletme Ayarları")).toBeTruthy(); // group header
    // Mobile accessible section picker exists and groups the İşletme views.
    const select = screen.getByLabelText("Ayarlar bölümü") as HTMLSelectElement;
    expect(select.value).toBe("yapay-zeka");
    expect(select.querySelector('optgroup[label="İşletme Ayarları"]')).toBeTruthy();
  });

  it("marks the initial view active and shows only its panel", () => {
    render(<SettingsSections groups={GROUPS} initialViewId="yapay-zeka" />);
    expect(within(nav()).getByRole("button", { name: "Yapay Zekâ" }).getAttribute("aria-current")).toBe("page");
    expect(activePanel()?.textContent).toContain("AI GÖRÜNÜMÜ");
  });

  it("clicking a left-nav item switches the visible panel", () => {
    render(<SettingsSections groups={GROUPS} initialViewId="yapay-zeka" />);
    fireEvent.click(within(nav()).getByRole("button", { name: "Hesap ve Güvenlik" }));
    expect(activePanel()?.textContent).toContain("HESAP GÖRÜNÜMÜ");
    expect(within(nav()).getByRole("button", { name: "Hesap ve Güvenlik" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByRole("button", { name: "Yapay Zekâ" }).getAttribute("aria-current")).toBeNull();
  });

  it("the mobile <select> switches the visible panel too", () => {
    render(<SettingsSections groups={GROUPS} initialViewId="yapay-zeka" />);
    fireEvent.change(screen.getByLabelText("Ayarlar bölümü"), { target: { value: "bildirimler" } });
    expect(activePanel()?.textContent).toContain("BİLDİRİM GÖRÜNÜMÜ");
  });

  it("inactive panels stay MOUNTED (form input survives a view switch)", () => {
    render(<SettingsSections groups={GROUPS} initialViewId="baglantilar" />);
    fireEvent.change(screen.getByLabelText("feed"), { target: { value: "gizli-feed" } });
    fireEvent.click(within(nav()).getByRole("button", { name: "Yapay Zekâ" }));
    fireEvent.click(within(nav()).getByRole("button", { name: "Bağlantılar" }));
    expect((screen.getByLabelText("feed") as HTMLInputElement).value).toBe("gizli-feed");
  });

  it("reflects the active view in ?tab= without a navigation (replaceState)", () => {
    render(<SettingsSections groups={GROUPS} initialViewId="yapay-zeka" />);
    fireEvent.click(within(nav()).getByRole("button", { name: "Saat Dilimi" }));
    expect(new URL(window.location.href).searchParams.get("tab")).toBe("saat-dilimi");
  });

  it("#hospitable deep-link → activates the Bağlantılar view + scrolls the card", async () => {
    window.history.replaceState(null, "", "#hospitable");
    const scrollIntoView = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    render(<SettingsSections groups={GROUPS} initialViewId="yapay-zeka" />);
    await waitFor(() =>
      expect(within(nav()).getByRole("button", { name: "Bağlantılar" }).getAttribute("aria-current")).toBe("page"),
    );
    expect(activePanel()?.textContent).toContain("BAĞLANTILAR GÖRÜNÜMÜ");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("omits a filtered-out view (e.g. billing hidden for non-owner)", () => {
    const noBilling: SettingsViewGroup[] = GROUPS.filter((g) => g.items[0].id !== "faturalandirma");
    render(<SettingsSections groups={noBilling} initialViewId="yapay-zeka" />);
    expect(within(nav()).queryByRole("button", { name: "Faturalandırma" })).toBeNull();
    expect(screen.queryByText("FATURA GÖRÜNÜMÜ")).toBeNull();
  });
});
