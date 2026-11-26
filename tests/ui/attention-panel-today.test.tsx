// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { AttentionPanel, AutomationDigestLine } from "@/components/attention-panel";

// AaaS "Bugün" ekranı (kurucu 11-13): "Dikkat Gerektirenler" kartı bugünkü HAZIR OLMAYAN girişleri en üstte taşır; sakin günde kart da
// sayaç satırı da HİÇ basılmaz (08-08 kart kaldırma kararının şartı).

afterEach(cleanup);

const arrival = { reservationId: "r1", propertyName: "Deniz Daire", checkInTime: "15:00", firstBlocking: "Temizlik açık · Ayşe · 09:40", moreBlocking: 1 };

describe("Panel — bugünkü hazır olmayan girişler", () => {
  it("yalnız giriş satırı varken de kart basılır; satır Girişler'e götürür, sayı rozette", () => {
    render(<AttentionPanel items={[]} arrivals={[arrival]} />);
    const link = screen.getByRole("link", { name: /Bugün 15:00 giriş hazır değil/ });
    expect(link.getAttribute("href")).toBe("/arrivals");
    expect(link.textContent).toContain("Deniz Daire · Temizlik açık · Ayşe · 09:40 · 1 eksik daha");
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("🚨 sakin gün: ne istisna ne hazır olmayan giriş → kart HİÇ basılmaz", () => {
    const { container } = render(<AttentionPanel items={[]} arrivals={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Panel — son 24 saatte sizin yerinize", () => {
  it("parçalar tek satırda", () => {
    render(<AutomationDigestLine digest={{ aiReplies: 6, welcomes: 0, checkins: 2, checkouts: 0, systemTasks: 3 }} />);
    expect(document.querySelector("[data-automation-digest]")!.textContent).toBe(
      "Son 24 saatte sizin yerinize: 6 misafir mesajı cevaplandı · 2 giriş mesajı gönderildi · 3 görev açıldı",
    );
  });

  it("🚨 hepsi 0 ya da okuma düştü (null) → satır HİÇ basılmaz", () => {
    const zero = render(<AutomationDigestLine digest={{ aiReplies: 0, welcomes: 0, checkins: 0, checkouts: 0, systemTasks: 0 }} />);
    expect(zero.container.innerHTML).toBe("");
    const none = render(<AutomationDigestLine digest={null} />);
    expect(none.container.innerHTML).toBe("");
  });
});
