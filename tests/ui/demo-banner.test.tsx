// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/billing/demo-banner";
import { DEMO_ORG_ID, isDemoOrg } from "@/lib/demo-tenant/constants";

// Demo (inceleme) hesabı bandı: sade dille "örnek veri, misafire mesaj gitmez" der; yalnız demo
// org'unda seçilir (tek kaynak `isDemoOrg`).
describe("DemoBanner", () => {
  it("örnek hesap olduğunu ve hiçbir misafire mesaj gitmediğini söyler; teknik sözcük yok", () => {
    render(<DemoBanner />);
    const t = screen.getByTestId("demo-banner").textContent ?? "";
    expect(t).toContain("Örnek hesap");
    expect(t).toContain("hiçbir misafire mesaj gönderilmez");
    expect(t).not.toMatch(/hospitable|tenant|seed|sentetik/i);
  });

  it("isDemoOrg yalnız demo org kimliğinde doğru", () => {
    expect(isDemoOrg(DEMO_ORG_ID)).toBe(true);
    expect(isDemoOrg("lxdemo-org-2")).toBe(false);
    expect(isDemoOrg("cm123")).toBe(false);
    expect(isDemoOrg(null)).toBe(false);
    expect(isDemoOrg(undefined)).toBe(false);
  });
});
