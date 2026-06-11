// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// next/link needs no router for a plain anchor; isolate the test from its internals.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { OnboardingGuide, type OnboardingStep } from "@/components/onboarding-guide";

const steps: OnboardingStep[] = [
  { done: true, title: "Airbnb / Booking bağlantısını kur", desc: "", href: "/settings", cta: "Bağlantıyı kur" },
  { done: false, title: "AI sesini ve imzanı ayarla", desc: "Tonu seç", href: "/settings", cta: "Ayarla" },
];

describe("OnboardingGuide dismiss (UI)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows the checklist and hides it when dismissed, persisting the flag", async () => {
    render(<OnboardingGuide steps={steps} />);
    expect(screen.getByText(/Başlarken/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Kurulum rehberini gizle"));

    await waitFor(() => expect(screen.queryByText(/Başlarken/)).toBeNull());
    expect(localStorage.getItem("lixus_onboarding_dismissed")).toBe("1");
  });

  it("stays hidden on mount when it was dismissed before", async () => {
    localStorage.setItem("lixus_onboarding_dismissed", "1");
    render(<OnboardingGuide steps={steps} />);
    // Starts visible (no hydration mismatch), then the mount effect hides it.
    await waitFor(() => expect(screen.queryByText(/Başlarken/)).toBeNull());
  });
});
