// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// U6 (kurucu 10-22: "Biten adımlar gitsin zaten o şekilde kısalır … biten adımlar tek satır ('3 adım tamam ✓'). Böyle olabilir ama yerini
// şimdilik değiştirme"). Tamamlanan adımlar ayrı satırda üstü çizili duruyordu; artık tek özet satırı, kalan adımlar kendi numarası ve
// düğmesiyle. Ekran okuyucu biten adımların adlarını yine duyar.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { OnboardingGuide, type OnboardingStep } from "@/components/onboarding-guide";

const step = (done: boolean, title: string): OnboardingStep => ({ done, title, desc: `${title} açıklaması`, href: "/settings", cta: `${title} aç` });
const STEPS = [
  step(true, "Bağlantı"),
  step(true, "Mülk"),
  step(false, "Bilgi tabanı"),
  step(true, "Ses"),
  step(false, "Otomatik yanıt"),
  step(false, "Ekip"),
];

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("U6 — biten adımlar tek satır", () => {
  it("3 biten adım tek özet satırı; kalan 3 adım numarası, açıklaması ve düğmesiyle", async () => {
    render(<OnboardingGuide steps={STEPS} />);
    await waitFor(() => expect(screen.getByText(/Başlarken/)).toBeTruthy());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4); // özet + 3 kalan
    expect(items[0].textContent).toContain("3 adım tamam");
    // Biten adımın açıklaması ve düğmesi yok; adı yalnız ekran okuyucu metninde.
    expect(screen.queryByText("Bağlantı açıklaması")).toBeNull();
    expect(screen.queryByText("Mülk aç")).toBeNull();
    expect(items[0].querySelector(".sr-only")?.textContent).toContain("Bağlantı, Mülk, Ses");
    // Kalanlar: özgün sıra numarası korunur (3, 5, 6 — "x/6 tamam" ile tutarlı).
    expect(items.slice(1).map((li) => li.querySelector("span span")?.textContent)).toEqual(["3", "5", "6"]);
    expect(screen.getByText("Bilgi tabanı aç").closest("a")?.getAttribute("href")).toBe("/settings");
  });

  it("hiç biten adım yoksa özet satırı YOK", async () => {
    render(<OnboardingGuide steps={STEPS.map((s) => ({ ...s, done: false }))} />);
    await waitFor(() => expect(screen.getByText(/Başlarken/)).toBeTruthy());
    expect(screen.queryByText(/adım tamam/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
});
