// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionPanel } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// "Dikkat Gerektirenler" kartı — KARAR PİNLERİ (görsel değil).
//
// 🚨 En önemlisi: SAKİN GÜNDE HİÇ RENDER OLMAZ. Boş durum metni ya da "şu an
// sorun yok" rozeti de YOK — her gün orada duran bir uyarı kartı duvar kâğıdına
// döner ve gerçekten bir şey olduğunda görülmez.
//
// 🚨 İkincisi: ÇIKARIM olan satır kendini çıkarım diye söyler. Tekrar eden
// arıza, kelime ağıyla sınıflandırılmış sinyallerden türüyor (Türkçe olumsuz
// fiil boşluğu ÖLÇÜLMÜŞ bir açık) — kesin tespit gibi sunmak sahte kesinliktir.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const base = {
  propertyId: "p1",
  propertyName: "Deniz Apart",
  occurredAt: new Date("2026-09-09T00:00:00Z"),
};

describe("AttentionPanel", () => {
  it("🚨 BOŞ LİSTEDE HİÇBİR ŞEY BASMAZ (boş durum metni bile yok)", () => {
    const { container } = render(<AttentionPanel items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("bozuk besleme satırı host'a NE ANLAMA GELDİĞİNİ söyler", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "feed_broken", certainty: "observed", severity: 100, href: "/properties/p1", sourceLabel: "Airbnb" },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText(/Airbnb bağlantısı güncellenemiyor/)).toBeTruthy();
    expect(screen.getByText(/yeni rezervasyon gelmiyor olabilir/)).toBeTruthy();
    // Gözlem → "doğrulayın" uyarısı EKLENMEZ.
    expect(screen.queryByText(/otomatik sınıflandırma/)).toBeNull();
  });

  it("cevapsız mesaj satırı BEKLEME SÜRESİNİ yazar", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "unanswered_aging", certainty: "observed", severity: 59, href: "/inbox/c1", hoursWaiting: 9 },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText(/9 saattir cevapsız/)).toBeTruthy();
  });

  it("🚨 ÇIKARIM satırı kendini ÇIKARIM diye söyler", () => {
    const items: AttentionItem[] = [
      {
        ...base,
        kind: "recurring_issue",
        certainty: "inferred",
        severity: 30,
        href: "/properties/p1",
        category: "hot_water",
        evidenceCount: 4,
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText(/otomatik sınıflandırma, doğrulayın/)).toBeTruthy();
    expect(screen.getByText(/4 sinyal/)).toBeTruthy();
  });

  it("her satır kendi hedefine bağlanır", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "unanswered_aging", certainty: "observed", severity: 59, href: "/inbox/c1", hoursWaiting: 9 },
      { ...base, kind: "feed_broken", certainty: "observed", severity: 100, href: "/properties/p1", sourceLabel: "Airbnb" },
    ];
    render(<AttentionPanel items={items} />);
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/inbox/c1", "/properties/p1"]);
  });
});
