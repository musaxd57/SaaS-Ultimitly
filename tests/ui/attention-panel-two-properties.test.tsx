// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
import { AttentionPanel, joinNamesTr } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// "İki dairede kayıtlı" satırı (kurucu 11-18 akşam; UA-1 11-19: "Bu rezervasyon Lale 3 ve Lale 5'te görünüyor" + "Kayıtları karşılaştır").
// Metinler kurucunun aktardığı cevaptan AYNEN pinli.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const row = (names: string[], extra: Partial<AttentionItem> = {}): AttentionItem => ({
  kind: "booking_two_properties",
  certainty: "observed",
  propertyId: "p1",
  propertyName: names[0],
  severity: 85,
  occurredAt: new Date("2026-12-05T00:00:00Z"),
  href: "/reservations/compare/res-1",
  rowKey: `r-${names.length}`,
  bookingPropertyNames: names,
  arrivalDay: "2026-12-05",
  ...extra,
});

describe("Dikkat — iki dairede kayıtlı satırı", () => {
  it("başlık iki adla + bulunma eki; alt satır bugünkü gibi; satır karşılaştırma sayfasına gider, eylem adı görünür", () => {
    render(<AttentionPanel items={[row(["Lale 3", "Lale 5"])]} />);
    expect(screen.getByText("Bu rezervasyon Lale 3 ve Lale 5'te görünüyor")).toBeTruthy();
    expect(screen.getByText("5 Ara · Otomatik mesajlar bekletiliyor. Yanlış kaydı kaldırın.")).toBeTruthy();
    const link = screen.getByText(/Bu rezervasyon/).closest("a");
    expect(link?.getAttribute("href")).toBe("/reservations/compare/res-1");
    const action = screen.getByText("Kayıtları karşılaştır");
    // Eylem adı aynı bağlantının içinde (iç içe bağlantı / düğme yok).
    expect(action.closest("a")).toBe(link);
    expect(link?.querySelectorAll("a, button")).toHaveLength(0);
    // Kesin gözlem: "doğrulayın" eki yok.
    expect(screen.queryByText(/doğrulayın/)).toBeNull();
  });

  it("üç dairede: adlar virgülle, sonuncusu 've' ile; ek SON adın okunuşuna uyar", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 3", "Lale 5"])]} />);
    expect(screen.getByText("Bu rezervasyon Lale 1, Lale 3 ve Lale 5'te görünüyor")).toBeTruthy();
    cleanup();
    render(<AttentionPanel items={[row(["Lale 3", "Lale 6"])]} />);
    expect(screen.getByText("Bu rezervasyon Lale 3 ve Lale 6'da görünüyor")).toBeTruthy();
    cleanup();
    render(<AttentionPanel items={[row(["Ada", "Deniz"])]} />);
    expect(screen.getByText("Bu rezervasyon Ada ve Deniz'de görünüyor")).toBeTruthy();
  });

  it("kart tavanındaki son satır kalan sayıyı taşır; taşımayan satırda sayı yok", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 2"]), row(["Lale 3", "Lale 4", "Lale 5"], { bookingMoreCount: 2 })]} />);
    expect(screen.getByText("5 Ara · Otomatik mesajlar bekletiliyor. Yanlış kaydı kaldırın. · 2 rezervasyon daha")).toBeTruthy();
    expect(screen.getAllByText(/rezervasyon daha/)).toHaveLength(1);
    expect(screen.getAllByText("Kayıtları karşılaştır")).toHaveLength(2);
  });

  it("öteki türlerde eylem adı yok", () => {
    render(<AttentionPanel items={[{ ...row(["Lale 1"]), kind: "channel_reactivation", href: "/calendar" }]} />);
    expect(screen.queryByText("Kayıtları karşılaştır")).toBeNull();
  });

  it("joinNamesTr: tek ad, iki ad, dört ad", () => {
    expect(joinNamesTr(["A"])).toBe("A");
    expect(joinNamesTr(["A", "B"])).toBe("A ve B");
    expect(joinNamesTr(["A", "B", "C", "D"])).toBe("A, B, C ve D");
    expect(joinNamesTr([])).toBe("");
  });
});
