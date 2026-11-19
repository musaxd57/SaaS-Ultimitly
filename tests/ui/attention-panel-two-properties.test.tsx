// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
import { AttentionPanel, joinNamesTr } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// "Aynı rezervasyon iki dairede kayıtlı" satırı (kurucu 11-18 akşam). Metin kurucu onayı bekliyor — görevdeki metin AYNEN pinli.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const row = (names: string[], extra: Partial<AttentionItem> = {}): AttentionItem => ({
  kind: "booking_two_properties",
  certainty: "observed",
  propertyId: "p1",
  propertyName: names[0],
  severity: 85,
  occurredAt: new Date("2026-12-05T00:00:00Z"),
  href: "/calendar?month=2026-12",
  rowKey: `r-${names.length}`,
  bookingPropertyNames: names,
  arrivalDay: "2026-12-05",
  ...extra,
});

describe("Dikkat — iki dairede kayıtlı satırı", () => {
  it("başlık iki adla, alt satır varış günü + metin; bağlantı takvim", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 2"])]} />);
    expect(screen.getByText("Aynı rezervasyon iki dairede kayıtlı: Lale 1 ve Lale 2")).toBeTruthy();
    expect(screen.getByText("5 Ara · Otomatik mesajlar bekletiliyor. Yanlış kaydı kaldırın.")).toBeTruthy();
    const link = screen.getByText(/Aynı rezervasyon iki dairede kayıtlı/).closest("a");
    expect(link?.getAttribute("href")).toBe("/calendar?month=2026-12");
    // Kesin gözlem: "doğrulayın" eki yok.
    expect(screen.queryByText(/doğrulayın/)).toBeNull();
  });

  it("üç dairede: adlar virgülle, sonuncusu 've' ile", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 2", "Lale 3"])]} />);
    expect(screen.getByText("Aynı rezervasyon iki dairede kayıtlı: Lale 1, Lale 2 ve Lale 3")).toBeTruthy();
  });

  it("joinNamesTr: tek ad, iki ad, dört ad", () => {
    expect(joinNamesTr(["A"])).toBe("A");
    expect(joinNamesTr(["A", "B"])).toBe("A ve B");
    expect(joinNamesTr(["A", "B", "C", "D"])).toBe("A, B, C ve D");
    expect(joinNamesTr([])).toBe("");
  });
});
