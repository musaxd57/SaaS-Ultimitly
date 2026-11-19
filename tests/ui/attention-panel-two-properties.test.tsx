// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
import { AttentionPanel, BOOKING_SPAN_HEADLINE, bookingSpanPropertiesLine } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// "İki dairede kayıtlı" satırı (kurucu 11-18 akşam; UA-1 11-19; kurucu 11-19 akşam madde 3 "ek takmayalım"). Metinler AYNEN pinli:
//   Aynı rezervasyon birden fazla dairede görünüyor
//   Sahil Evi · Lale 5
//   Kayıtları karşılaştır
// Daire adı değişmez (ek takılmaz), kaç daire olursa olsun başlık aynı. Varış günü + "Otomatik mesajlar bekletiliyor." ikinci satırda adlardan
// SONRA (bilgi kaybolmaz, satır sayısı artmaz).
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
  it("başlık sabit; ikinci satır daire adları ' · ' ile, sonra varış günü ve tutma notu; satır karşılaştırma sayfasına gider, eylem adı görünür", () => {
    render(<AttentionPanel items={[row(["Sahil Evi", "Lale 5"])]} />);
    expect(screen.getByText("Aynı rezervasyon birden fazla dairede görünüyor")).toBeTruthy();
    expect(screen.getByText("Sahil Evi · Lale 5 · 5 Ara · Otomatik mesajlar bekletiliyor.")).toBeTruthy();
    const link = screen.getByText(BOOKING_SPAN_HEADLINE).closest("a");
    expect(link?.getAttribute("href")).toBe("/reservations/compare/res-1");
    const action = screen.getByText("Kayıtları karşılaştır");
    // Eylem adı aynı bağlantının içinde (iç içe bağlantı / düğme yok).
    expect(action.closest("a")).toBe(link);
    expect(link?.querySelectorAll("a, button")).toHaveLength(0);
    // Başlık + tek alt satır + eylem: üç blok, dördüncü satır yok.
    expect(link?.querySelectorAll("p")).toHaveLength(2);
    // Kesin gözlem: "doğrulayın" eki yok. Eski talimat cümlesi kalktı (eylem artık "Kayıtları karşılaştır").
    expect(screen.queryByText(/doğrulayın/)).toBeNull();
    expect(screen.queryByText(/Yanlış kaydı kaldırın/)).toBeNull();
  });

  it("🚨 ek takılmaz: daire adı OLDUĞU GİBİ (iyelik ekli ad, rakamla biten ad, üç daire) — başlık değişmez", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 3", "Lale 5"])]} />);
    expect(screen.getByText(BOOKING_SPAN_HEADLINE)).toBeTruthy();
    expect(screen.getByText("Lale 1 · Lale 3 · Lale 5 · 5 Ara · Otomatik mesajlar bekletiliyor.")).toBeTruthy();
    cleanup();
    render(<AttentionPanel items={[row(["Bahçe Evi", "Sahil Evi"])]} />);
    expect(screen.getByText(BOOKING_SPAN_HEADLINE)).toBeTruthy();
    expect(screen.getByText("Bahçe Evi · Sahil Evi · 5 Ara · Otomatik mesajlar bekletiliyor.")).toBeTruthy();
    // Bulunma eki hiçbir biçimde yok ("Evi'de", "5'te" …).
    expect(document.body.textContent).not.toMatch(/'(d|t)[ae]\b/);
  });

  it("varış günü bilinmiyorsa yalnız adlar + tutma notu; adlar yoksa satırın dairesi", () => {
    render(<AttentionPanel items={[row(["Lale 3", "Lale 5"], { arrivalDay: undefined })]} />);
    expect(screen.getByText("Lale 3 · Lale 5 · Otomatik mesajlar bekletiliyor.")).toBeTruthy();
    cleanup();
    render(<AttentionPanel items={[row(["Lale 3"], { bookingPropertyNames: undefined })]} />);
    expect(screen.getByText("Lale 3 · 5 Ara · Otomatik mesajlar bekletiliyor.")).toBeTruthy();
  });

  it("kart tavanındaki son satır kalan sayıyı taşır; taşımayan satırda sayı yok", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 2"]), row(["Lale 3", "Lale 4", "Lale 5"], { bookingMoreCount: 2 })]} />);
    expect(screen.getByText("Lale 3 · Lale 4 · Lale 5 · 5 Ara · Otomatik mesajlar bekletiliyor. · 2 rezervasyon daha")).toBeTruthy();
    expect(screen.getAllByText(/rezervasyon daha/)).toHaveLength(1);
    expect(screen.getAllByText("Kayıtları karşılaştır")).toHaveLength(2);
    expect(screen.getAllByText(BOOKING_SPAN_HEADLINE)).toHaveLength(2);
  });

  it("öteki türlerde eylem adı yok", () => {
    render(<AttentionPanel items={[{ ...row(["Lale 1"]), kind: "channel_reactivation", href: "/calendar" }]} />);
    expect(screen.queryByText("Kayıtları karşılaştır")).toBeNull();
  });

  it("bookingSpanPropertiesLine: adlar olduğu gibi, ' · ' ile (tek ad, iki ad, dört ad, boş)", () => {
    expect(BOOKING_SPAN_HEADLINE).toBe("Aynı rezervasyon birden fazla dairede görünüyor");
    expect(bookingSpanPropertiesLine(["Sahil Evi"])).toBe("Sahil Evi");
    expect(bookingSpanPropertiesLine(["Sahil Evi", "Lale 5"])).toBe("Sahil Evi · Lale 5");
    expect(bookingSpanPropertiesLine(["A", "B", "C", "D"])).toBe("A · B · C · D");
    expect(bookingSpanPropertiesLine([])).toBe("");
  });
});
