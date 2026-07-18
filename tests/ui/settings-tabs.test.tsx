// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SettingsTabs } from "@/components/settings/settings-tabs";

const TABS = [
  { id: "yapay-zeka", label: "Yapay Zeka", content: <div>AI PANELİ</div> },
  { id: "otomatik-mesajlar", label: "Otomatik Mesajlar", content: <div>MESAJ PANELİ</div> },
  {
    id: "baglanti-takvim",
    label: "Bağlantı ve Takvim",
    content: (
      <div id="hospitable">
        BAĞLANTI PANELİ
        <input aria-label="feed" defaultValue="" />
      </div>
    ),
  },
  { id: "hesap-guvenlik", label: "Hesap ve Güvenlik", content: <div>HESAP PANELİ</div> },
];

function activePanel() {
  // The visible tabpanel is the one WITHOUT the `hidden` attribute.
  return screen.getAllByRole("tabpanel", { hidden: true }).find((p) => !p.hasAttribute("hidden"));
}

describe("SettingsTabs (UI)", () => {
  beforeEach(() => {
    // Reset search + hash between cases. Use a RELATIVE url so it resolves against
    // jsdom's own origin (which carries a port) — an absolute "http://localhost/..."
    // would be a different origin and replaceState would throw SecurityError.
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => cleanup());

  it("renders the initial tab active and its panel visible", () => {
    render(<SettingsTabs tabs={TABS} initialTabId="yapay-zeka" />);
    const aiTab = screen.getByRole("tab", { name: "Yapay Zeka" });
    expect(aiTab.getAttribute("aria-selected")).toBe("true");
    expect(activePanel()?.textContent).toContain("AI PANELİ");
  });

  it("clicking a tab switches the visible panel and marks it selected", () => {
    render(<SettingsTabs tabs={TABS} initialTabId="yapay-zeka" />);
    fireEvent.click(screen.getByRole("tab", { name: "Hesap ve Güvenlik" }));
    expect(activePanel()?.textContent).toContain("HESAP PANELİ");
    expect(screen.getByRole("tab", { name: "Hesap ve Güvenlik" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Yapay Zeka" }).getAttribute("aria-selected")).toBe("false");
  });

  it("inactive panels stay MOUNTED (form input survives a tab switch)", () => {
    render(<SettingsTabs tabs={TABS} initialTabId="baglanti-takvim" />);
    const input = screen.getByLabelText("feed") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gizli-feed" } });
    // Leave the tab and come back.
    fireEvent.click(screen.getByRole("tab", { name: "Yapay Zeka" }));
    fireEvent.click(screen.getByRole("tab", { name: "Bağlantı ve Takvim" }));
    expect((screen.getByLabelText("feed") as HTMLInputElement).value).toBe("gizli-feed");
  });

  it("reflects the active tab in ?tab= without a navigation (replaceState)", () => {
    render(<SettingsTabs tabs={TABS} initialTabId="yapay-zeka" />);
    fireEvent.click(screen.getByRole("tab", { name: "Otomatik Mesajlar" }));
    expect(new URL(window.location.href).searchParams.get("tab")).toBe("otomatik-mesajlar");
  });

  it("#hospitable deep-link (dashboard) → activates the connection tab + scrolls the card", async () => {
    window.history.replaceState(null, "", "#hospitable"); // relative → same origin, just sets the hash
    const scrollIntoView = vi.fn();
    // jsdom has no scrollIntoView; stub it on the prototype.
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    render(<SettingsTabs tabs={TABS} initialTabId="yapay-zeka" />);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Bağlantı ve Takvim" }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(activePanel()?.textContent).toContain("BAĞLANTI PANELİ");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("keyboard: ArrowRight moves + activates the next tab", () => {
    render(<SettingsTabs tabs={TABS} initialTabId="yapay-zeka" />);
    const aiTab = screen.getByRole("tab", { name: "Yapay Zeka" });
    aiTab.focus();
    fireEvent.keyDown(aiTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Otomatik Mesajlar" }).getAttribute("aria-selected")).toBe("true");
  });

  it("only the active tab is in the tab order (roving tabindex)", () => {
    render(<SettingsTabs tabs={TABS} initialTabId="yapay-zeka" />);
    expect(screen.getByRole("tab", { name: "Yapay Zeka" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Hesap ve Güvenlik" }).getAttribute("tabindex")).toBe("-1");
  });
});
