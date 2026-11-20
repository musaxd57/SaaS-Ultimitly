// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
import { AttentionPanel, AUTO_SEND_STOPPED_TEXT, BOOKING_SPAN_HEADLINE, bookingSpanDetailLine } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// "İki dairede kayıtlı" satırı (kurucu 11-18 akşam; UA-1 11-19; 11-19 akşam madde 3 "ek takmayalım"; 11-20 sabah B-1). Metinler AYNEN pinli:
//   Aynı rezervasyon birden fazla dairede görünüyor
//   Sahil Evi · Lale 5 · Giriş: 5 Ara
//   Otomatik gönderim durduruldu · Kayıtları karşılaştır
// Daire adı değişmez (ek takılmaz). "Otomatik gönderim durduruldu" YALNIZ tutma bu rezervasyonda gerçekten bir otomatik mesajı durduruyorsa
// (`autoSendStopped`; yüklem `lib/booking-conflict-auto-send.ts`) — "Otomatik mesajlar bekletiliyor." kalktı (sonradan gönderme sözü vermesin).
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

/** Satırın üç bloğunun görünen metni (başlık · ikinci satır · eylem satırı). */
const linesOf = (link: Element | null) => [...(link?.querySelectorAll("p") ?? [])].map((p) => p.textContent);

describe("Dikkat — iki dairede kayıtlı satırı", () => {
  it("🚨 gönderim gerçekten durduruluyorsa: üç satır AYNEN; satır karşılaştırma sayfasına gider, iç içe bağlantı / düğme yok", () => {
    render(<AttentionPanel items={[row(["Sahil Evi", "Lale 5"], { autoSendStopped: true })]} />);
    const link = screen.getByText(BOOKING_SPAN_HEADLINE).closest("a");
    expect(link?.getAttribute("href")).toBe("/reservations/compare/res-1");
    expect(linesOf(link)).toEqual([
      "Aynı rezervasyon birden fazla dairede görünüyor",
      "Sahil Evi · Lale 5 · Giriş: 5 Ara",
      "Otomatik gönderim durduruldu · Kayıtları karşılaştır",
    ]);
    // Eylem adı aynı bağlantının içinde (iç içe bağlantı / düğme yok).
    expect(screen.getByText("Kayıtları karşılaştır").closest("a")).toBe(link);
    expect(link?.querySelectorAll("a, button")).toHaveLength(0);
    // Kesin gözlem: "doğrulayın" eki yok. Eski söz veren cümle kalktı.
    expect(screen.queryByText(/doğrulayın/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/bekletiliyor|Yanlış kaydı kaldırın/);
  });

  it("🚨 gönderim durdurulmuyorsa (yüklem hayır dedi ya da okunamadı): 'Otomatik gönderim durduruldu' YOK, eylem tek başına", () => {
    for (const autoSendStopped of [false, undefined]) {
      render(<AttentionPanel items={[row(["Sahil Evi", "Lale 5"], { autoSendStopped })]} />);
      const link = screen.getByText(BOOKING_SPAN_HEADLINE).closest("a");
      expect(linesOf(link), String(autoSendStopped)).toEqual([
        "Aynı rezervasyon birden fazla dairede görünüyor",
        "Sahil Evi · Lale 5 · Giriş: 5 Ara",
        "Kayıtları karşılaştır",
      ]);
      expect(screen.queryByText(/Otomatik gönderim/)).toBeNull();
      cleanup();
    }
  });

  it("ek takılmaz: daire adı OLDUĞU GİBİ (iyelik ekli ad, üç daire) — başlık değişmez", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 3", "Lale 5"], { autoSendStopped: true })]} />);
    expect(screen.getByText("Lale 1 · Lale 3 · Lale 5 · Giriş: 5 Ara")).toBeTruthy();
    cleanup();
    render(<AttentionPanel items={[row(["Bahçe Evi", "Sahil Evi"])]} />);
    expect(screen.getByText(BOOKING_SPAN_HEADLINE)).toBeTruthy();
    expect(screen.getByText("Bahçe Evi · Sahil Evi · Giriş: 5 Ara")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/'(d|t)[ae]\b/);
  });

  it("varış günü bilinmiyorsa 'Giriş:' parçası yok; adlar yoksa satırın dairesi", () => {
    render(<AttentionPanel items={[row(["Lale 3", "Lale 5"], { arrivalDay: undefined })]} />);
    expect(screen.getByText("Lale 3 · Lale 5")).toBeTruthy();
    expect(screen.queryByText(/Giriş:/)).toBeNull();
    cleanup();
    render(<AttentionPanel items={[row(["Lale 3"], { bookingPropertyNames: undefined })]} />);
    expect(screen.getByText("Lale 3 · Giriş: 5 Ara")).toBeTruthy();
  });

  it("kart tavanındaki son satır kalan sayıyı ikinci satırın sonunda taşır; taşımayan satırda sayı yok", () => {
    render(<AttentionPanel items={[row(["Lale 1", "Lale 2"]), row(["Lale 3", "Lale 4", "Lale 5"], { bookingMoreCount: 2 })]} />);
    expect(screen.getByText("Lale 3 · Lale 4 · Lale 5 · Giriş: 5 Ara · 2 rezervasyon daha")).toBeTruthy();
    expect(screen.getAllByText(/rezervasyon daha/)).toHaveLength(1);
    expect(screen.getAllByText("Kayıtları karşılaştır")).toHaveLength(2);
    expect(screen.getAllByText(BOOKING_SPAN_HEADLINE)).toHaveLength(2);
  });

  it("öteki türlerde eylem adı ve durdurma satırı yok", () => {
    render(<AttentionPanel items={[{ ...row(["Lale 1"], { autoSendStopped: true }), kind: "channel_reactivation", href: "/calendar" }]} />);
    expect(screen.queryByText("Kayıtları karşılaştır")).toBeNull();
    expect(screen.queryByText(/Otomatik gönderim/)).toBeNull();
  });

  it("metin kaynakları: başlık ve durdurma cümlesi AYNEN; ikinci satır biçimi (tek ad, iki ad, gün, boş)", () => {
    expect(BOOKING_SPAN_HEADLINE).toBe("Aynı rezervasyon birden fazla dairede görünüyor");
    expect(AUTO_SEND_STOPPED_TEXT).toBe("Otomatik gönderim durduruldu");
    expect(bookingSpanDetailLine(["Sahil Evi"])).toBe("Sahil Evi");
    expect(bookingSpanDetailLine(["Sahil Evi", "Lale 5"], "2026-12-05")).toBe("Sahil Evi · Lale 5 · Giriş: 5 Ara");
    expect(bookingSpanDetailLine(["A", "B", "C", "D"])).toBe("A · B · C · D");
    expect(bookingSpanDetailLine([], "2027-01-31")).toBe("Giriş: 31 Oca");
  });
});
